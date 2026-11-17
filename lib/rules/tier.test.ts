import { describe, it, expect } from "vitest";
import { rulesForMonth, tierOf } from "./tier";
import { annualValueForTerm } from "./term";
import { CHANGE_MONTH, TIER_RULES, TIER_RULE_VERSIONS } from "./__fixtures__/tierRules";

describe("annualValueForTerm (1 ปี = 12 เดือน · 3 ปี = 36 เดือน)", () => {
  it("= มูลค่าสัญญา ÷ จำนวนปี", () => {
    expect(annualValueForTerm(150000, 12)).toBe(150000);
    expect(annualValueForTerm(150000, 36)).toBe(50000);
    expect(annualValueForTerm(50000, 36)).toBeCloseTo(16666.67, 2);
  });
});

describe("tierOf", () => {
  const t = (annual: number) => tierOf(annual, TIER_RULES);
  it("กรณีบังคับจาก SPEC", () => {
    expect(t(annualValueForTerm(50000, 36))).toBe("S"); // 16,667 → S3
    expect(t(annualValueForTerm(150000, 12))).toBe("XL"); // 150,000 → XL1
    expect(t(annualValueForTerm(150000, 36))).toBe("L"); // 50,000 → L3
    expect(t(annualValueForTerm(29999.5, 12))).toBe("S"); // 29,999.50 → S1
  });
  it("ขอบเขตพอดี", () => {
    expect(t(29999.99)).toBe("S");
    expect(t(30000)).toBe("M");
    expect(t(49999.99)).toBe("M");
    expect(t(50000)).toBe("L");
    expect(t(99999.99)).toBe("L");
    expect(t(100000)).toBe("XL");
  });
});

// M20 (DECISIONS 2.31): เกณฑ์มีหลายชุด แต่ละชุดมีเดือนที่เริ่มใช้ → ใช้ชุดล่าสุดที่เริ่มใช้ไม่เกินเดือนที่คำนวณ
describe("rulesForMonth / tierOf ตามเดือน (M20)", () => {
  it("กรณีบังคับจาก SPEC ผ่านทั้งชุดตั้งต้นแบบมีเดือน", () => {
    const t = (annual: number) => tierOf(annual, TIER_RULE_VERSIONS, "2026-11");
    expect(t(annualValueForTerm(50000, 36))).toBe("S"); // S3
    expect(t(annualValueForTerm(150000, 12))).toBe("XL"); // XL1
    expect(t(annualValueForTerm(150000, 36))).toBe("L"); // L3
    expect(t(annualValueForTerm(29999.5, 12))).toBe("S"); // S1
  });

  it("เดือนก่อนเปลี่ยนเกณฑ์ใช้ชุดเดิม · ตั้งแต่เดือนที่เปลี่ยนใช้ชุดใหม่", () => {
    // 35,000/ปี: เกณฑ์เดิม = M · เกณฑ์ใหม่ (สมมติ M เริ่ม 40,000) = S
    expect(tierOf(35000, TIER_RULE_VERSIONS, "2026-12")).toBe("M");
    expect(tierOf(35000, TIER_RULE_VERSIONS, CHANGE_MONTH)).toBe("S");
    expect(tierOf(35000, TIER_RULE_VERSIONS, "2027-06")).toBe("S");
    // 110,000/ปี: เดิม XL · ใหม่ L
    expect(tierOf(110000, TIER_RULE_VERSIONS, "2026-12")).toBe("XL");
    expect(tierOf(110000, TIER_RULE_VERSIONS, CHANGE_MONTH)).toBe("L");
  });

  it("รับเดือนรูปแบบจาก DB ('YYYY-MM-01') ได้ทั้งเดือนที่คำนวณและ effectiveMonth", () => {
    const fromDb = TIER_RULE_VERSIONS.map((r) => ({ ...r, effectiveMonth: `${r.effectiveMonth}-01` }));
    expect(tierOf(35000, fromDb, "2027-01-01")).toBe("S");
    expect(tierOf(35000, fromDb, "2026-12-01")).toBe("M");
  });

  it("rulesForMonth คืนเฉพาะชุดที่ใช้ เรียงตาม minAnnual", () => {
    const set = rulesForMonth(TIER_RULE_VERSIONS, "2027-03");
    expect(set.map((r) => [r.tier, r.minAnnual])).toEqual([
      ["S", 0], ["M", 40000], ["L", 60000], ["XL", 120000],
    ]);
    expect(rulesForMonth(TIER_RULE_VERSIONS, "2026-12").map((r) => r.minAnnual)).toEqual([
      0, 30000, 50000, 100000,
    ]);
  });

  it("เดือนก่อนชุดแรก → throw (ห้ามเดาเกณฑ์)", () => {
    expect(() => tierOf(35000, TIER_RULE_VERSIONS, "1999-12")).toThrow(/ไม่มีเกณฑ์/);
  });

  it("หลายชุดแต่ไม่ส่งเดือน → throw (กันใช้เกณฑ์ปนกัน)", () => {
    expect(() => tierOf(35000, TIER_RULE_VERSIONS)).toThrow(/ระบุเดือน/);
  });

  it("แถวไม่มีเดือน (แบบเดิม) แต่ tier ซ้ำ → throw (อ่านมาหลายชุดโดยไม่มี effective_month)", () => {
    const flat = TIER_RULE_VERSIONS.map(({ tier, minAnnual }) => ({ tier, minAnnual }));
    expect(() => tierOf(35000, flat)).toThrow(/ซ้ำ/);
  });

  it("ชุดเดียวแบบเดิม ส่งเดือนมาด้วยก็ใช้ได้ (ไม่มีเดือน = ใช้ได้ทุกเดือน)", () => {
    expect(tierOf(35000, TIER_RULES, "2026-03")).toBe("M");
  });

  it("ปนแถวมีเดือนกับไม่มีเดือน → throw", () => {
    expect(() => tierOf(35000, [...TIER_RULES, ...TIER_RULE_VERSIONS], "2026-03")).toThrow(/ปน/);
  });
});
