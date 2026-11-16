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
