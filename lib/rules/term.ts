/**
 * M30 — ระยะสัญญาเป็นเดือน (DECISIONS 2.53 · เจ้าของอนุมัติ 16 พ.ย. 2026)
 *
 * Logic summary:
 *   - `term_months` 1–36 = แหล่งข้อมูลเดียวของระยะสัญญา (DB: contracts.term_months · CHECK 1–36)
 *   - 12 / 36 = ระยะมาตรฐาน 1 ปี / 3 ปี · ความยาวอื่นทั้งหมด = "Custom" (isCustomTerm)
 *   - เดือนบริการ = เดือนเริ่ม ต่อเนื่อง m เดือน (แทน "ปี × 12" — กฎ CLAUDE ข้อ 5 เดิม)
 *   - วันสิ้นสุดอัตโนมัติ = เริ่ม + m เดือน − 1 วัน ชนปลายเดือน (addMonthsMinusDay)
 *   - มูลค่าจัด Tier: m ≥ 12 → มูลค่า ÷ (m/12) · m < 12 → มูลค่าตามจริง (ไม่ขยายเป็นต่อปี)
 *   - กลุ่มสี / คีย์ Dashboard: 36 → "3" · อื่นทั้งหมด → "1" (Custom นับกลุ่ม 1 ปี · dashboard_data.json ไม่เปลี่ยน)
 *   - ฟังก์ชันชื่อเดิมแบบ "ปี" (`serviceMonths`, `defaultEndDate`, `annualValue`) ยังรับ "ปี" เหมือนเดิม
 *     (@deprecated) — FE (`components/**`) ยังส่งปีอยู่ จะได้ไม่เปลี่ยนความหมายเงียบๆ · ย้ายมาใช้ชุดนี้ใน M30b
 *   - ตรงกับ SQL ใน 20261115200000_term_months.sql — แก้ฝั่งหนึ่งต้องแก้อีกฝั่ง
 */
import type { Tier } from "./types";
import { addMonthsMinusDay, listMonths, monthOf } from "./date";

export const TERM_MONTHS_MIN = 1;
export const TERM_MONTHS_MAX = 36;

/** ระยะมาตรฐาน (เดือน) */
export const STANDARD_TERM_MONTHS = [12, 36] as const;

/** จำนวนเดือนที่ถูกต้อง: จำนวนเต็ม 1–36 */
export function isValidTermMonths(m: number): boolean {
  return Number.isInteger(m) && m >= TERM_MONTHS_MIN && m <= TERM_MONTHS_MAX;
}

function assertTermMonths(m: number, fn: string): void {
  if (!isValidTermMonths(m)) {
    throw new Error(`${fn}: termMonths must be an integer 1–36 (got ${m})`);
  }
}

/** Custom = ไม่ใช่ 12 และไม่ใช่ 36 เดือน (FE ใช้แสดงป้าย/ตัวกรอง "Custom") */
export function isCustomTerm(m: number): boolean {
  return m !== 12 && m !== 36;
}

/** กลุ่มสี / หลักท้ายคีย์ Dashboard: 36 → "3" · อื่นทั้งหมด → "1" */
export function colorGroup(m: number): "1" | "3" {
  return m === 36 ? "3" : "1";
}

export type TierKey = "s1" | "s3" | "m1" | "m3" | "l1" | "l3" | "xl1" | "xl3";

/** คีย์นับใน snapshot = tier + colorGroup เช่น ("XL", 12) → "xl1" · ("L", 5) → "l1" */
export function tierKey(tier: Tier, m: number): TierKey {
  return `${tier.toLowerCase()}${colorGroup(m)}` as TierKey;
}

/** แปลงระยะแบบปีเดิม (1 / 3) เป็นเดือน */
export function termMonthsFromYears(years: number): number {
  return years * 12;
}

/** เดือนบริการ 'YYYY-MM' = เดือนเริ่ม ต่อเนื่อง m เดือน (SPEC §7.2 · M30) */
export function serviceMonthsForTerm(startDate: string, termMonths: number): string[] {
  assertTermMonths(termMonths, "serviceMonthsForTerm");
  return listMonths(monthOf(startDate), termMonths);
}

/** วันสิ้นสุดอัตโนมัติ = วันเริ่ม + m เดือน − 1 วัน (ชนปลายเดือน) */
export function defaultEndDateForTerm(startDate: string, termMonths: number): string {
  assertTermMonths(termMonths, "defaultEndDateForTerm");
  return addMonthsMinusDay(startDate, termMonths);
}

/**
 * มูลค่าจัด Tier (SPEC §7.1 · 2.53)
 * m ≥ 12 → มูลค่า ÷ (m/12) · m < 12 → มูลค่าจริง
 * คิดเป็น มูลค่า × 12 ÷ m (กันทศนิยมเพี้ยนใต้เส้นเกณฑ์: 35,000 / 14 เดือน ต้องได้ 30,000 พอดี ไม่ใช่ 29,999.999…)
 * 12 / 36 ใช้สูตรปีเดิมตรงๆ (÷1 · ÷3) เพื่อให้ค่าเท่าเดิมทุกบิต
 */
export function annualValueForTerm(valueTotal: number, termMonths: number): number {
  assertTermMonths(termMonths, "annualValueForTerm");
  if (termMonths < 12) return valueTotal;
  if (termMonths === 12) return valueTotal;
  if (termMonths === 36) return valueTotal / 3;
  return (valueTotal * 12) / termMonths;
}
