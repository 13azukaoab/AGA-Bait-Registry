/**
 * M18 — จัดการตกบริการ ชดเชย / ไม่ชดเชย
 * (DECISIONS 2.41 + 2.45 · docs/plans/2026-11-14-missed-service-resolution.md ข้อ 0)
 *
 * Logic summary:
 *   - เดือนที่ตกบริการ (isMissedService) เป็น "ประวัติจริงเสมอ" — การชดเชยไม่ลบการตก แค่มีสถานะกำกับ
 *   - ไม่มีการเลือกเดือนชดเชยล่วงหน้า (2.45): ชดเชยแล้ว = หัวหน้างานบันทึก "บริการชดเชย" ในวันที่ไปจริง
 *     → การเข้านั้นมี makeupForMonth = เดือนที่ตก (ฐานข้อมูลสร้างแถวการตัดสิน kind=makeup ให้เอง)
 *   - สถานะ 3 แบบ: รอตัดสิน / ชดเชยแล้ว / ไม่ชดเชย · "ชดเชยแล้ว" ยึดการเข้าที่ผูกไว้จริงเป็นหลัก
 *     (แถว makeup ที่ไม่มีการเข้าผูก = รอตัดสิน)
 *   - เกณฑ์ชั่วคราว (รอเจ้าของ): นับเดือนที่ตกตั้งแต่เดือนที่ตั้งสถานีในระบบ (trackingStartMonth) —
 *     สัญญาเก่าที่นำเข้าไม่มีประวัติการเข้า จะไม่ท่วมรายการ · เกณฑ์เดียวกับ SQL `missed_tracking_start()`
 *   - สัญญายกเลิก: ตัดสินไม่ได้ (2.45) จึงไม่แสดงในรายการ
 *   - เพดานเวลาไปชดเชยอยู่ที่ฐานข้อมูลจุดเดียว (`missed_makeup_deadline_months()`) — หน้าจออ่านจาก
 *     RPC list_pending_missed_services ไม่ต้องมีค่าซ้ำฝั่งนี้
 * ทุก month ในไฟล์นี้เป็น 'YYYY-MM' · เทียบด้วย string ได้เพราะรูปแบบคงที่
 * ⚠ ตัวแปลงจาก DB: missed_month / makeup_month / makeup_for_month เก็บ 'YYYY-MM-01' → ตัดเป็น 'YYYY-MM' ทุกช่อง
 */
import type { Contract, MissedResolutionStatus, MissedServiceResolution, Visit } from "./types";
import { serviceMonths } from "./serviceMonths";
import { isMissedService } from "./missedService";
import { listMonths, monthOf } from "./date";

/**
 * เดือนแรกที่นับตกบริการ (เกณฑ์ชั่วคราว — รอเจ้าของ) = เดือนที่ตั้งสถานีในระบบ แต่ไม่ก่อนเดือนเริ่มสัญญา
 * ยังไม่ตั้งสถานี → null (ยังไม่นับตก)
 */
export function trackingStartMonth(contract: Contract): string | null {
  if (!contract.stationsInitializedAt) return null;
  const init = monthOf(contract.stationsInitializedAt.slice(0, 10));
  const start = monthOf(contract.startDate);
  return init > start ? init : start;
}

/** เดือนที่ตกบริการของสัญญา (เดือนที่ผ่านไปแล้ว: < currentMonth · ตั้งแต่ trackingStartMonth · ไม่รวมสัญญายกเลิก) */
export function missedMonths(contract: Contract, visits: Visit[], currentMonth: string): string[] {
  const from = trackingStartMonth(contract);
  if (from === null || contract.cancelledAt) return [];
  return serviceMonths(contract.startDate, contract.termYears).filter(
    (m) => m >= from && m < currentMonth && isMissedService(contract, m, visits),
  );
}

/** การเข้าชดเชยที่ผูกกับเดือนที่ตก: routine · สัญญาเดียวกัน · อยู่หลังเดือนที่ตก */
export function linkedMakeupVisit(
  contractId: string,
  missedMonth: string,
  visits: Visit[],
): Visit | undefined {
  return visits.find(
    (v) =>
      v.contractId === contractId &&
      v.visitType === "routine" &&
      v.makeupForMonth === missedMonth &&
      monthOf(v.visitDate) > missedMonth,
  );
}

/** สถานะการแก้ไขของ 1 เดือนที่ตก (3 แบบ) */
export function missedResolutionStatus(
  contract: Contract,
  missedMonth: string,
  resolution: MissedServiceResolution | undefined,
  visits: Visit[],
): MissedResolutionStatus {
  const own =
    resolution && resolution.contractId === contract.id && resolution.missedMonth === missedMonth
      ? resolution
      : undefined;
  if (own?.kind === "waived") return "waived";
  if (linkedMakeupVisit(contract.id, missedMonth, visits)) return "made_up";
  return "pending";
}

/** อยู่ในรายการ "ต้องทำ" / แถว "รอชดเชย" ไหม */
export function needsDecision(status: MissedResolutionStatus): boolean {
  return status === "pending";
}

/** เดือนบริการสุดท้าย 'YYYY-MM' (เดือนเริ่ม + ปี×12 − 1 — กฎข้อ 5 ไม่ใช้ end_date) */
export function lastServiceMonth(contract: Contract): string {
  return listMonths(monthOf(contract.startDate), contract.termYears * 12).at(-1) as string;
}
