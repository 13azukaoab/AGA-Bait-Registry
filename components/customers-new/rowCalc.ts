/**
 * ช่องคำนวณของแถวในตารางเปิดงาน (แสดงอย่างเดียว ผู้ใช้ไม่กรอก)
 *
 * Logic summary:
 *   * สูตรทั้งหมดเรียก `lib/rules` เท่านั้น (annualValue / tierOf / defaultEndDate / serviceMonths)
 *   * เกณฑ์ Tier รับเป็นพารามิเตอร์ `rules` ที่อ่านจากตาราง `tier_rules` — ห้าม hardcode
 *   * มูลค่า = ช่องเดียว + ระยะ 1/3 ปี (ช่อง "1 ปี"/"3 ปี" ใน mockup ระบบเลือกแสดงตามระยะ)
 *   * วันสิ้นสุด: ค่าเริ่มต้น = วันเริ่ม + N ปี − 1 วัน · ถ้าผู้ใช้แก้แล้วไม่ตรง = เตือน (ไม่บล็อก)
 */
import {
  annualValue,
  tierOf,
  serviceMonths,
  type TermYears,
  type TierRule,
} from "@/lib/rules";
import { defaultEndDate } from "@/lib/rules/serviceMonths";

/** key ของป้าย Tier 8 แบบ เช่น `s1`, `xl3` (ตรงกับ class `tier s1`) */
export type TierKey = "s1" | "s3" | "m1" | "m3" | "l1" | "l3" | "xl1" | "xl3";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' ที่เป็นวันจริงในปฏิทิน (กันวัน 31 ก.พ. ฯลฯ) */
export function isRealIsoDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** ปีที่ยอมรับได้ของวันที่ในสัญญา (กัน typo เช่น 8202) */
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

export function isPlausibleDate(iso: string): boolean {
  if (!isRealIsoDate(iso)) return false;
  const y = Number(iso.slice(0, 4));
  return y >= YEAR_MIN && y <= YEAR_MAX;
}

/** แปลงข้อความมูลค่าที่ผู้ใช้พิมพ์ ("33,426.80") เป็นตัวเลข · ว่าง/ไม่ใช่ตัวเลข/≤0 = null */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 ? n : null;
}

/** ตัวเลข → ข้อความมีคอมมา 2 ตำแหน่ง เช่น 33426.8 → "33,426.80" */
export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface TierResult {
  tier: "S" | "M" | "L" | "XL";
  key: TierKey;
  label: string; // เช่น "S1"
  annual: number;
}

/** Tier + ปี → ป้าย 8 แบบ · ข้อมูลไม่ครบ = null */
export function tierFor(
  valueTotal: number | null,
  termYears: TermYears | null,
  rules: TierRule[],
): TierResult | null {
  if (valueTotal === null || termYears === null || rules.length === 0) return null;
  const annual = annualValue(valueTotal, termYears);
  const tier = tierOf(annual, rules);
  const key = `${tier.toLowerCase()}${termYears}` as TierKey;
  return { tier, key, label: `${tier}${termYears}`, annual };
}

/** วันสิ้นสุดอัตโนมัติ · วันเริ่มไม่ใช่วันจริง = null */
export function autoEndDate(startDate: string, termYears: TermYears): string | null {
  return isPlausibleDate(startDate) ? defaultEndDate(startDate, termYears) : null;
}

/** จำนวนวันของสัญญา (นับรวมวันเริ่มและวันสิ้นสุด) · วันที่ไม่ถูกต้อง = null */
export function contractDays(startDate: string, endDate: string): number | null {
  if (!isPlausibleDate(startDate) || !isPlausibleDate(endDate)) return null;
  const s = Date.parse(`${startDate}T00:00:00Z`);
  const e = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((e - s) / 86_400_000) + 1;
}

/**
 * คำเตือนวันสิ้นสุด (ไม่บล็อกการบันทึก — SPEC §7.2)
 *  - สิ้นสุดก่อนวันเริ่ม → เตือน
 *  - ไม่ตรงกับสูตร วันเริ่ม + N ปี − 1 วัน → เตือนพร้อมจำนวนวัน (เช่น "ระยะ 396 วัน")
 */
export function endDateWarning(
  startDate: string,
  endDate: string,
  termYears: TermYears,
): string | null {
  if (!endDate) return null;
  if (!isPlausibleDate(endDate)) return "วันสิ้นสุดไม่ถูกต้อง";
  if (!isPlausibleDate(startDate)) return null;
  if (endDate < startDate) return "วันสิ้นสุดอยู่ก่อนวันเริ่ม";
  const expected = autoEndDate(startDate, termYears);
  if (expected && expected !== endDate) {
    const days = contractDays(startDate, endDate);
    return days === null ? "วันสิ้นสุดไม่ตรงระยะสัญญา" : `ระยะ ${days} วัน`;
  }
  return null;
}

/** เดือนบริการ (YYYY-MM) = เดือนเริ่ม + ปี×12 เดือน — ไม่คำนวณจากวันสิ้นสุด (CLAUDE.md ข้อ 5) */
export function monthsOf(startDate: string, termYears: TermYears): string[] {
  return isPlausibleDate(startDate) ? serviceMonths(startDate, termYears) : [];
}
