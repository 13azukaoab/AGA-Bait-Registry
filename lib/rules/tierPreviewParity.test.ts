import { describe, expect, it } from "vitest";

import { annualValueForTerm, tierKey } from "./term";
import { tierOf } from "./tier";
import { TIER_RULES } from "./__fixtures__/tierRules";
import type { TierRule } from "./types";

/**
 * M38 (DECISIONS 2.71): ความตรงกันของสูตร Tier ระหว่าง lib/rules กับ SQL
 * `preview_tier_rule_change` / `contract_annual_value` (migration 20261115260000)
 *
 * คู่เทส: supabase/tests/52_settings_gaps.test.sql (กรณีชุดเดียวกัน · ชุดตั้งต้น 30,000 / 50,000 / 100,000)
 * แก้กรณีฝั่งหนึ่ง ต้องแก้อีกฝั่งด้วย
 */
const PARITY_CASES: Array<{ value: number; months: number; key: string }> = [
  { value: 50000, months: 36, key: "s3" },
  { value: 150000, months: 12, key: "xl1" },
  { value: 150000, months: 36, key: "l3" },
  { value: 29999.5, months: 12, key: "s1" },
  { value: 50000, months: 5, key: "l1" }, // Custom → กลุ่ม "1 ปี" · มูลค่าจริง ไม่ขยายต่อปี
  { value: 35000, months: 14, key: "m1" }, // × 12 ÷ 14 = 30,000 พอดี (ไม่ตกใต้เส้น)
];

/** ชุดหลังแก้ในเทส SQL: L เริ่ม 60,000 (ข้อมูลสมมติ) */
const MOVED_RULES: TierRule[] = TIER_RULES.map((r) => (r.tier === "L" ? { ...r, minAnnual: 60000 } : r));

function keyOf(value: number, months: number, rules: TierRule[]): string {
  return tierKey(tierOf(annualValueForTerm(value, months), rules), months);
}

describe("M38 tier preview parity with SQL", () => {
  it.each(PARITY_CASES)("$value / $months months → $key", ({ value, months, key }) => {
    expect(keyOf(value, months, TIER_RULES)).toBe(key);
  });

  it("L start 60,000 moves only 50k/5 (l1→m1) and 150k/36 (l3→m3)", () => {
    const moved = PARITY_CASES.map((c) => [keyOf(c.value, c.months, TIER_RULES), keyOf(c.value, c.months, MOVED_RULES)])
      .filter(([from, to]) => from !== to);
    expect(moved).toEqual([
      ["l3", "m3"],
      ["l1", "m1"],
    ]);
  });

  it("annual value matches contract_annual_value cases", () => {
    expect(annualValueForTerm(50000, 5)).toBe(50000);
    expect(annualValueForTerm(35000, 14)).toBe(30000);
    expect(annualValueForTerm(36000, 18)).toBe(24000);
    expect(annualValueForTerm(150000, 12)).toBe(150000);
  });
});
