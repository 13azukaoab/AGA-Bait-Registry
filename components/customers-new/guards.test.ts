/**
 * เทสรอบ 1.1 ของหน้า /customers/new — กันข้อมูลหาย/error เงียบ (ข้อ 1–6)
 * ใช้ Supabase client ปลอม (ไม่แตะฐานข้อมูลจริง) · ตรรกะ pure อยู่ใน deleteRules.ts / saveRules.ts
 */
import { describe, expect, it } from "vitest";

import {
  buildDeleteConfirmText,
  contractDeleteBlockReason,
  describeShortfall,
  removalShortfall,
} from "./deleteRules";
import { loadAuditCounts, loadContractNos } from "./data";
import { removeObjects } from "./files";
import { PDF_TOO_LARGE_MESSAGE } from "./fileRules";
import { findLinkedRenewals } from "./save";
import { customerTypeMismatch, describeTypeMismatch } from "./saveRules";

// ---------- Supabase ปลอม ----------
type Call = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown };
type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null };

function fakeSupabase(
  handler: (c: Call) => Result,
  storageRemove?: (paths: string[]) => Result,
) {
  const calls: Call[] = [];
  const storageCalls: string[][] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: {} };
      const builder: Record<string, unknown> = {};
      const chain = (name: string) => (...args: unknown[]) => {
        if (name === "insert" || name === "delete" || name === "update") {
          call.op = name;
          call.payload = args[0];
        } else if (name === "eq" || name === "in" || name === "is") {
          call.filters[String(args[0])] = args[1];
        }
        return builder;
      };
      for (const n of ["select", "insert", "delete", "update", "eq", "in", "is", "limit", "order", "single"]) {
        builder[n] = chain(n);
      }
      builder.then = (resolve: (v: Result) => unknown) => {
        calls.push({ ...call });
        const r = handler(call);
        return Promise.resolve({ data: null, error: null, count: null, ...r }).then(resolve);
      };
      return builder;
    },
    storage: {
      from() {
        return {
          remove: async (paths: string[]) => {
            storageCalls.push(paths);
            const r = storageRemove?.(paths) ?? { data: paths.map((name) => ({ name })), error: null };
            return { data: null, error: null, ...r };
          },
        };
      },
    },
  };
  return { client: client as never, calls, storageCalls };
}

// ---------- pure ----------
describe("contractDeleteBlockReason (ข้อ 7)", () => {
  it("ปิด/ยกเลิก = ลบไม่ได้ พร้อมเหตุผล · active/รอเก็บ = ลบได้", () => {
    expect(contractDeleteBlockReason("closed")).toMatch(/ปิดแล้ว/);
    expect(contractDeleteBlockReason("cancelled")).toMatch(/ยกเลิก/);
    expect(contractDeleteBlockReason("active")).toBeNull();
    expect(contractDeleteBlockReason("expired_pending_collection")).toBeNull();
  });
});

describe("buildDeleteConfirmText (ข้อ 6)", () => {
  it("ไม่มี Renew ผูก = ไม่มีคำเตือนเรื่องการผูก", () => {
    expect(buildDeleteConfirmText("A-1", "บริษัท ก", [])).not.toMatch(/ผูก/);
  });
  it("มี Renew ผูก = เตือน + ระบุเลขที่สัญญา", () => {
    const t = buildDeleteConfirmText("A-1", "บริษัท ก", ["R-1", "R-2"]);
    expect(t).toMatch(/Renew ผูกกับสัญญานี้อยู่ 2 ใบ: R-1, R-2/);
    expect(t).toMatch(/การผูกจะหาย/);
  });
  it("เกิน 5 ใบ = ตัดรายการแล้วบอกจำนวนที่เหลือ", () => {
    const nos = ["1", "2", "3", "4", "5", "6", "7"];
    expect(buildDeleteConfirmText("A", "ข", nos)).toMatch(/และอีก 2 ใบ/);
  });
});

describe("removalShortfall (ข้อ 2)", () => {
  it("ครบ = 0 · ไม่ครบ/ว่าง/null = จำนวนที่ขาด", () => {
    expect(removalShortfall(3, 3)).toBe(0);
    expect(removalShortfall(3, 1)).toBe(2);
    expect(removalShortfall(3, 0)).toBe(3);
    expect(removalShortfall(2, null)).toBe(2);
    expect(describeShortfall(3, 1)).toMatch(/1 จาก 3/);
  });
});

describe("customerTypeMismatch (ข้อ 4)", () => {
  it("ไม่ได้เลือกประเภท / ตรงกัน = ไม่เตือน", () => {
    expect(customerTypeMismatch("A", "")).toBeNull();
    expect(customerTypeMismatch("A", "A")).toBeNull();
  });
  it("ต่างจากเดิม หรือของเดิมว่าง = เตือน", () => {
    expect(customerTypeMismatch("A", "B")).toEqual({ existing: "A", chosen: "B" });
    expect(customerTypeMismatch(null, "B")).toEqual({ existing: null, chosen: "B" });
  });
  it("ข้อความระบุสัญญา ลูกค้า และประเภททั้งสอง", () => {
    const t = describeTypeMismatch("A-1", "ก", { existing: "A", chosen: "B" }, (c) => `ชื่อ${c}`);
    expect(t).toMatch(/A-1/);
    expect(t).toMatch(/ชื่อA/);
    expect(t).toMatch(/ชื่อB/);
    expect(t).toMatch(/ไม่ได้ถูกบันทึก/);
  });
});

describe("ข้อความ PDF > 5 MB (ข้อ 8)", () => {
  it("บอกวิธีสแกนในข้อความเอง ไม่อ้างคู่มือ", () => {
    expect(PDF_TOO_LARGE_MESSAGE).toMatch(/150–200 dpi/);
    expect(PDF_TOO_LARGE_MESSAGE).not.toMatch(/คู่มือ/);
  });
});

// ---------- removeObjects (ข้อ 2) ----------
describe("removeObjects", () => {
  it("RLS ปฏิเสธแบบไม่ error (data ว่าง) = ล้ม ไม่ใช่สำเร็จ", async () => {
    const { client } = fakeSupabase(() => ({}), () => ({ data: [] }));
    const r = await removeObjects(client, ["a/1", "a/2"]);
    expect(r.ok).toBe(false);
  });
  it("ลบได้ไม่ครบ = ล้ม พร้อมจำนวนที่ลบได้", async () => {
    const { client } = fakeSupabase(() => ({}), () => ({ data: [{ name: "a/1" }] }));
    const r = await removeObjects(client, ["a/1", "a/2"]);
    expect(r).toMatchObject({ ok: false, removed: 1 });
  });
  it("error จาก Storage = ล้ม", async () => {
    const { client } = fakeSupabase(() => ({}), () => ({ error: { message: "boom" } }));
    expect((await removeObjects(client, ["a/1"])).ok).toBe(false);
  });
  it("ครบ / ไม่มี path = สำเร็จ และไม่เรียก Storage เมื่อไม่มีไฟล์", async () => {
    const f = fakeSupabase(() => ({}));
    expect((await removeObjects(f.client, ["a/1"])).ok).toBe(true);
    expect((await removeObjects(f.client, [])).ok).toBe(true);
    expect(f.storageCalls).toEqual([["a/1"]]);
  });
});

describe("findLinkedRenewals (ข้อ 6)", () => {
  it("คืนเลขที่สัญญา Renew ที่ผูก · error ถูกส่งต่อ", async () => {
    const ok = fakeSupabase(() => ({ data: [{ contract_no: "R-1" }, { contract_no: "R-2" }] }));
    expect(await findLinkedRenewals(ok.client, "c1")).toEqual({ contractNos: ["R-1", "R-2"], error: null });
    expect(ok.calls[0]!.filters).toEqual({ renewed_from_contract_id: "c1" });
    const bad = fakeSupabase(() => ({ error: { message: "x" } }));
    expect((await findLinkedRenewals(bad.client, "c1")).error).toBeTruthy();
  });
});

// ---------- data.ts (ข้อ 5) ----------
describe("loadAuditCounts / loadContractNos — error ไม่กลายเป็น 0 / —", () => {
  it("ชุดที่ query ล้ม → อยู่ใน failedIds ไม่มีใน counts", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id${i}`);
    let n = 0;
    const f = fakeSupabase(() => {
      n += 1;
      return n === 1 ? { data: [{ contract_id: "id0" }, { contract_id: "id0" }] } : { error: { message: "x" } };
    });
    const { counts, failedIds } = await loadAuditCounts(f.client, ids);
    expect(counts.get("id0")).toBe(2);
    expect(failedIds.has("id0")).toBe(false);
    expect(failedIds.size).toBe(20); // ชุดที่ 2 (id80–id99)
    expect(failedIds.has("id99")).toBe(true);
  });
  it("อ่านเลขสัญญาเก่าไม่ได้ → ไม่มี id นั้นในผลลัพธ์ (หน้าจอแสดงโหลดไม่ได้)", async () => {
    const f = fakeSupabase(() => ({ error: { message: "x" } }));
    expect((await loadContractNos(f.client, ["a"])).size).toBe(0);
    const g = fakeSupabase(() => ({ data: [{ id: "a", contract_no: "N-1" }] }));
    expect((await loadContractNos(g.client, ["a"])).get("a")).toBe("N-1");
  });
});
