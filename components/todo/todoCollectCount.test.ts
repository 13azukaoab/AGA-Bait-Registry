import { describe, expect, it } from "vitest";

import { fetchAllKeyset, type KeysetPageResult } from "@/lib/supabase/fetchAll";

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
