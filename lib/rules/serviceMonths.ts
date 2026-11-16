import { termMonthsFromYears, serviceMonthsForTerm, defaultEndDateForTerm } from "./term";

/**
 * รายการเดือนบริการ 'YYYY-MM' = เดือนเริ่ม ต่อเนื่อง (ปี×12) เดือน
 * @deprecated M30 — รับ "ปี" (1/3) ตามผู้เรียกเดิมใน components/** · ใช้ `serviceMonthsForTerm(start, termMonths)`
 * ปีว่าง/ผิด (เช่น term_years = NULL ของสัญญา Custom ที่ FE เดิมยังอ่าน) → [] เหมือนก่อน M30 (ไม่ throw
 * ให้ทั้งรายการพัง) · สัญญา Custom จึง "ไม่ถูกนับ" ในหน้าจอเดิมจนกว่า FE ย้ายไปอ่าน term_months (M30b)
 */
export function serviceMonths(startDate: string, termYears: number | null | undefined): string[] {
  if (typeof termYears !== "number" || !Number.isInteger(termYears) || termYears < 1 || termYears > 3) return [];
  return serviceMonthsForTerm(startDate, termMonthsFromYears(termYears));
}

/**
 * วันสิ้นสุดเริ่มต้น = วันเริ่ม + N ปี − 1 วัน (ชนปลายเดือน)
 * @deprecated M30 — รับ "ปี" (1/3) · ใช้ `defaultEndDateForTerm(start, termMonths)`
 */
export function defaultEndDate(startDate: string, termYears: number): string {
  return defaultEndDateForTerm(startDate, termMonthsFromYears(termYears));
}
