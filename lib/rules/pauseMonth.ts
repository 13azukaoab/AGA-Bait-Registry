/**
 * M29: กฎ "เดือนที่พัก" แยกไฟล์เล็ก (ไม่มี import วน: missedService / snapshot ใช้ตัวนี้ · pause.ts ใช้ missedResolution)
 * รายละเอียดดูหัวไฟล์ pause.ts · ตรงกับ SQL `contract_month_paused()`
 */
import type { Contract } from "./types";
import { monthOf } from "./date";

/** เดือน month ('YYYY-MM' หรือ 'YYYY-MM-01') อยู่ในช่วงพักของสัญญาไหม */
export function isPausedMonth(contract: Contract, monthInput: string): boolean {
  if (!contract.pauses || contract.pauses.length === 0) return false;
  const month = monthOf(monthInput);
  return contract.pauses.some((p) => {
    if (monthOf(p.from) > month) return false;
    return p.resumedAt === undefined || month < monthOf(p.resumedAt);
  });
}

