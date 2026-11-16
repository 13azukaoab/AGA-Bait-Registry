/**
 * อ่านเกณฑ์ Tier ทุกชุดจากตาราง `tier_rules` (M20 · DECISIONS 2.31 / 2.49)
 *
 * Logic summary:
 *   * `tier_rules` เก็บได้หลายชุด (1 ชุด = 4 แถว S/M/L/XL ที่ `effective_month` เดียวกัน)
 *   * หน้าจอทุกหน้าอ่าน "ทุกชุดพร้อม effective_month" ด้วย query เดียว (ตารางเล็ก) แล้วเลือกชุดตามเดือน
 *     ด้วย `rulesForMonth` / `tierOf(annual, rules, month)` ใน `lib/rules` — ไม่ต้องยิง RPC ต่อเดือน
 *   * ป้าย Tier ของสัญญา = เกณฑ์ของ "เดือนเริ่มสัญญา" (2.49 ②) · ยังไม่มีวันเริ่ม = เกณฑ์ของเดือนปัจจุบัน
 *   * ห้าม hardcode เกณฑ์ (CLAUDE.md กฎ 3)
 */
import type { TierRule } from "@/lib/rules";

/** คอลัมน์ที่ต้อง select — ต้องมี effective_month เสมอ ไม่งั้น rulesForMonth จะ throw เมื่อมีหลายชุด */
export const TIER_RULE_COLUMNS = "tier, min_annual, effective_month";

export interface TierRuleRow {
  tier: TierRule["tier"];
  min_annual: number | string;
  effective_month: string | null;
}

export function toTierRules(rows: readonly TierRuleRow[]): TierRule[] {
  return rows.map((r) => ({
    tier: r.tier,
    minAnnual: Number(r.min_annual),
    ...(r.effective_month ? { effectiveMonth: r.effective_month } : {}),
  }));
}
