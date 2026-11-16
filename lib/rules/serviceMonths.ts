import { termMonthsFromYears, serviceMonthsForTerm, defaultEndDateForTerm } from "./term";

/**
 * รายการเดือนบริการ 'YYYY-MM' = เดือนเริ่ม ต่อเนื่อง (ปี×12) เดือน
 * @deprecated M30 — รับ "ปี" (1/3) ตามผู้เรียกเดิมใน components/** · ใช้ `serviceMonthsForTerm(start, termMonths)`
 */
export function serviceMonths(startDate: string, termYears: number): string[] {
  return serviceMonthsForTerm(startDate, termMonthsFromYears(termYears));
}

/**
 * วันสิ้นสุดเริ่มต้น = วันเริ่ม + N ปี − 1 วัน (ชนปลายเดือน)
 * @deprecated M30 — รับ "ปี" (1/3) · ใช้ `defaultEndDateForTerm(start, termMonths)`
 */
export function defaultEndDate(startDate: string, termYears: number): string {
  return defaultEndDateForTerm(startDate, termMonthsFromYears(termYears));
}
