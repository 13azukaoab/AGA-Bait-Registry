/**
 * M18 — จัดการตกบริการ ชดเชย / ไม่ชดเชย (DECISIONS 2.41 · docs/plans/2026-11-14-missed-service-resolution.md)
 *
 * Logic summary:
 *   - เดือนที่ตกบริการ (isMissedService) เป็น "ประวัติจริงเสมอ" — การชดเชยไม่ลบการตก แค่มีสถานะกำกับ
 *   - การตัดสินต่อ 1 เดือนที่ตก (ตาราง missed_service_resolutions): ไม่มีแถว = รอตัดสิน
 *   - สถานะ 5 แบบคำนวณจาก การตัดสิน + การเข้าที่ผูก (makeupForMonth) + เดือนปัจจุบัน (Asia/Bangkok)
 *     ไม่มี cron เขียนข้อมูล: เดือนชดเชยผ่านไปโดยไม่มีการเข้าที่ผูก → "ชดเชยไม่ได้ทำ" → กลับเข้ารายการต้องทำ
 *   - ชดเชยแล้ว = มีการเข้า routine ของสัญญาเดียวกันที่ผูกกับเดือนที่ตก และอยู่ในเดือนชดเชย
 *   - เดือนชดเชยหลังสัญญาจบนับใน snapshot ตาม MAKEUP_SNAPSHOT_POLICY (จุดเดียวที่ต้องเปลี่ยนถ้าเจ้าของเลือกอีกแบบ)
 * ทุก month ในไฟล์นี้เป็น 'YYYY-MM' · เทียบด้วย string ได้เพราะรูปแบบคงที่
 */
import type {
  Contract,
  MakeupSnapshotPolicy,
  MissedResolutionStatus,
  MissedServiceResolution,
  Visit,
} from "./types";
import { serviceMonths } from "./serviceMonths";
import { isMissedService } from "./missedService";
import { listMonths, monthOf } from "./date";

/**
 * ⚠ รอเจ้าของยืนยัน (แบบข้อ 5 ข้อสุดท้าย): เลือกชดเชย ม.ค. 2027 แต่ไม่ได้ไป ยังนับลูกค้า ม.ค. ไหม
 * ค่าปัจจุบัน "scheduled" = นับตั้งแต่เลือกชดเชยไว้ (ตามที่แบบเขียน) · "visited" = นับเมื่อไปจริงเท่านั้น
 */
export const MAKEUP_SNAPSHOT_POLICY: MakeupSnapshotPolicy = "scheduled";

/** เดือนที่ตกบริการของสัญญา (เฉพาะเดือนที่ผ่านไปแล้ว: < currentMonth) */
export function missedMonths(contract: Contract, visits: Visit[], currentMonth: string): string[] {
  return serviceMonths(contract.startDate, contract.termYears).filter(
    (m) => m < currentMonth && isMissedService(contract, m, visits),
  );
}

/** มีการเข้าชดเชยที่ผูกไว้กับการตัดสินนี้ ในเดือนชดเชย */
function hasLinkedMakeupVisit(r: MissedServiceResolution, visits: Visit[]): boolean {
  return visits.some(
    (v) =>
      v.contractId === r.contractId &&
      v.visitType === "routine" &&
      v.makeupForMonth === r.missedMonth &&
      monthOf(v.visitDate) === r.makeupMonth,
  );
}

/** สถานะการแก้ไขของ 1 เดือนที่ตก (5 แบบ) */
export function missedResolutionStatus(
  contract: Contract,
  missedMonth: string,
  resolution: MissedServiceResolution | undefined,
  visits: Visit[],
  currentMonth: string,
): MissedResolutionStatus {
  if (!resolution || resolution.contractId !== contract.id || resolution.missedMonth !== missedMonth)
    return "pending";
  if (resolution.kind === "waived") return "waived";
  if (hasLinkedMakeupVisit(resolution, visits)) return "made_up";
  if (resolution.makeupMonth && currentMonth > resolution.makeupMonth) return "makeup_not_done";
  return "makeup_scheduled";
}

/** อยู่ในรายการ "ต้องทำ" ไหม (รอตัดสิน หรือ ชดเชยไม่ได้ทำ) */
export function needsDecision(status: MissedResolutionStatus): boolean {
  return status === "pending" || status === "makeup_not_done";
}

/** เดือนชดเชยเริ่มต้น = เดือนถัดจากเดือนบริการสุดท้าย (SPEC §7.2 — ไม่ใช้ end_date) */
export function defaultMakeupMonth(contract: Contract): string {
  const months = serviceMonths(contract.startDate, contract.termYears);
  return listMonths(months[months.length - 1], 2)[1];
}

/** การตัดสินนี้ทำให้สัญญานับใน snapshot ของเดือนชดเชยไหม (ตาม policy) */
export function makeupCountsInSnapshot(
  resolution: MissedServiceResolution,
  visits: Visit[],
  policy: MakeupSnapshotPolicy = MAKEUP_SNAPSHOT_POLICY,
): boolean {
  if (resolution.kind !== "makeup" || !resolution.makeupMonth) return false;
  return policy === "scheduled" || hasLinkedMakeupVisit(resolution, visits);
}
