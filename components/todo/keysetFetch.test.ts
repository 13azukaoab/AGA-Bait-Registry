import { describe, expect, it, vi } from "vitest";

import { loadPendingMissedRows } from "./data";
import { fetchAllKeyset, type KeysetPageResult } from "./keysetFetch";
import { summarizeCollect, type CollectContractInput } from "./logic";

// ข้อมูลทดสอบสมมติทั้งหมด
type Row = { id: string; remaining: number };
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const makeRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: idOf(i + 1), remaining: (i % 3) + 1 }));

/** ตัวปลอม PostgREST: เรียงตามคีย์ · gt(key) · ตัดที่ limit (และ max_rows 1,000) · นับจำนวนครั้งที่ถูกเรียก */
function fakeTable(all: Row[], opts: { maxRows?: number } = {}) {
  const maxRows = opts.maxRows ?? 1000;
  const calls: (string | null)[] = [];
  const fetchPage = async (after: string | null): Promise<KeysetPageResult<Row>> => {
    calls.push(after);
    const sorted = [...all].sort((a, b) => (a.id < b.id ? -1 : 1));
    const filtered = after === null ? sorted : sorted.filter((r) => r.id > after);
    return { data: filtered.slice(0, maxRows), error: null };
  };
  return { fetchPage, calls };
}

describe("fetchAllKeyset", () => {
  it("2,500 แถว หลายก้อน → ได้ครบทุกแถว ไม่ซ้ำ ไม่ข้าม (3 ก้อน)", async () => {
    const all = makeRows(2500);
    const { fetchPage, calls } = fakeTable(all);
    const r = await fetchAllKeyset(fetchPage, (x) => x.id);
    expect(r.error).toBeNull();
    expect(r.truncated).toBe(false);
    expect(r.rows).toHaveLength(2500);
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(2500);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBeNull();
    expect(calls[1]).toBe(idOf(1000));
  });
  it("ก้อนสุดท้ายพอดีเพดาน (2,000) → ขอก้อนที่ 3 ที่ว่าง แล้วหยุด", async () => {
    const { fetchPage, calls } = fakeTable(makeRows(2000));
    const r = await fetchAllKeyset(fetchPage, (x) => x.id);
    expect(r.rows).toHaveLength(2000);
    expect(r.truncated).toBe(false);
    expect(calls).toHaveLength(3);
  });
  it("น้อยกว่า 1 ก้อน / ว่าง", async () => {
    expect((await fetchAllKeyset(fakeTable(makeRows(5)).fetchPage, (x) => x.id)).rows).toHaveLength(5);
    expect((await fetchAllKeyset(fakeTable([]).fetchPage, (x) => x.id)).rows).toEqual([]);
  });
  it("ขนาดก้อนกำหนดเองได้ (500)", async () => {
    const t = fakeTable(makeRows(1200), { maxRows: 500 });
    const r = await fetchAllKeyset(t.fetchPage, (x) => x.id, { pageSize: 500 });
    expect(r.rows).toHaveLength(1200);
    expect(t.calls).toHaveLength(3);
  });
  it("error จากก้อนใด → คืน error ทันที ไม่คืนข้อมูลบางส่วน", async () => {
    let n = 0;
    const r = await fetchAllKeyset<Row>(
      async () => (++n === 2 ? { data: null, error: { message: "boom" } } : { data: makeRows(1000), error: null }),
      (x) => x.id,
    );
    expect(r).toEqual({ rows: [], error: "boom", truncated: false });
  });
  it("เกินเพดานจำนวนก้อน → หยุดและ truncated = true (ไม่ตัดเงียบ)", async () => {
    let n = 0;
    const r = await fetchAllKeyset<Row>(
      async () => ({ data: Array.from({ length: 1000 }, (_, i) => ({ id: idOf(++n * 1000 + i), remaining: 1 })), error: null }),
      (x) => x.id,
      { maxPages: 3 },
    );
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(3000);
  });
  it("ก้อนที่ไม่เดินหน้า (คีย์ไม่เพิ่ม) → หยุดกันวนไม่จบ + truncated", async () => {
    const same = makeRows(1000);
    const r = await fetchAllKeyset<Row>(async () => ({ data: same, error: null }), (x) => x.id);
    expect(r.truncated).toBe(true);
    expect(r.rows.length).toBe(2000);
  });
});

describe("การ์ด 'ลูกค้ารอเก็บสถานี' = ผลรวมจริง (บั๊ก B1)", () => {
  const today = "2026-11-20";
  /** สัญญา 2,500 ใบที่มี IG ค้าง: 1 ใน 3 จบแล้ว (expired) · 1 ใน 3 พัก · 1 ใน 3 ยังไม่จบ */
  const rows = makeRows(2500);
  const inputOf = (r: Row, i: number): CollectContractInput => ({
    customerId: `cust-${i}`,
    remaining: r.remaining,
    status: i % 3 === 0 ? "expired_pending_collection" : i % 3 === 1 ? "paused" : "active",
    endDate: i % 3 === 2 ? "2027-06-30" : "2026-01-31",
  });
  const expectedEnded = rows.map((r, i) => ({ r, i })).filter(({ i }) => i % 3 === 0);
  const expected = {
    customers: expectedEnded.length,
    stations: expectedEnded.reduce((s, { r }) => s + r.remaining, 0),
  };

  it("ดึงครบด้วย keyset แล้วสรุป = ผลรวมจริง (ไม่นับ paused / สัญญายังไม่จบ)", async () => {
    const t = fakeTable(rows);
    const got = await fetchAllKeyset(t.fetchPage, (x) => x.id);
    const s = summarizeCollect(got.rows.map(inputOf), today);
    expect(s).toEqual(expected);
  });
  it("ตัวอย่างเดิมที่ผิด: อ่านก้อนเดียว 1,000 แถวแรก → ได้ต่ำกว่าจริง (พิสูจน์ว่าบั๊กเกิดจริงและแก้แล้ว)", async () => {
    const t = fakeTable(rows);
    const firstOnly = (await t.fetchPage(null)).data ?? [];
    const low = summarizeCollect(firstOnly.map(inputOf), today);
    expect(low.customers).toBeLessThan(expected.customers);
  });
});

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
