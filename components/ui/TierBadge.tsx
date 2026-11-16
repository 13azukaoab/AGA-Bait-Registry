/**
 * TierBadge — ป้าย Tier ตามเกณฑ์มูลค่า + ระยะสัญญา (รวม 8 แบบ)
 *  - รับ tier (S/M/L/XL) + ระยะ แล้วแสดงข้อความ S1, S3, M1 … XL3
 *  - ระยะส่งได้ 2 แบบ: `years` (1/3 · ป้าย legend ที่ไม่มีสัญญาจริง) หรือ `termMonths` (M30 · เดือนของสัญญา 1–36)
 *    `termMonths` 36 = กลุ่มสี 3 ปี · อื่นทั้งหมด = กลุ่มสี 1 ปี (ตรงกับ `colorGroup` ใน lib/rules)
 *    ระยะ Custom (ไม่ใช่ 12/36 เดือน) ใส่ป้ายเล็ก "Custom" ต่อท้าย · tooltip บอกจำนวนเดือน
 *  - class ต้องเป็น `tier s1` / `tier s3` … ครบ 8 แบบ (ไม่ใช่ `tier s` เฉยๆ)
 *    สีอยู่ที่ `.tier.*` ใน app/globals.css (1 ปี = พื้นอ่อน · 3 ปี = พื้นเข้ม) ห้ามเขียน hex ที่นี่
 *  - เขียน class เป็นข้อความเต็มในตาราง เพื่อให้ค้นหา/grep เจอและ Tailwind สแกนได้
 */
import { colorGroup, isCustomTerm } from "@/lib/rules";

import { cx } from "./cx";

export type TierName = "S" | "M" | "L" | "XL";
export type TierTermYears = 1 | 3;

const TIER_CLASS: Record<TierName, Record<TierTermYears, string>> = {
  S: { 1: "tier s1", 3: "tier s3" },
  M: { 1: "tier m1", 3: "tier m3" },
  L: { 1: "tier l1", 3: "tier l3" },
  XL: { 1: "tier xl1", 3: "tier xl3" },
};

export type TierBadgeProps = {
  tier: TierName;
  className?: string;
} & ({ years: TierTermYears; termMonths?: undefined } | { termMonths: number; years?: undefined });

export function TierBadge({ tier, years, termMonths, className }: TierBadgeProps) {
  const group: TierTermYears = termMonths !== undefined ? (colorGroup(termMonths) === "3" ? 3 : 1) : (years as TierTermYears);
  const custom = termMonths !== undefined && isCustomTerm(termMonths);
  const termText = custom ? `Custom ${termMonths} เดือน` : `${group} ปี`;
  const badge = (
    <span className={cx(TIER_CLASS[tier][group], className)} title={`Tier ${tier} · สัญญา ${termText}`}>
      {tier}
      {group}
    </span>
  );
  if (!custom) return badge; // 1 ปี / 3 ปี = ป้ายเดิมทุกอย่าง (ไม่ห่อเพิ่ม)
  return (
    <span className="inline-flex items-center gap-1">
      {badge}
      <span className="text-[10px] leading-none text-fg-muted" title={`สัญญา ${termMonths} เดือน`}>
        Custom
      </span>
    </span>
  );
}
