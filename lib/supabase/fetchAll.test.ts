import { describe, expect, it } from "vitest";

import { fetchAllKeyset, type KeysetPageResult } from "./fetchAll";

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
