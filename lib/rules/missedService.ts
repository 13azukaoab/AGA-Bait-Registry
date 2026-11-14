import type { Contract, Visit } from "./types";
import { serviceMonths } from "./serviceMonths";
import { monthOf } from "./date";

/**
 * ตกบริการเมื่อ: month อยู่ในเดือนบริการ และสัญญาไม่ถูกยกเลิก (ก่อน/ในเดือนนั้น)
 * และไม่มี visit ประเภท routine ในเดือน month (SPEC §7.4)
 * หมายเหตุ: ผู้เรียกควรจำกัดเฉพาะเดือนที่ผ่านไปแล้ว
 * M18: การเข้าที่ผูกเป็นชดเชยของเดือนอื่น (`makeupForMonth`) ไม่นับเป็น routine ของเดือนตัวเอง
 *      (เดือนที่มีชดเชยในช่วงสัญญาต้องมี 2 ครั้ง: ปกติ + ชดเชย — DECISIONS 2.41)
 */
export function isMissedService(
  contract: Contract,
  monthInput: string,
  visits: Visit[],
): boolean {
  const month = monthOf(monthInput); // รับ 'YYYY-MM' หรือ 'YYYY-MM-01' จาก DB
  if (!serviceMonths(contract.startDate, contract.termYears).includes(month))
    return false;
  if (contract.cancelledAt && monthOf(contract.cancelledAt) <= month)
    return false;
  const hasRoutine = visits.some(
    (v) =>
      v.contractId === contract.id &&
      v.visitType === "routine" &&
      !v.makeupForMonth &&
      monthOf(v.visitDate) === month,
  );
  return !hasRoutine;
}
