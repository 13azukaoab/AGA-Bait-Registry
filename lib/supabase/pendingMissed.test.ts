import { describe, expect, it, vi } from "vitest";

import { loadPendingMissedRows } from "./pendingMissed";

// ข้อมูลทดสอบสมมติทั้งหมด
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("loadPendingMissedRows (ตกบริการ · RPC ถูกตัดที่ 1,000)", () => {
  const prow = (b: string, n: number) => ({
    contract_id: idOf(n),
    branch_id: b,
    missed_month: "2026-09-01",
    last_service_month: "2027-06-01",
    makeup_deadline_month: "2028-06-01",
    past_deadline: false,
  });
  const client = (impl: (branch: string | null) => { data: unknown[] | null; error: { message: string } | null }) => {
    const rpc = vi.fn(async (_name: string, args: { p_branch_id: string | null }) => impl(args.p_branch_id));
    return { c: { rpc } as never, rpc };
  };

  it("ผลน้อยกว่าเพดาน → เรียกครั้งเดียวทุกสาขา", async () => {
    const { c, rpc } = client(() => ({ data: [prow("b1", 1), prow("b2", 2)], error: null }));
    const r = await loadPendingMissedRows(c, "2026-11", ["b1", "b2"]);
    expect(r).toEqual({ rows: expect.any(Array), error: null, truncated: false });
    expect(r.rows).toHaveLength(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_pending_missed_services", { p_branch_id: null, p_month: "2026-11-01" });
  });
  it("ได้เต็ม 1,000 → ดึงซ้ำรายสาขาแล้วรวม ได้เกิน 1,000 ครบ ไม่ตัดเงียบ", async () => {
    const perBranch: Record<string, ReturnType<typeof prow>[]> = {
      b1: Array.from({ length: 700 }, (_, i) => prow("b1", i + 1)),
      b2: Array.from({ length: 600 }, (_, i) => prow("b2", 10_000 + i)),
    };
    const { c, rpc } = client((b) => ({ data: b === null ? [...perBranch.b1!, ...perBranch.b2!].slice(0, 1000) : perBranch[b]!, error: null }));
    const r = await loadPendingMissedRows(c, "2026-11", ["b1", "b2"]);
    expect(r.rows).toHaveLength(1300);
    expect(r.truncated).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it("สาขาใดยังเต็มเพดานอีก → truncated = true", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => prow("b1", i + 1));
    const { c } = client(() => ({ data: full, error: null }));
    const r = await loadPendingMissedRows(c, "2026-11", ["b1"]);
    expect(r.truncated).toBe(true);
  });
  it("error → คืน error", async () => {
    const { c } = client(() => ({ data: null, error: { message: "x" } }));
    expect((await loadPendingMissedRows(c, "2026-11", ["b1"])).error).toBe("x");
  });
});
