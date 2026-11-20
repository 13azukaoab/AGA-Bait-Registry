import { describe, expect, it } from "vitest";

import { loadCollection } from "./collectionData";

// ข้อมูลทดสอบสมมติทั้งหมด · ตัวปลอม PostgREST: RPC ถูกตัดที่ 1,000 แถวเหมือนของจริง (max_rows)
const MAX_ROWS = 1000;
const N = 3; // สัญญาที่หมดแล้ว 3 ใบ (c1..c3) — c1 และ c3 มีเรื่องรอชดเชย
const idOf = (n: number) => `c${n}`;

function contract(n: number) {
  return {
    id: idOf(n),
    contract_no: `TS-${n}`,
    customer_id: `u${n}`,
    start_date: "2024-01-01",
    end_date: "2024-12-31",
    term_months: 12,
    status: "expired_pending_collection",
    closed_at: null,
    cancelled_at: null,
    customers: { name: `ลูกค้าสมมติ ${n}`, branches: { name: "สาขาสมมติ", division: "central" } },
    contract_teams: [],
  };
}

/** pendingByBranch: สาขา → รายการเรื่องรอชดเชย (contract_id, missed_month) */
function fakeClient(pendingByBranch: Record<string, { contract_id: string; missed_month: string }[]>) {
  const rpcCalls: (string | null)[] = [];
  const result = (data: unknown) => ({ data, error: null, count: Array.isArray(data) ? data.length : null });
  const chain = (data: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "or", "order", "range", "in", "eq"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(result(data)).then(res);
    return q;
  };
  const client = {
    from: (table: string) => {
      if (table === "contracts") return chain(Array.from({ length: N }, (_, i) => contract(i + 1)));
      if (table === "v_contract_ig_collection")
        return chain(Array.from({ length: N }, (_, i) => ({ contract_id: idOf(i + 1), ig_total: 3, collected: 0, not_collected: 0, moved_to_renewal: 0, remaining: 3 })));
      if (table === "v_ig_collection_monthly") return chain([]);
      if (table === "teams") return chain([]);
      if (table === "branches") return chain(Object.keys(pendingByBranch).map((id) => ({ id })));
      throw new Error("unexpected table " + table);
    },
    rpc: async (_name: string, args: { p_branch_id: string | null }) => {
      rpcCalls.push(args.p_branch_id);
      const rows =
        args.p_branch_id === null ? Object.values(pendingByBranch).flat().slice(0, MAX_ROWS) : (pendingByBranch[args.p_branch_id] ?? []).slice(0, MAX_ROWS);
      return { data: rows, error: null };
    },
  };
  return { client: client as never, rpcCalls };
}

const filler = (branch: string, n: number, from: number) =>
  Array.from({ length: n }, (_, i) => ({ contract_id: `${branch}-x${from + i}`, missed_month: "2026-09-01" }));
const opts = { today: "2026-11-20", currentMonth: "2026-11" };

describe("/collection ซ่อนลูกค้ารอชดเชย เมื่อเรื่องค้างเกิน 1,000 (RPC ถูกตัด)", () => {
  it("เรื่องค้างน้อยกว่าเพดาน → เรียก RPC ครั้งเดียว ซ่อนถูก ไม่มีคำเตือน", async () => {
    const { client, rpcCalls } = fakeClient({ b1: [{ contract_id: "c1", missed_month: "2026-09-01" }], b2: [] });
    const r = await loadCollection(client, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((x) => x.contractId)).toEqual(expect.arrayContaining(["c2", "c3"]));
    expect(r.held.map((h) => h.contractId)).toEqual(["c1"]);
    expect(r.pendingTruncated).toBe(false);
    expect(rpcCalls).toEqual([null]);
  });

  it("เกิน 1,000 รวม (แต่รายสาขาไม่เต็ม) → ดึงรายสาขา แล้วซ่อน c3 ที่อยู่หลังเพดานได้ครบ", async () => {
    // c1 อยู่ต้นรายการ · c3 อยู่ท้าย b2 (หลัง 1,000 แถวแรกของ "ทุกสาขา" → ครั้งเดียวจะมองไม่เห็น)
    const { client, rpcCalls } = fakeClient({
      b1: [{ contract_id: "c1", missed_month: "2026-09-01" }, ...filler("b1", 899, 0)],
      b2: [...filler("b2", 500, 0), { contract_id: "c3", missed_month: "2026-08-01" }],
    });
    const r = await loadCollection(client, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.held.map((h) => h.contractId).sort()).toEqual(["c1", "c3"]);
    expect(r.rows.map((x) => x.contractId)).toEqual(["c2"]);
    // ซ่อน + แสดง = ครบทุกสัญญาที่หมดแล้ว
    expect(r.rows.length + r.held.length).toBe(N);
    expect(r.pendingTruncated).toBe(false);
    expect(rpcCalls.length).toBe(3); // ทุกสาขา 1 ครั้ง + รายสาขา 2 ครั้ง
  });

  it("สาขาใดยังเต็มเพดานอีก → pendingTruncated = true (ขึ้นคำเตือน ไม่ตัดเงียบ)", async () => {
    const { client } = fakeClient({ b1: [{ contract_id: "c1", missed_month: "2026-09-01" }, ...filler("b1", 1200, 0)] });
    const r = await loadCollection(client, opts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pendingTruncated).toBe(true);
  });
});
