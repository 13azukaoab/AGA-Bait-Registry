import { describe, expect, it } from "vitest";

import {
  buildTrend,
  changePct,
  filterRows,
  groupByMonth,
  parseMonthKey,
  rankBranches,
  shiftMonth,
  sumFields,
  sumMetrics,
  type SummaryRow,
} from "./calc";

const row = (over: Partial<SummaryRow>): SummaryRow => ({
  ym: "2026-09", zone: "เขต 1", branch: "พุทธมณฑล", division: "central",
  s1: 0, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
  cust: 0, vS: 0, vM: 0, vL: 0, vXL: 0, value: 0,
  ...over,
});

const A = row({ branch: "พุทธมณฑล", s1: 2, s3: 1, m1: 1, cust: 4, vS: 100, vM: 50, value: 150 });
const B = row({ branch: "เชียงใหม่", zone: "เขต 7", division: "province", s1: 1, xl1: 1, cust: 2, vS: 20, vXL: 200, value: 220 });
const none = new Set<never>();

describe("parseMonthKey", () => {
  it("รับ YYYY-MM", () => expect(parseMonthKey("2026-09")).toEqual({ ym: "2026-09", key: "SEP.26" }));
  it("รับ MMM.YY (ไม่สนตัวพิมพ์)", () => {
    expect(parseMonthKey("SEP.26")).toEqual({ ym: "2026-09", key: "SEP.26" });
    expect(parseMonthKey("jan.25")).toEqual({ ym: "2025-01", key: "JAN.25" });
  });
  it("อ่านไม่ออก → null", () => {
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("ABC.26")).toBeNull();
    expect(parseMonthKey("")).toBeNull();
  });
});

describe("shiftMonth", () => {
  it("ข้ามปี", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-09", -12)).toBe("2025-09");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("changePct", () => {
  it("คำนวณ % และคืน null เมื่อไม่มีฐาน", () => {
    expect(changePct(110, 100)).toBeCloseTo(10);
    expect(changePct(90, 100)).toBeCloseTo(-10);
    expect(changePct(5, 0)).toBeNull();
    expect(changePct(5, null)).toBeNull();
  });
});

describe("sumMetrics / กรอง Tier", () => {
  it("ไม่เลือก Tier = ใช้ value/cust รวม", () => {
    expect(sumMetrics([A, B], none)).toEqual({ value: 370, cust: 6, branches: 2 });
  });
  it("เลือก S → เฉพาะ vS และ s1+s3", () => {
    expect(sumMetrics([A, B], new Set(["S" as const]))).toEqual({ value: 120, cust: 4, branches: 2 });
  });
  it("เลือก XL → เฉพาะ vXL และ xl1+xl3", () => {
    expect(sumMetrics([A, B], new Set(["XL" as const]))).toEqual({ value: 200, cust: 1, branches: 2 });
  });
});

describe("filterRows", () => {
  it("กรองหน่วยงาน/เขต/สาขา", () => {
    expect(filterRows([A, B], { division: "province", zone: "all", branch: "all" })).toEqual([B]);
    expect(filterRows([A, B], { division: "all", zone: "เขต 1", branch: "all" })).toEqual([A]);
    expect(filterRows([A, B], { division: "all", zone: "all", branch: "เชียงใหม่" })).toEqual([B]);
  });
});

describe("rankBranches", () => {
  it("เรียงมูลค่ามาก→น้อย และคิด MoM ต่อสาขา", () => {
    const prev = [row({ branch: "เชียงใหม่", zone: "เขต 7", division: "province", value: 110 })];
    const r = rankBranches([A, B], prev, none, "value");
    expect(r.map((x) => x.branch)).toEqual(["เชียงใหม่", "พุทธมณฑล"]);
    expect(r[0]?.mom).toBeCloseTo(100);
    expect(r[1]?.mom).toBeNull();
  });
  it("เรียงตามจำนวนลูกค้า", () => {
    expect(rankBranches([A, B], [], none, "cust").map((x) => x.branch)).toEqual(["พุทธมณฑล", "เชียงใหม่"]);
  });
});

describe("buildTrend / groupByMonth", () => {
  it("แยกยอดส่วนกลาง/ต่างจังหวัดรายเดือน เรียงเก่า→ใหม่", () => {
    const byMonth = groupByMonth([A, B, row({ ym: "2026-08", value: 70 })]);
    const t = buildTrend(byMonth, { zone: "all", branch: "all" }, none);
    expect(t.map((p) => p.key)).toEqual(["AUG.26", "SEP.26"]);
    expect(t[0]).toMatchObject({ central: 70, province: 0 });
    expect(t[1]).toMatchObject({ central: 150, province: 220 });
  });
});

describe("sumFields", () => {
  it("รวมทุกฟิลด์", () => {
    const t = sumFields([A, B]);
    expect(t).toMatchObject({ s1: 3, s3: 1, m1: 1, xl1: 1, cust: 6, vS: 120, vXL: 200, value: 370 });
  });
});
