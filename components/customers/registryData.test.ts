import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { TierRule } from "../../lib/rules";
import { defaultFilters } from "./registryFilters";
import { loadRegistryForExport, loadRegistryPage, matchesPostFilter, toRegistryRow, type RegistryRowDb } from "./registryData";

const RULES: TierRule[] = [
  { tier: "S", minAnnual: 0 },
  { tier: "M", minAnnual: 30000 },
  { tier: "L", minAnnual: 50000 },
  { tier: "XL", minAnnual: 100000 },
];
const TODAY = "2026-11-20";

function raw(i: number, over: Partial<RegistryRowDb> = {}): RegistryRowDb {
  return {
    id: `id-${String(i).padStart(4, "0")}`,
    customer_id: `cust-${i}`,
    contract_no: `CT26-${String(i).padStart(7, "0")}`,
    start_date: "2026-01-15",
    end_date: "2027-01-14",
    term_months: 12,
    value_total: 10000,
    status: "active",
    customers: { name: `ลูกค้า ${i}`, branch_id: "b1", customer_types: { label: "บ้าน" }, branches: { name: "สาขา", zones: { name: "เขต 1" } } },
    stations: [{ count: 3 }],
    ...over,
  };
}

/** supabase จำลอง: ให้แถวตามลำดับ id และเคารพ cursor แบบง่ายๆ ผ่านการอ่านนิพจน์ `.or()` ไม่ได้ จึงส่งตามคิวที่เตรียมไว้ */
function fakeClient(queue: RegistryRowDb[][], counts: number[] = [], seen: { limits: number[]; selects: unknown[] } = { limits: [], selects: [] }) {
  let n = 0;
  const make = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["in", "eq", "neq", "or", "order"]) b[m] = () => b;
    b.limit = (l: number) => {
      seen.limits.push(l);
      return b;
    };
    b.then = (resolve: (v: unknown) => void) => {
      const data = queue[n] ?? [];
      const count = counts[n] ?? null;
      n++;
      resolve({ data, error: null, count });
    };
    return b;
  };
  return {
    client: {
      from: () => ({
        select: (_cols: string, opts?: unknown) => {
          seen.selects.push(opts);
          return make();
        },
      }),
    } as unknown as SupabaseClient,
    seen,
  };
}

const ctx = { refs: { branches: [], tierRules: RULES }, today: TODAY };

describe("toRegistryRow", () => {
  it("คำนวณ Tier/วันจบ/สถานะ/จำนวนสถานี จาก lib/rules", () => {
    const row = toRegistryRow(raw(1, { value_total: 150000, term_months: 12 }), RULES, TODAY, "default");
    expect(row?.tier).toBe("XL");
    expect(row?.annualValue).toBe(150000);
    expect(row?.endDate).toBe("2027-01-14");
    expect(row?.status).toBe("near_end"); // เหลือ 55 วัน
    expect(row?.stationCount).toBe(3);
    expect(row?.cursor).toEqual({ value: "2026-01-15", id: "id-0001" });
  });

  it("3 ปี: มูลค่าต่อปี = ÷ 3 (150,000 / 3 ปี → L)", () => {
    const row = toRegistryRow(raw(2, { value_total: 150000, term_months: 36, end_date: "2028-12-31" }), RULES, TODAY, "default");
    expect(row?.annualValue).toBe(50000);
    expect(row?.tier).toBe("L");
    expect(row?.status).toBe("active");
  });

  it("วันสิ้นสุดว่าง = วันเริ่ม + ระยะ − 1 วัน · cursor ของ end_date ว่าง = null", () => {
    const row = toRegistryRow(raw(3, { end_date: null }), RULES, TODAY, "end_asc");
    expect(row?.endDate).toBe("2027-01-14");
    expect(row?.cursor.value).toBeNull();
  });

  it("เกณฑ์ Tier ใช้ไม่ได้ → tier = null (ไม่พังทั้งหน้า) · ขาดข้อมูลลูกค้า = ข้ามแถว", () => {
    expect(toRegistryRow(raw(4), [], TODAY, "default")?.tier).toBeNull();
    expect(toRegistryRow(raw(5, { customers: null }), RULES, TODAY, "default")).toBeNull();
  });

  it("คอลัมน์ชนิดลูกค้า/สาขา ที่ฐานข้อมูลคืนเป็น array ก็อ่านได้", () => {
    const row = toRegistryRow(
      raw(6, { customers: { name: "ก", branch_id: "b9", customer_types: [{ label: "โรงงาน" }], branches: [{ name: "ปทุม", zones: [{ name: "เขต 2" }] }] } }),
      RULES,
      TODAY,
      "default",
    );
    expect(row?.customerTypeLabel).toBe("โรงงาน");
    expect(row?.zoneName).toBe("เขต 2");
  });
});

describe("matchesPostFilter", () => {
  it("กรอง Tier และสถานะแบบแม่นยำ · tier ว่างไม่ผ่านเมื่อกรองขนาด", () => {
    expect(matchesPostFilter({ tier: "L", status: "active" }, { sizes: ["L", "XL"], statuses: [] })).toBe(true);
    expect(matchesPostFilter({ tier: "S", status: "active" }, { sizes: ["L"], statuses: [] })).toBe(false);
    expect(matchesPostFilter({ tier: null, status: "active" }, { sizes: ["L"], statuses: [] })).toBe(false);
    expect(matchesPostFilter({ tier: "L", status: "near_end" }, { sizes: [], statuses: ["active"] })).toBe(false);
    expect(matchesPostFilter({ tier: null, status: "ended" }, { sizes: [], statuses: [] })).toBe(true);
  });
});

describe("loadRegistryPage (keyset)", () => {
  it("ไม่มีตัวกรองซ้ำ: ดึง limit+1 แถว · เกิน = มีหน้าถัดไป cursor = แถวสุดท้ายที่แสดง", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => raw(i + 1));
    const { client, seen } = fakeClient([rows], [120]);
    const res = await loadRegistryPage(client, ctx, defaultFilters(), "", null, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(seen.limits).toEqual([4]);
    expect(res.data.rows.map((r) => r.contractId)).toEqual(["id-0001", "id-0002", "id-0003"]);
    expect(res.data.next).toEqual({ value: "2026-01-15", id: "id-0003" });
    expect(res.data.dbTotal).toBe(120);
    expect(seen.selects[0]).toEqual({ count: "exact" });
  });

  it("แถวพอดี limit = ไม่มีหน้าถัดไป · หน้าถัดไปไม่นับจำนวนซ้ำ", async () => {
    const { client, seen } = fakeClient([[raw(1), raw(2)]]);
    const res = await loadRegistryPage(client, ctx, defaultFilters(), "", { value: "2026-01-15", id: "x" }, 2);
    expect(res.ok && res.data.next).toBeNull();
    expect(res.ok && res.data.dbTotal).toBeNull();
    expect(seen.selects[0]).toBeUndefined();
  });

  it("กรอง Tier ซ้ำฝั่งแอป: สแกนต่อเป็นก้อนจนครบหน้า · ไม่ตัดเงียบ", async () => {
    // ก้อนที่ 1 (201 แถว = มีแถวเกิน): มี XL 1 แถว · ก้อนที่ 2: มี XL อีก 2 แถว → ครบ limit=3
    const mk = (i: number, v: number) => raw(i, { value_total: v });
    const chunk2 = [mk(4, 200000), mk(5, 1000), mk(6, 300000), mk(7, 5)];
    const big = Array.from({ length: 201 }, (_, i) => mk(100 + i, 1000));
    big[10] = mk(110, 200000);
    const { client } = fakeClient([big, chunk2], [500]);
    const res = await loadRegistryPage(client, ctx, { ...defaultFilters(), sizes: ["XL"] }, "", null, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows.map((r) => r.contractId)).toEqual(["id-0110", "id-0004", "id-0006"]);
    expect(res.data.scanned).toBe(200 + 3); // ก้อนแรก 200 + แถวที่ 4–6 ของก้อนสอง (หยุดเมื่อครบหน้า)
    expect(res.data.next).toEqual({ value: "2026-01-15", id: "id-0006" }); // ก้อนสองยังเหลือแถวที่ 7
  });

  it("กรองซ้ำแล้วไม่ครบหน้า แต่ข้อมูลยังมีต่อ: คืน next ให้กดโหลดเพิ่ม (ไม่แกล้งบอกว่าครบ)", async () => {
    const full = () => Array.from({ length: 201 }, (_, i) => raw(i + 1, { value_total: 1000 })); // ไม่มี XL เลย · มีแถวเกินทุกก้อน
    const { client } = fakeClient([full(), full(), full(), full(), full()], [9999]);
    const res = await loadRegistryPage(client, ctx, { ...defaultFilters(), sizes: ["XL"] }, "", null, 50);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toHaveLength(0);
    expect(res.data.scanned).toBe(5 * 200);
    expect(res.data.next).not.toBeNull();
  });

  it("ข้อมูลหมดระหว่างสแกน: next = null", async () => {
    const { client } = fakeClient([[raw(1, { value_total: 1000 }), raw(2, { value_total: 250000 })]]);
    const res = await loadRegistryPage(client, ctx, { ...defaultFilters(), sizes: ["XL"] }, "", null, 50);
    expect(res.ok && res.data.rows.map((r) => r.contractId)).toEqual(["id-0002"]);
    expect(res.ok && res.data.next).toBeNull();
  });

  it("เลือกสาขาที่ไม่อยู่ในเขต = ผลว่างทันที ไม่ยิง query", async () => {
    const { client, seen } = fakeClient([]);
    const f = { ...defaultFilters(), zones: ["z1"], branches: ["b3"] };
    const refs = { branches: [{ id: "b3", name: "C", zoneId: "z2", zoneName: "เขต 2", zoneOrder: 2 }], tierRules: RULES };
    const res = await loadRegistryPage(client, { refs, today: TODAY }, f, "", null);
    expect(res.ok && res.data.rows).toEqual([]);
    expect(seen.limits).toEqual([]);
  });

  it("error จากฐานข้อมูลคืนเฉพาะ code", async () => {
    const client = {
      from: () => ({ select: () => ({ in: () => ({}), order: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { code: "42501", message: "ข้อมูลลูกค้า" } }) }) }) }) }),
    } as unknown as SupabaseClient;
    const res = await loadRegistryPage(client, ctx, defaultFilters(), "", null);
    expect(res).toEqual({ ok: false, code: "42501" });
  });
});

describe("loadRegistryForExport", () => {
  it("วนทุกหน้าจนหมด · ไม่ตัด", async () => {
    // ไม่มีตัวกรองซ้ำ: chunk = 1000 → คืน 3 แถว (ไม่เกิน) = จบ
    const { client } = fakeClient([[raw(1), raw(2), raw(3)]], [3]);
    const res = await loadRegistryForExport(client, ctx, defaultFilters(), "");
    expect(res.ok && res.data.rows).toHaveLength(3);
    expect(res.ok && res.data.truncated).toBe(false);
  });
});
