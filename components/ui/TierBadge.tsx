/**
 * TierBadge — ป้าย Tier ตามเกณฑ์มูลค่า + จำนวนปีสัญญา (รวม 8 แบบ)
 *  - รับ tier (S/M/L/XL) + years (1/3) แล้วแสดงข้อความ S1, S3, M1 … XL3
 *  - class ต้องเป็น `tier s1` / `tier s3` … ครบ 8 แบบ (ไม่ใช่ `tier s` เฉยๆ)
 *    สีอยู่ที่ `.tier.*` ใน app/globals.css (1 ปี = พื้นอ่อน · 3 ปี = พื้นเข้ม) ห้ามเขียน hex ที่นี่
 *  - เขียน class เป็นข้อความเต็มในตาราง เพื่อให้ค้นหา/grep เจอและ Tailwind สแกนได้
 */
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
  years: TierTermYears;
  className?: string;
};

export function TierBadge({ tier, years, className }: TierBadgeProps) {
  return (
    <span
      className={cx(TIER_CLASS[tier][years], className)}
      title={`Tier ${tier} · สัญญา ${years} ปี`}
    >
      {tier}
      {years}
    </span>
  );
}
