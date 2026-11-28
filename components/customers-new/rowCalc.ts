/**
 * ช่องคำนวณของแถวในตารางเปิดงาน (แสดงอย่างเดียว ผู้ใช้ไม่กรอก)
 *
 * Logic summary:
 *   * สูตรทั้งหมดเรียก `lib/rules` เท่านั้น (annualValueForTerm / tierOf / defaultEndDateForTerm / serviceMonthsForTerm)
 *   * เกณฑ์ Tier รับเป็นพารามิเตอร์ `rules` ที่อ่านจากตาราง `tier_rules` — ห้าม hardcode
 *   * มูลค่า = ช่องเดียว + ระยะเป็นเดือน `termMonths` 1–36 (M30 · 12 = 1 ปี · 36 = 3 ปี · อื่น = Custom ·
 *     ช่อง "1 ปี"/"3 ปี" ใน mockup ระบบเลือกแสดงตามระยะ · Custom นับกลุ่มสี/ช่อง 1 ปี)
 *   * วันสิ้นสุด: ค่าเริ่มต้น = วันเริ่ม + N เดือน − 1 วัน (ชนปลายเดือน) · ถ้าผู้ใช้แก้แล้วไม่ตรง = เตือน (ไม่บล็อก)
 */
import {
  annualValueForTerm,
  colorGroup,
  defaultEndDateForTerm,
  isValidTermMonths,
  serviceMonthsForTerm,
  tierKey,
  tierOf,
  type Tier,
  type TierRule,
} from "@/lib/rules";
import { currentBangkokMonth } from "@/lib/service/months";

/** key ของป้าย Tier 10 แบบ (รวม xxl1/xxl3) เช่น `s1`, `xl3` (ตรงกับ class `tier s1`) */
export type TierKey = "s1" | "s3" | "m1" | "m3" | "l1" | "l3" | "xl1" | "xl3" | "xxl1" | "xxl3";

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
  tier: Tier;
  key: TierKey;
  label: string; // เช่น "S1"
  annual: number;
}

/**
 * Tier + ระยะ (เดือน) → ป้าย 10 แบบ (รวม XXL1/XXL3) (Custom ใช้กลุ่มสี 1 ปี · มูลค่าจัด Tier ตาม `annualValueForTerm`) · ข้อมูลไม่ครบ = null
 * DECISIONS 2.119 (แก้จาก 2.49): ป้ายใช้เกณฑ์ของ "เดือนปัจจุบัน (เวลาไทย)" เสมอ ไม่ขึ้นกับวันเริ่มที่กรอก
 * `now` ไว้ฉีดวันที่ในเทส
 */
export function tierFor(
  valueTotal: number | null,
  termMonths: number | null,
  rules: TierRule[],
  now?: Date,
): TierResult | null {
  if (valueTotal === null || termMonths === null || !isValidTermMonths(termMonths) || rules.length === 0) return null;
  const annual = annualValueForTerm(valueTotal, termMonths);
  const tier = tierOf(annual, rules, currentBangkokMonth(now));
  const key = tierKey(tier, termMonths);
  return { tier, key, label: `${tier}${colorGroup(termMonths)}`, annual };
}

/** วันสิ้นสุดอัตโนมัติ · วันเริ่มไม่ใช่วันจริง = null */
export function autoEndDate(startDate: string, termMonths: number): string | null {
  return isPlausibleDate(startDate) && isValidTermMonths(termMonths) ? defaultEndDateForTerm(startDate, termMonths) : null;
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
 *  - ไม่ตรงกับสูตร วันเริ่ม + N เดือน − 1 วัน → เตือนพร้อมจำนวนวัน (เช่น "ระยะ 396 วัน")
 */
export function endDateWarning(
  startDate: string,
  endDate: string,
  termMonths: number,
): string | null {
  if (!endDate) return null;
  if (!isPlausibleDate(endDate)) return "วันสิ้นสุดไม่ถูกต้อง";
  if (!isPlausibleDate(startDate)) return null;
  if (endDate < startDate) return "วันสิ้นสุดอยู่ก่อนวันเริ่ม";
  const expected = autoEndDate(startDate, termMonths);
  if (expected && expected !== endDate) {
    const days = contractDays(startDate, endDate);
    return days === null ? "วันสิ้นสุดไม่ตรงระยะสัญญา" : `ระยะ ${days} วัน`;
  }
  return null;
}

/** เดือนบริการ (YYYY-MM) = เดือนเริ่ม + จำนวนเดือนของสัญญา — ไม่คำนวณจากวันสิ้นสุด (CLAUDE.md ข้อ 5 · M30) */
export function monthsOf(startDate: string, termMonths: number): string[] {
  return isPlausibleDate(startDate) && isValidTermMonths(termMonths) ? serviceMonthsForTerm(startDate, termMonths) : [];
}
