import type { TierRule } from "../types";

/** ตรงกับตาราง tier_rules ใน DB (SPEC §7.1) — ใช้เฉพาะในเทส */
export const TIER_RULES: TierRule[] = [
  { tier: "S", minAnnual: 0 },
  { tier: "M", minAnnual: 30000 },
  { tier: "L", minAnnual: 50000 },
  { tier: "XL", minAnnual: 100000 },
];
