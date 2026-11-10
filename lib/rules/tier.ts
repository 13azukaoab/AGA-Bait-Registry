import type { Tier, TierRule } from "./types";

/** มูลค่าต่อปี = มูลค่าสัญญา ÷ จำนวนปี (SPEC §7.1) */
export function annualValue(valueTotal: number, termYears: number): number {
  return valueTotal / termYears;
}

/** เลือก tier ที่ minAnnual <= annual สูงสุด (เกณฑ์มาจาก tier_rules เท่านั้น ห้าม hardcode) */
export function tierOf(annual: number, rules: TierRule[]): Tier {
  const sorted = [...rules].sort((a, b) => a.minAnnual - b.minAnnual);
  const first = sorted[0];
  if (!first) throw new Error("tierOf: rules ว่าง (ต้องมีอย่างน้อย 1 เกณฑ์)");
  let picked: Tier = first.tier;
  for (const r of sorted) {
    if (annual >= r.minAnnual) picked = r.tier;
    else break;
  }
  return picked;
}
