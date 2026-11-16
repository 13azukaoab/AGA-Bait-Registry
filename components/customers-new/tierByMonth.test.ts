/** M20 / DECISIONS 2.49: ป้าย Tier ของสัญญา = เกณฑ์ของเดือนเริ่มสัญญา (ข้อมูลเกณฑ์ชุด 2 เป็นข้อมูลสมมติ) */
import { describe, expect, it } from "vitest";

import { TIER_RULE_VERSIONS } from "@/lib/rules/__fixtures__/tierRules";
import { toTierRules } from "@/lib/tierRules";
import { tierFor } from "./rowCalc";

describe("tierFor — เกณฑ์หลายชุดตามเดือนเริ่มสัญญา", () => {
  it("สัญญาเริ่มก่อนวันเปลี่ยนเกณฑ์ ใช้ชุดเดิม · เริ่มหลังใช้ชุดใหม่", () => {
    // 55,000/ปี: ชุดเดิม L (≥50,000) · ชุดใหม่ M (L เริ่ม 60,000)
    expect(tierFor(55000, 1, TIER_RULE_VERSIONS, "2026-12-31")?.label).toBe("L1");
    expect(tierFor(55000, 1, TIER_RULE_VERSIONS, "2027-01-01")?.label).toBe("M1");
    // 330,000 / 3 ปี = 110,000/ปี: ชุดเดิม XL (≥100,000) · ชุดใหม่ L (XL เริ่ม 120,000)
    expect(tierFor(330000, 3, TIER_RULE_VERSIONS, "2026-06-15")?.label).toBe("XL3");
    expect(tierFor(330000, 3, TIER_RULE_VERSIONS, "2027-03-02")?.label).toBe("L3");
  });

  it("ไม่มีวันเริ่ม/วันเริ่มไม่ถูกต้อง → ใช้เกณฑ์ของเดือนปัจจุบัน", () => {
    const before = new Date("2026-11-16T05:00:00Z");
    const after = new Date("2027-02-10T05:00:00Z");
    expect(tierFor(55000, 1, TIER_RULE_VERSIONS, "", before)?.label).toBe("L1");
    expect(tierFor(55000, 1, TIER_RULE_VERSIONS, null, after)?.label).toBe("M1");
    expect(tierFor(55000, 1, TIER_RULE_VERSIONS, "2027-02-31", after)?.label).toBe("M1");
  });

  it("เดือนเปลี่ยนตามเวลาไทย (UTC 31 ธ.ค. 18:00 = 1 ม.ค. ไทย)", () => {
    const thaiNewYear = new Date("2026-12-31T18:00:00Z");
    expect(tierFor(55000, 1, TIER_RULE_VERSIONS, null, thaiNewYear)?.label).toBe("M1");
  });
});

describe("toTierRules", () => {
  it("แปลงแถว DB พร้อม effective_month → effectiveMonth และ min_annual เป็นตัวเลข", () => {
    const rules = toTierRules([
      { tier: "S", min_annual: "0", effective_month: "2000-01-01" },
      { tier: "M", min_annual: "30000.00", effective_month: "2000-01-01" },
    ]);
    expect(rules).toEqual([
      { tier: "S", minAnnual: 0, effectiveMonth: "2000-01-01" },
      { tier: "M", minAnnual: 30000, effectiveMonth: "2000-01-01" },
    ]);
  });
});
