import { describe, it, expect } from "vitest";
import { annualValue, tierOf } from "./tier";
import { TIER_RULES } from "./__fixtures__/tierRules";

describe("annualValue", () => {
  it("= มูลค่าสัญญา ÷ จำนวนปี", () => {
    expect(annualValue(150000, 1)).toBe(150000);
    expect(annualValue(150000, 3)).toBe(50000);
    expect(annualValue(50000, 3)).toBeCloseTo(16666.67, 2);
  });
});

describe("tierOf", () => {
  const t = (annual: number) => tierOf(annual, TIER_RULES);
  it("กรณีบังคับจาก SPEC", () => {
    expect(t(annualValue(50000, 3))).toBe("S"); // 16,667 → S3
    expect(t(annualValue(150000, 1))).toBe("XL"); // 150,000 → XL1
    expect(t(annualValue(150000, 3))).toBe("L"); // 50,000 → L3
    expect(t(annualValue(29999.5, 1))).toBe("S"); // 29,999.50 → S1
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
