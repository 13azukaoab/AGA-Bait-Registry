/** DECISIONS 2.119 (แก้จาก 2.49): ป้าย Tier บนหน้าจอ = เกณฑ์ของเดือนปัจจุบันเวลาไทย (ข้อมูลเกณฑ์ชุด 2 เป็นข้อมูลสมมติ) */
import { describe, expect, it } from "vitest";

import { TIER_RULE_VERSIONS } from "@/lib/rules/__fixtures__/tierRules";
import { tierFor } from "./rowCalc";

describe("tierFor — เกณฑ์หลายชุดตามเดือนปัจจุบัน", () => {
  it("เดือนปัจจุบันก่อน/หลังวันเปลี่ยนเกณฑ์ → ใช้ชุดเดิม/ชุดใหม่", () => {
    // 55,000/ปี: ชุดเดิม L (≥50,000) · ชุดใหม่ M (L เริ่ม 60,000)
    expect(tierFor(55000, 12, TIER_RULE_VERSIONS, new Date("2026-12-15T05:00:00Z"))?.label).toBe("L1");
    expect(tierFor(55000, 12, TIER_RULE_VERSIONS, new Date("2027-01-15T05:00:00Z"))?.label).toBe("M1");
    // 330,000 / 3 ปี = 110,000/ปี: ชุดเดิม XL · ชุดใหม่ L (XL เริ่ม 120,000)
    expect(tierFor(330000, 36, TIER_RULE_VERSIONS, new Date("2026-06-15T05:00:00Z"))?.label).toBe("XL3");
    expect(tierFor(330000, 36, TIER_RULE_VERSIONS, new Date("2027-03-02T05:00:00Z"))?.label).toBe("L3");
  });

  it("เดือนเปลี่ยนตามเวลาไทย (UTC 31 ธ.ค. 18:00 = 1 ม.ค. ไทย)", () => {
    expect(tierFor(55000, 12, TIER_RULE_VERSIONS, new Date("2026-12-31T18:00:00Z"))?.label).toBe("M1");
    expect(tierFor(55000, 12, TIER_RULE_VERSIONS, new Date("2026-12-31T16:00:00Z"))?.label).toBe("L1");
  });
});
