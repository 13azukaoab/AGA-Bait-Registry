import { addYearsMinusDay, listMonths, monthOf } from "./date";

/** รายการเดือนบริการ 'YYYY-MM' = เดือนเริ่ม ต่อเนื่อง (ปี×12) เดือน (SPEC §7.2) */
export function serviceMonths(startDate: string, termYears: number): string[] {
  return listMonths(monthOf(startDate), termYears * 12);
}

/** วันสิ้นสุดเริ่มต้น = วันเริ่ม + N ปี − 1 วัน */
export function defaultEndDate(startDate: string, termYears: number): string {
  return addYearsMinusDay(startDate, termYears);
}
