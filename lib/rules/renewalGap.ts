/**
 * M28 — กฎช่องว่าง 2 เดือนระหว่างสัญญา (DECISIONS 2.51 · เจ้าของอนุมัติ 16 พ.ย. 2026)
 *
 * Logic summary:
 *   - Renew ได้เฉพาะเมื่อ เดือนเริ่มของสัญญาใหม่ ≤ เดือนจบของสัญญาเก่า + 2 เดือน
 *     (จบ 31 ธ.ค. 2026 → เริ่ม ม.ค.–ก.พ. 2027 = Renew · มี.ค. 2027 ขึ้นไป = ต้องเปิดเป็น New)
 *   - "เดือนจบ" = เดือนของ end_date (ถ้าว่าง = วันเริ่ม + N เดือน − 1 วัน ชนปลายเดือน · M30) — ตั้งใจใช้ end_date ไม่ใช่เดือนบริการสุดท้าย
 *     (สัญญาเริ่มกลางเดือน 15 ม.ค. → จบ 14 ม.ค. ปีถัดไป → Renew ได้ถึง มี.ค. · ถ้านับจากเดือนบริการสุดท้าย (ธ.ค.) จะได้แค่ ก.พ.)
 *   - ซ้อนกัน (สัญญาใหม่เริ่มก่อนสัญญาเก่าจบ) = Renew ได้ · แต่ต้องเริ่ม **หลัง** วันเริ่มสัญญาเก่า
 *   - ตรงกับ SQL `contract_effective_end_date` / `renewal_gap_ok` (20261115180000_renewal_gap_rule.sql) —
 *     แก้ฝั่งหนึ่งต้องแก้อีกฝั่งด้วย · M30 (20261115200000_term_months.sql) เปลี่ยนเป็น term_months แล้ว
 *   - หน้าเปิดงานใช้ `renewalGapOk` / `latestRenewStartMonth` ล็อกตัวเลือก Renew (DB บังคับซ้ำ: AG010)
 */
import type { Contract } from "./types";
import { defaultEndDateForTerm } from "./term";
import { listMonths, monthOf } from "./date";

/** จำนวนเดือนที่ยอมให้เว้นหลังเดือนจบ แล้วยังนับเป็น Renew (กฎบริษัท 2.51) */
export const RENEWAL_GAP_MONTHS = 2;

/**
 * วันที่ของสัญญาที่กฎนี้ใช้ · ระยะส่งเป็น `termMonths` (M30) หรือ `termYears` แบบเดิม
 * (@deprecated — components/customers-new/renewRules.ts ยังส่งปีอยู่ · ลบใน M30b เมื่อ FE ย้ายเป็นเดือน)
 */
export type ContractDates = Pick<Contract, "startDate" | "endDate"> &
  ({ termMonths: number; termYears?: undefined } | { termYears: number; termMonths?: undefined });

function termMonthsOf(contract: ContractDates): number {
  return contract.termMonths !== undefined ? contract.termMonths : contract.termYears * 12;
}

/** วันจบที่ใช้จริง = end_date ถ้ามี · ว่าง = วันเริ่ม + N เดือน − 1 วัน ชนปลายเดือน ('YYYY-MM-DD' · M30) */
export function effectiveEndDate(contract: ContractDates): string {
  return contract.endDate
    ? contract.endDate.slice(0, 10)
    : defaultEndDateForTerm(contract.startDate, termMonthsOf(contract));
}

/** เดือนสุดท้าย 'YYYY-MM' ที่สัญญาใหม่ยังเริ่มแบบ Renew ได้ */
export function latestRenewStartMonth(oldContract: ContractDates): string {
  return listMonths(monthOf(effectiveEndDate(oldContract)), RENEWAL_GAP_MONTHS + 1).at(-1) as string;
}

/** สัญญาใหม่ที่เริ่ม newStartDate ('YYYY-MM-DD') นับเป็น Renew ของ oldContract ได้ไหม */
export function renewalGapOk(oldContract: ContractDates, newStartDate: string): boolean {
  const start = newStartDate.slice(0, 10);
  if (start <= oldContract.startDate.slice(0, 10)) return false;
  return monthOf(start) <= latestRenewStartMonth(oldContract);
}

/**
 * M28 รอบ 2: เปิดงาน Renew ที่ไม่ผูกสัญญาเก่า (ต้องมีเหตุผล) ได้ไหม ณ วันนี้ (เวลาไทย 'YYYY-MM-DD')
 * `untilDate` = app_settings.allow_unlinked_renew_until = วันแรกที่ "ไม่ได้แล้ว" — ตรงกับ SQL
 * (`current_date` ไทย < allow_unlinked_renew_until()) · DB บังคับซ้ำ: AG013
 */
export function unlinkedRenewAllowed(todayDate: string, untilDate: string): boolean {
  return todayDate.slice(0, 10) < untilDate.slice(0, 10);
}
