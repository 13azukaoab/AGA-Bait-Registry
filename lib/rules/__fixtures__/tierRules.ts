import type { TierRule } from "../types";

/** ตรงกับตาราง tier_rules ใน DB (SPEC §7.1) — ใช้เฉพาะในเทส · ชุดเดียว ไม่ระบุเดือน (แบบเดิมก่อน M20) */
export const TIER_RULES: TierRule[] = [
  { tier: "S", minAnnual: 0 },
  { tier: "M", minAnnual: 30000 },
  { tier: "L", minAnnual: 50000 },
  { tier: "XL", minAnnual: 100000 },
];

/** M20: ชุดตั้งต้นใน DB (`effective_month = 2000-01-01` — ค่าเดียวกับ TIER_RULES) */
export const BASELINE_MONTH = "2000-01";

/** M20: เดือนที่เกณฑ์ใหม่เริ่มใช้ — **ข้อมูลสมมติสำหรับเทส** ไม่ใช่เกณฑ์จริง */
export const CHANGE_MONTH = "2027-01";

/**
 * M20 (DECISIONS 2.31): หลายชุดพร้อมเดือนที่เริ่มใช้ — รูปเดียวกับแถวที่อ่านจาก `tier_rules` ทั้งตาราง
 * ชุด 2027-01 เป็น **ข้อมูลสมมติ** (M 40,000 · L 60,000 · XL 120,000) ใช้ทดสอบการเลือกชุดตามเดือนเท่านั้น
 */
export const TIER_RULE_VERSIONS: TierRule[] = [
  ...TIER_RULES.map((r) => ({ ...r, effectiveMonth: BASELINE_MONTH })),
  { tier: "S", minAnnual: 0, effectiveMonth: CHANGE_MONTH },
  { tier: "M", minAnnual: 40000, effectiveMonth: CHANGE_MONTH },
  { tier: "L", minAnnual: 60000, effectiveMonth: CHANGE_MONTH },
  { tier: "XL", minAnnual: 120000, effectiveMonth: CHANGE_MONTH },
];

/**
 * XXL (DECISIONS 2.115): ชุดเกณฑ์ 5 แถว — XXL เริ่ม 300,000/ปี (ค่าตั้งต้นที่เจ้าของให้ · ใช้ในเทสเท่านั้น
 * ค่าจริงอ่านจาก tier_rules เสมอ ห้าม hardcode ในโค้ด)
 */
export const TIER_RULES_XXL: TierRule[] = [...TIER_RULES, { tier: "XXL", minAnnual: 300000 }];

/** XXL: เดือนที่ชุดเกณฑ์ที่มี XXL เริ่มใช้ — **ข้อมูลสมมติสำหรับเทส** */
export const XXL_MONTH = "2027-01";

/** XXL: ชุดตั้งต้น 4 แถว (ไม่มี XXL) + ชุด 2027-01 ที่มี XXL 300,000 — รูปเดียวกับแถวจาก tier_rules ทั้งตาราง */
export const TIER_RULE_VERSIONS_XXL: TierRule[] = [
  ...TIER_RULES.map((r) => ({ ...r, effectiveMonth: BASELINE_MONTH })),
  ...TIER_RULES_XXL.map((r) => ({ ...r, effectiveMonth: XXL_MONTH })),
];
