import { describe, expect, it } from "vitest";

import { daysBetween, dbStatusesFor, fmtDate, NEAR_END_DAYS, registryStatus, remainingOf, tierLegend } from "./registryStatus";

const TODAY = "2026-11-20";

describe("registryStatus (การแสดงสถานะสัญญา)", () => {
  it("สถานะในฐานข้อมูลที่ไม่ขึ้นกับวันที่ แปลงตรงๆ", () => {
    expect(registryStatus("cancelled", "2030-01-01", TODAY)).toBe("cancelled");
    expect(registryStatus("paused", "2030-01-01", TODAY)).toBe("paused");
    expect(registryStatus("expired_pending_collection", "2026-01-01", TODAY)).toBe("pending_collection");
    expect(registryStatus("closed", "2030-01-01", TODAY)).toBe("ended");
  });

  it("active: เหลือ > 90 วัน = Active · ≤ 90 วัน = ใกล้หมด · จบแล้ว = หมดสัญญา", () => {
    expect(registryStatus("active", "2027-12-31", TODAY)).toBe("active");
    expect(registryStatus("active", "2027-02-18", TODAY)).toBe("near_end"); // เหลือ 90 วันพอดี
    expect(daysBetween(TODAY, "2027-02-18")).toBe(NEAR_END_DAYS);
    expect(registryStatus("active", "2027-02-19", TODAY)).toBe("active"); // 91 วัน
    expect(registryStatus("active", TODAY, TODAY)).toBe("near_end"); // หมดวันนี้ ยังไม่นับว่าจบ
    expect(registryStatus("active", "2026-11-19", TODAY)).toBe("ended");
  });

  it("dbStatusesFor: บีบผลฝั่งฐานข้อมูล · ไม่เลือก = ไม่กรอง", () => {
    expect(dbStatusesFor([])).toBeNull();
    expect(dbStatusesFor(["active", "near_end"])).toEqual(["active"]);
    expect(new Set(dbStatusesFor(["ended"]))).toEqual(new Set(["closed", "active"]));
    expect(dbStatusesFor(["pending_collection"])).toEqual(["expired_pending_collection"]);
    expect(new Set(dbStatusesFor(["paused", "cancelled", "pending_collection"]))).toEqual(new Set(["paused", "cancelled", "expired_pending_collection"]));
  });

  it("fmtDate เป็น DD/MM/YYYY (ค.ศ.)", () => {
    expect(fmtDate("2026-01-05")).toBe("05/01/2026");
  });
});

describe("remainingOf", () => {
  it("เหลือปี/เดือน + วันหมด + เปอร์เซ็นต์ที่ผ่านไป", () => {
    const r = remainingOf("2026-01-01", "2027-12-31", TODAY, "active");
    expect(r.text).toBe("เหลือ 1 ปี 1 เดือน · หมด 31/12/2027");
    expect(r.tone).toBe("ok");
    expect(r.percent).toBeGreaterThan(40);
    expect(r.percent).toBeLessThan(60);
  });

  it("ใกล้หมด = โทน warn · หมดแล้ว = โทน end + จำนวนวัน · หมดวันนี้", () => {
    expect(remainingOf("2026-01-01", "2026-12-31", TODAY, "near_end").tone).toBe("warn");
    const ended = remainingOf("2025-01-01", "2026-11-10", TODAY, "ended");
    expect(ended.tone).toBe("end");
    expect(ended.text).toBe("หมดแล้ว 10 วัน · หมด 10/11/2026");
    expect(ended.percent).toBe(100);
    expect(remainingOf("2025-11-21", TODAY, TODAY, "near_end").text).toBe("หมดวันนี้ · หมด 20/11/2026");
  });

  it("เหลือไม่ถึงเดือน แสดงเป็นวัน · วันเริ่มหลังวันนี้ = 0%", () => {
    expect(remainingOf("2026-06-01", "2026-12-05", TODAY, "near_end").text).toBe("เหลือ 15 วัน · หมด 05/12/2026");
    expect(remainingOf("2027-01-01", "2027-12-31", TODAY, "active").percent).toBe(0);
  });
});

describe("tierLegend", () => {
  const rules = [
    { tier: "S" as const, minAnnual: 0 },
    { tier: "M" as const, minAnnual: 30000 },
    { tier: "L" as const, minAnnual: 50000 },
    { tier: "XL" as const, minAnnual: 100000 },
  ];
  it("อ่านช่วงจากเกณฑ์ ไม่ hardcode", () => {
    expect(tierLegend(rules, "2026-11")).toEqual([
      { tier: "S", text: "< 30,000/ปี" },
      { tier: "M", text: "30,000–49,999" },
      { tier: "L", text: "50,000–99,999" },
      { tier: "XL", text: "≥ 100,000" },
    ]);
  });
  it("เกณฑ์ใช้กับเดือนนั้นไม่ได้ = ว่าง (ไม่พัง)", () => {
    expect(tierLegend([{ tier: "S", minAnnual: 0, effectiveMonth: "2027-01" }], "2026-11")).toEqual([]);
  });
});
