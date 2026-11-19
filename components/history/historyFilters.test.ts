import { describe, expect, it } from "vitest";

import { addDays, countActiveFilters, defaultFilters, filtersFromParams, filtersToParams, normalizeFilters } from "./historyFilters";

const TODAY = "2026-11-19";
const U = "11111111-1111-4111-8111-111111111111";

describe("ช่วงวันที่", () => {
  it("ค่าเริ่มต้น 7 วันล่าสุด รวมวันนี้", () => {
    const f = defaultFilters(TODAY);
    expect([f.from, f.to]).toEqual(["2026-11-13", "2026-11-19"]);
  });
  it("addDays ข้ามเดือน/ปี", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("วันเริ่มเลยวันสิ้นสุด → สลับให้", () => {
    const { filters } = normalizeFilters({ ...defaultFilters(TODAY), from: "2026-11-10", to: "2026-11-01" }, TODAY);
    expect([filters.from, filters.to]).toEqual(["2026-11-01", "2026-11-10"]);
  });
  it("เกิน 366 วัน → ตัดวันเริ่ม + clamped", () => {
    const r = normalizeFilters({ ...defaultFilters(TODAY), from: "2020-01-01", to: "2026-11-19" }, TODAY);
    expect(r.clamped).toBe(true);
    expect(r.filters.to).toBe("2026-11-19");
    expect(r.filters.from).toBe("2025-11-19");
  });
  it("วันที่เพี้ยน → กลับค่าเริ่มต้น", () => {
    const r = normalizeFilters({ ...defaultFilters(TODAY), from: "2026-13-40", to: "abc" }, TODAY);
    expect([r.filters.from, r.filters.to]).toEqual(["2026-11-13", "2026-11-19"]);
  });
});

describe("URL", () => {
  it("ค่าเริ่มต้นไม่ใส่อะไรใน URL", () => {
    expect(filtersToParams(defaultFilters(TODAY), TODAY).toString()).toBe("");
  });
  it("ไป-กลับได้ครบทุกตัวกรอง", () => {
    const f = {
      ...defaultFilters(TODAY),
      from: "2026-11-01",
      people: [U],
      branches: [U],
      zones: [U],
      contractId: U,
      months: ["2026-10"],
      kinds: ["service"],
      actions: ["update" as const],
      postCloseOnly: true,
    };
    const back = filtersFromParams(filtersToParams(f, TODAY), TODAY);
    expect(back).toEqual(f);
  });
  it("ค่าที่ไม่ใช่ uuid/enum/เดือนถูกทิ้ง (กัน URL ยัดข้อความ)", () => {
    const p = new URLSearchParams("who=สมชาย&br=abc&c=CT26-1&m=2026-13&k=hack&a=drop&pc=1");
    const f = filtersFromParams(p, TODAY);
    expect(f.people).toEqual([]);
    expect(f.branches).toEqual([]);
    expect(f.contractId).toBeNull();
    expect(f.months).toEqual([]);
    expect(f.kinds).toEqual([]);
    expect(f.actions).toEqual([]);
    expect(f.postCloseOnly).toBe(true);
  });
  it("นับตัวกรองที่ใช้อยู่", () => {
    expect(countActiveFilters(defaultFilters(TODAY), TODAY)).toBe(0);
    expect(countActiveFilters({ ...defaultFilters(TODAY), people: [U], postCloseOnly: true, from: "2026-11-01" }, TODAY)).toBe(3);
  });
});
