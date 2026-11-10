import type { Contract, Visit } from "./types";
import { serviceMonths } from "./serviceMonths";
import { monthOf } from "./date";

/**
 * ตกบริการเมื่อ: month อยู่ในเดือนบริการ และสัญญาไม่ถูกยกเลิก (ก่อน/ในเดือนนั้น)
 * และไม่มี visit ประเภท routine ในเดือน month (SPEC §7.4)
 * หมายเหตุ: ผู้เรียกควรจำกัดเฉพาะเดือนที่ผ่านไปแล้ว
 */
export function isMissedService(
  contract: Contract,
  month: string,
  visits: Visit[],
): boolean {
  if (!serviceMonths(contract.startDate, contract.termYears).includes(month))
    return false;
  if (contract.cancelledAt && monthOf(contract.cancelledAt) <= month)
    return false;
  const hasRoutine = visits.some(
    (v) =>
      v.contractId === contract.id &&
      v.visitType === "routine" &&
      monthOf(v.visitDate) === month,
  );
  return !hasRoutine;
}
