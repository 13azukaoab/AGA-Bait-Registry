/**
 * ทดสอบ loadContractList (data.ts) — อ่านสัญญาแบบ keyset ตาม contract_no
 * ข้อมูลทดสอบสมมติทั้งหมด · Supabase เป็นตัวปลอม
 *
 * ครอบคลุม: ก้อนเต็ม 1,000 แถว → ขอก้อนถัดไปด้วย contract_no > ตัวสุดท้าย แล้วรวมครบ · ส่งทุกสาขาในคำขอเดียว
 * · ก้อนใดพลาด = คืน error ไม่คืนข้อมูลบางส่วน · นับ routine/AG จากตาราง visits/stations เหมือนเดิม
 */
import { describe, expect, it } from "vitest";

import { KEYSET_PAGE_SIZE } from "@/lib/supabase/fetchAll";

import { loadContractList } from "./data";

type Res = { data: unknown; error: { message: string } | null };
type Call = { table: string; ops: [string, unknown[]][] };

const RULES = [
  { tier: "S" as const, minAnnual: 0 },
  { tier: "M" as const, minAnnual: 30000 },
];

/** สัญญาสมมติ 1 ปี เริ่ม ม.ค. 2026 (ครอบเดือน 2026-11) */
const contractRow = (n: number, branch: string) => ({
  id: `id-${n}`,
  contract_no: `C${String(n).padStart(5, "0")}`,
  customer_id: `cust-${n}`,
  start_date: "2026-01-01",
  term_months: 12,
  value_total: 20000,
  status: "active",
  renewed_from_contract_id: null,
  stations_initialized_at: null,
  customers: { name: `ลูกค้าสมมติ ${n}`, branch_id: branch },
});

function makeSupabase(handlers: Record<string, (call: Call, nth: number) => Res>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gt", "lt", "gte", "order", "limit", "in", "is"]) {
      b[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return b;
      };
    }
    b.then = (resolve: (r: Res) => unknown, reject: (e: unknown) => unknown) => {
      calls.push(call);
      const nth = calls.filter((c) => c.table === table).length - 1;
      return Promise.resolve()
        .then(() => handlers[table]!(call, nth))
        .then(resolve, reject);
    };
    return b;
  };
  return { client: { from } as never, calls };
}

const opArgs = (call: Call, op: string) => call.ops.filter(([m]) => m === op).map(([, a]) => a);

/** visits/stations ถูกอ่านเป็นก้อน id (CHUNK) — คืนเฉพาะแถวของ id ในก้อนนั้น เหมือนฐานข้อมูลจริง */
const inChunk = (call: Call, rows: { contract_id: string }[]): Res => {
  const ids = (opArgs(call, "in").find((a) => a[0] === "contract_id")?.[1] ?? []) as string[];
  return { data: rows.filter((r) => ids.includes(r.contract_id)), error: null };
};

describe("loadContractList — keyset ตาม contract_no", () => {
  it("ก้อนแรกเต็ม 1,000 → ขอก้อนถัดไปด้วย contract_no > ตัวสุดท้าย · รวมครบ · ไม่ truncated", async () => {
    const page1 = Array.from({ length: KEYSET_PAGE_SIZE }, (_, i) => contractRow(i + 1, i % 2 ? "b2" : "b1"));
    const page2 = Array.from({ length: 5 }, (_, i) => contractRow(KEYSET_PAGE_SIZE + i + 1, "b1"));
    const { client, calls } = makeSupabase({
      contracts: (_c, nth) => ({ data: nth === 0 ? page1 : page2, error: null }),
      visits: (c) => inChunk(c, [{ contract_id: "id-1" }, { contract_id: "id-1" }, { contract_id: "id-1003" }]),
      stations: (c) => inChunk(c, [{ contract_id: "id-2" }]),
    });

    const r = await loadContractList(client, "2026-11", ["b1", "b2"], RULES);
    expect(r.error).toBeNull();
    expect(r.truncated).toBe(false);
    expect(r.items).toHaveLength(KEYSET_PAGE_SIZE + 5);

    const contractCalls = calls.filter((c) => c.table === "contracts");
    expect(contractCalls).toHaveLength(2);
    // ทุกสาขาในคำขอเดียว · เรียง contract_no · ก้อนละ KEYSET_PAGE_SIZE
    for (const c of contractCalls) {
      expect(opArgs(c, "in")).toContainEqual(["customers.branch_id", ["b1", "b2"]]);
      expect(opArgs(c, "order")).toContainEqual(["contract_no", { ascending: true }]);
      expect(opArgs(c, "limit")).toContainEqual([KEYSET_PAGE_SIZE]);
    }
    expect(opArgs(contractCalls[0]!, "gt")).toEqual([]);
    expect(opArgs(contractCalls[1]!, "gt")).toEqual([["contract_no", page1[page1.length - 1]!.contract_no]]);

    const byId = new Map(r.items.map((i) => [i.contractId, i]));
    expect(byId.get("id-1")).toMatchObject({ routineCountInMonth: 2, agCount: 0, branchId: "b1", tier: "S" });
    expect(byId.get("id-2")).toMatchObject({ routineCountInMonth: 0, agCount: 1, branchId: "b2" });
    expect(byId.get("id-1003")).toMatchObject({ routineCountInMonth: 1, contractNo: "C01003" });
  });

  it("ก้อนเดียวไม่เต็ม → อ่านสัญญาครั้งเดียว (พฤติกรรม /service รายสาขาเดิม)", async () => {
    const { client, calls } = makeSupabase({
      contracts: () => ({ data: [contractRow(1, "b1"), contractRow(2, "b1")], error: null }),
      visits: () => ({ data: [], error: null }),
      stations: () => ({ data: [], error: null }),
    });
    const r = await loadContractList(client, "2026-11", ["b1"], RULES);
    expect(r.error).toBeNull();
    expect(r.items.map((i) => i.contractNo)).toEqual(["C00001", "C00002"]);
    expect(calls.filter((c) => c.table === "contracts")).toHaveLength(1);
  });

  it("ก้อนที่ 2 พลาด → คืน error ไม่คืนข้อมูลบางส่วน", async () => {
    const page1 = Array.from({ length: KEYSET_PAGE_SIZE }, (_, i) => contractRow(i + 1, "b1"));
    const { client, calls } = makeSupabase({
      contracts: (_c, nth) => (nth === 0 ? { data: page1, error: null } : { data: null, error: { message: "page boom" } }),
      visits: () => ({ data: [], error: null }),
      stations: () => ({ data: [], error: null }),
    });
    const r = await loadContractList(client, "2026-11", ["b1"], RULES);
    expect(r).toEqual({ items: [], truncated: false, error: "page boom" });
    expect(calls.some((c) => c.table === "visits")).toBe(false);
  });

  it("ไม่มีสาขา → ไม่ยิงคำขอเลย", async () => {
    const { client, calls } = makeSupabase({});
    const r = await loadContractList(client, "2026-11", [], RULES);
    expect(r).toEqual({ items: [], truncated: false, error: null });
    expect(calls).toHaveLength(0);
  });
});
