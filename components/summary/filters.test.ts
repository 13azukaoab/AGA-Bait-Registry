import { describe, expect, it } from "vitest";

import type { Tier } from "./calc";
import { defaultFilters, isDefaultFilters, type SummaryFilters } from "./filters";

const months = ["2026-09", "2026-08", "2026-07"];

describe("defaultFilters", () => {
  it("เดือนเริ่มต้น = เดือนล่าสุด (ตัวแรก) · ที่เหลือ = ทั้งหมด", () => {
    expect(defaultFilters(months)).toEqual({
      month: "2026-09",
      division: "all",
      zone: "all",
      branch: "all",
      tiers: new Set(),
      sortBy: "value",
    });
  });
  it("ไม่มีเดือนเลย → เดือนว่าง", () => {
    expect(defaultFilters([]).month).toBe("");
  });
});

describe("isDefaultFilters", () => {
  const base = (): SummaryFilters => defaultFilters(months);
  it("ค่าเริ่มต้น → true", () => {
    expect(isDefaultFilters(base(), months)).toBe(true);
  });
  it.each<[string, Partial<SummaryFilters>]>([
    ["เดือน", { month: "2026-08" }],
    ["หน่วยงาน", { division: "central" }],
    ["เขต", { zone: "เขต 1" }],
    ["สาขา", { branch: "หัวหิน" }],
    ["Tier", { tiers: new Set<Tier>(["S"]) }],
    ["การเรียง", { sortBy: "cust" }],
  ])("ต่างที่ %s → false", (_name, over) => {
    expect(isDefaultFilters({ ...base(), ...over }, months)).toBe(false);
  });
});
