/**
 * Tier XXL (DECISIONS 2.112 / 2.115) — tierOf · versioning ตามเดือน · คีย์ป้าย/คีย์ Dashboard · snapshot รวม XL
 * คู่เทส SQL: supabase/tests/65_tier_xxl.test.sql (กรณี 300,000/12 · 900,000/36 · 299,999.99/12 · 300,000/5)
 * เกณฑ์ในเทสมาจาก fixtures (ข้อมูลสมมติ) — โค้ดจริงอ่านจาก tier_rules เสมอ
 */
import { describe, expect, it } from "vitest";

import { buildBranchSnapshot } from "./snapshot";
import { annualValueForTerm, dashboardTier, dashboardTierKey, tierKey } from "./term";
import { tierOf } from "./tier";
import {
  BASELINE_MONTH,
  TIER_RULES,
  TIER_RULES_XXL,
  TIER_RULE_VERSIONS_XXL,
  XXL_MONTH,
} from "./__fixtures__/tierRules";
import type { BranchRef, Contract, TierRule } from "./types";

const keyOf = (value: number, months: number, rules: TierRule[] = TIER_RULES_XXL, month?: string) =>
  tierKey(tierOf(annualValueForTerm(value, months), rules, month), months);

describe("tierOf + XXL (2.115)", () => {
  it.each([
    { value: 300000, months: 12, key: "xxl1" }, // บังคับ: 300,000 / 1 ปี → XXL1
    { value: 900000, months: 36, key: "xxl3" }, // บังคับ: 900,000 / 3 ปี → XXL3 (÷ 3 = 300,000)
    { value: 299999.99, months: 12, key: "xl1" }, // บังคับ: 299,999.99 / 1 ปี → XL1
    { value: 899999.97, months: 36, key: "xl3" }, // ÷ 3 = 299,999.99 → XL3
    { value: 300000, months: 5, key: "xxl1" }, // Custom < 12 เดือน = มูลค่าจริง · กลุ่ม "1 ปี"
    { value: 299999.99, months: 5, key: "xl1" },
    { value: 175000, months: 7, key: "xl1" }, // Custom: ไม่ขยายเป็นต่อปี (ไม่ใช่ 300,000)
    { value: 420000, months: 14, key: "xxl1" }, // × 12 ÷ 14 = 360,000 → XXL · Custom ≥ 12 เดือน กลุ่ม "1 ปี"
    { value: 1000000, months: 12, key: "xxl1" },
  ])("$value / $months เดือน → $key", ({ value, months, key }) => {
    expect(keyOf(value, months)).toBe(key);
  });

  it("กรณีบังคับเดิมใน CLAUDE.md ไม่เปลี่ยนเมื่อชุดเกณฑ์มี XXL", () => {
    expect(keyOf(50000, 36)).toBe("s3");
    expect(keyOf(150000, 12)).toBe("xl1");
    expect(keyOf(150000, 36)).toBe("l3");
    expect(keyOf(29999.5, 12)).toBe("s1");
    expect(keyOf(50000, 5)).toBe("l1");
  });

  it("ชุดเกณฑ์ไม่มีแถว XXL → ไม่มีสัญญา XXL (มูลค่าสูงแค่ไหนก็ XL)", () => {
    expect(keyOf(300000, 12, TIER_RULES)).toBe("xl1");
    expect(keyOf(9000000, 36, TIER_RULES)).toBe("xl3");
  });

  it("versioning: XXL มีผลตั้งแต่เดือนที่ชุดเกณฑ์เริ่มใช้ · เดือนก่อนหน้า (รวมเดือนที่ปิดแล้ว) คงเดิม", () => {
    expect(tierOf(400000, TIER_RULE_VERSIONS_XXL, "2026-12")).toBe("XL");
    expect(tierOf(400000, TIER_RULE_VERSIONS_XXL, BASELINE_MONTH)).toBe("XL");
    expect(tierOf(400000, TIER_RULE_VERSIONS_XXL, XXL_MONTH)).toBe("XXL");
    expect(tierOf(400000, TIER_RULE_VERSIONS_XXL, "2027-06")).toBe("XXL");
    expect(tierOf(299999.99, TIER_RULE_VERSIONS_XXL, XXL_MONTH)).toBe("XL");
  });
});

describe("คีย์ป้าย / คีย์ Dashboard", () => {
  it("tierKey แยก XXL (ป้ายในระบบ Registry)", () => {
    expect(tierKey("XXL", 12)).toBe("xxl1");
    expect(tierKey("XXL", 36)).toBe("xxl3");
    expect(tierKey("XXL", 5)).toBe("xxl1");
  });

  it("dashboardTier / dashboardTierKey: XXL รวมเข้า XL · tier อื่นคงเดิม (2.112)", () => {
    expect(dashboardTier("XXL")).toBe("XL");
    expect((["S", "M", "L", "XL"] as const).map(dashboardTier)).toEqual(["S", "M", "L", "XL"]);
    expect(dashboardTierKey("XXL", 12)).toBe("xl1");
    expect(dashboardTierKey("XXL", 36)).toBe("xl3");
    expect(dashboardTierKey("XXL", 7)).toBe("xl1");
    expect(dashboardTierKey("M", 36)).toBe("m3");
  });
});

describe("buildBranchSnapshot + XXL (รูปแบบ dashboard_data.json ไม่เปลี่ยน · 2.112)", () => {
  const branch: BranchRef = { area: "เขต 1", branch: "นครปฐม" };
  const contracts: Contract[] = [
    { id: "x1", startDate: "2027-01-01", termMonths: 12, valueTotal: 300000 }, // XXL1 → xl1
    { id: "x3", startDate: "2027-01-01", termMonths: 36, valueTotal: 900000 }, // XXL3 → xl3
    { id: "xc", startDate: "2027-01-01", termMonths: 5, valueTotal: 350000 }, // XXL1 (Custom) → xl1
    { id: "l1", startDate: "2027-01-01", termMonths: 12, valueTotal: 299999.99 }, // XL1
    { id: "l3", startDate: "2027-01-01", termMonths: 36, valueTotal: 450000 }, // XL3
    { id: "s3", startDate: "2027-01-01", termMonths: 36, valueTotal: 50000 }, // S3
  ];
  const EXPECTED_KEYS = [
    "area", "branch", "s1", "s3", "m1", "m3", "l1", "l3", "xl1", "xl3",
    "cust", "vS", "vM", "vL", "vXL", "value", "value_annual",
  ].sort();

  it("คีย์ของแถวเท่าเดิม (16 ฟิลด์ Dashboard + value_annual) · ไม่มี xxl / vXXL", () => {
    const row = buildBranchSnapshot(branch, contracts, "2027-03", TIER_RULE_VERSIONS_XXL);
    expect(Object.keys(row).sort()).toEqual(EXPECTED_KEYS);
    expect(Object.keys(row).some((k) => /xxl/i.test(k))).toBe(false);
  });

  it("XXL1 นับเข้า xl1 · XXL3 เข้า xl3 · มูลค่า XXL เข้า vXL", () => {
    const row = buildBranchSnapshot(branch, contracts, "2027-03", TIER_RULE_VERSIONS_XXL);
    expect(row.xl1).toBe(3); // x1 + xc + l1
    expect(row.xl3).toBe(2); // x3 + l3
    expect(row.s3).toBe(1);
    expect(row.vXL).toBeCloseTo(300000 + 900000 + 350000 + 299999.99 + 450000, 2);
    expect(row.vS).toBe(50000);
    expect(row.cust).toBe(6);
    expect(row.value).toBeCloseTo(row.vS + row.vM + row.vL + row.vXL, 2);
  });

  it("ผลเท่ากับชุดเกณฑ์ที่ไม่มี XXL ทุกช่อง (XXL แค่แยกป้าย ไม่เปลี่ยนตัวเลข Dashboard)", () => {
    const withXxl = buildBranchSnapshot(branch, contracts, "2027-03", TIER_RULES_XXL);
    const withoutXxl = buildBranchSnapshot(branch, contracts, "2027-03", TIER_RULES);
    expect(withXxl).toEqual(withoutXxl);
  });

  it("เดือนก่อนชุดที่มี XXL ใช้ชุดเดิม (ตัวเลขเหมือนไม่มี XXL)", () => {
    const old: Contract[] = contracts.map((c) => ({ ...c, startDate: "2026-06-01" }));
    const row = buildBranchSnapshot(branch, old, "2026-10", TIER_RULE_VERSIONS_XXL);
    expect(row).toEqual(buildBranchSnapshot(branch, old, "2026-10", TIER_RULES));
  });
});
