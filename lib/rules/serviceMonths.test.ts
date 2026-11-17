import { describe, it, expect } from "vitest";
import { serviceMonthsForTerm, defaultEndDateForTerm } from "./term";

// กรณีบังคับ CLAUDE.md (เดือนบริการ = เดือนเริ่ม + term_months · ไม่ใช้วันสิ้นสุด)
// M30b: ฟังก์ชันแบบ "ปี" (serviceMonths / defaultEndDate) ถูกลบแล้ว → 1 ปี = 12 เดือน · 3 ปี = 36 เดือน
describe("serviceMonthsForTerm (12 = 1 ปี · 36 = 3 ปี)", () => {
  it("นับจากเดือนเริ่ม ต่อเนื่อง term_months เดือน ไม่ใช้วันสิ้นสุด", () => {
    expect(serviceMonthsForTerm("2026-01-15", 12)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]);
    expect(serviceMonthsForTerm("2026-04-03", 12)).toEqual([
      "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
      "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03",
    ]);
    expect(serviceMonthsForTerm("2026-01-01", 36)).toHaveLength(36);
    expect(serviceMonthsForTerm("2026-01-01", 36)[0]).toBe("2026-01");
    expect(serviceMonthsForTerm("2026-01-01", 36)[35]).toBe("2028-12");
  });
  it("Custom 5 เดือน: 15/01/2026 → ม.ค.–พ.ค. 2026", () => {
    expect(serviceMonthsForTerm("2026-01-15", 5)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
  });
});

describe("defaultEndDateForTerm", () => {
  it("= วันเริ่ม + N เดือน − 1 วัน", () => {
    expect(defaultEndDateForTerm("2026-01-01", 12)).toBe("2026-12-31");
    expect(defaultEndDateForTerm("2026-01-15", 12)).toBe("2027-01-14");
    expect(defaultEndDateForTerm("2026-01-01", 36)).toBe("2028-12-31");
    expect(defaultEndDateForTerm("2026-01-15", 5)).toBe("2026-06-14");
  });
});
