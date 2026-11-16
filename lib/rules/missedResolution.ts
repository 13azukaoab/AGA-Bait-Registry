/**
 * M18 — จัดการตกบริการ ชดเชย / ไม่ชดเชย
 * (DECISIONS 2.41 + 2.45 · docs/plans/2026-11-14-missed-service-resolution.md ข้อ 0)
 *
 * Logic summary:
 *   - เดือนที่ตกบริการ (isMissedService) เป็น "ประวัติจริงเสมอ" — การชดเชยไม่ลบการตก แค่มีสถานะกำกับ
 *   - ไม่มีการเลือกเดือนชดเชยล่วงหน้า (2.45): ชดเชยแล้ว = หัวหน้างานบันทึก "บริการชดเชย" ในวันที่ไปจริง
 *     → การเข้านั้นมี makeupForMonth = เดือนที่ตก (ฐานข้อมูลสร้างแถวการตัดสิน kind=makeup ให้เอง)
 *   - สถานะ 4 แบบ: รอตัดสิน / ชดเชยแล้ว / ไม่ชดเชย / โมฆะ (ต่อสัญญาแล้ว — 2.47) · "ชดเชยแล้ว" ยึดการเข้าที่ผูกไว้จริง
 *     (แถว makeup ที่ไม่มีการเข้าผูก = รอตัดสิน)
 *   - เจ้าของยืนยัน (DECISIONS 2.46): นับเดือนที่ตกตั้งแต่เดือนที่ตั้งสถานีในระบบ (trackingStartMonth) —
 *     สัญญาเก่าที่นำเข้าไม่มีประวัติการเข้า จะไม่ท่วมรายการ · เกณฑ์เดียวกับ SQL `missed_tracking_start()`
 *   - สัญญายกเลิก: ตัดสินไม่ได้ (2.45) จึงไม่แสดงในรายการ
 *   - เพดานเวลาไปชดเชยอยู่ที่ฐานข้อมูลจุดเดียว (`missed_makeup_deadline_months()`) — หน้าจออ่านจาก
 *     RPC list_pending_missed_services ไม่ต้องมีค่าซ้ำฝั่งนี้
 * ทุก month ในไฟล์นี้เป็น 'YYYY-MM' · เทียบด้วย string ได้เพราะรูปแบบคงที่
 * ค่าเดือน/วันที่จาก DB ('YYYY-MM-01' · timestamptz) ส่งเข้ามาได้ตรงๆ — normalise ด้วย monthOf (เวลาไทย)
 */
import type { Contract, MissedResolutionStatus, MissedServiceResolution, Visit } from "./types";
import { serviceMonthsForTerm } from "./term";
import { isMissedService } from "./missedService";
import { monthOf } from "./date";
import { effectiveEndDate } from "./renewalGap";

/**
 * เดือนแรกที่นับตกบริการ (เจ้าของยืนยัน — DECISIONS 2.46) = เดือนที่ตั้งสถานีในระบบ (เวลาไทย) แต่ไม่ก่อนเดือนเริ่มสัญญา
 * ยังไม่ตั้งสถานี → null (ยังไม่นับตก)
 */
export function trackingStartMonth(contract: Contract): string | null {
  if (!contract.stationsInitializedAt) return null;
  const init = monthOf(contract.stationsInitializedAt);
  const start = monthOf(contract.startDate);
  return init > start ? init : start;
}

/** เดือนที่ตกบริการของสัญญา (เดือนที่ผ่านไปแล้ว: < currentMonth · ตั้งแต่ trackingStartMonth · ไม่รวมสัญญายกเลิก) */
export function missedMonths(contract: Contract, visits: Visit[], currentMonth: string): string[] {
  const from = trackingStartMonth(contract);
  if (from === null || contract.cancelledAt) return [];
  return serviceMonthsForTerm(contract.startDate, contract.termMonths).filter(
    (m) => m >= from && m < currentMonth && isMissedService(contract, m, visits),
  );
}

/** การเข้าชดเชยที่ผูกกับเดือนที่ตก: routine · สัญญาเดียวกัน · อยู่หลังเดือนที่ตก */
export function linkedMakeupVisit(
  contractId: string,
  missedMonth: string,
  visits: Visit[],
): Visit | undefined {
  const missed = monthOf(missedMonth);
  return visits.find(
    (v) =>
      v.contractId === contractId &&
      v.visitType === "routine" &&
      !!v.makeupForMonth &&
      monthOf(v.makeupForMonth) === missed &&
      monthOf(v.visitDate) > missed,
  );
}

/**
 * ต่อสัญญาแล้ว (เฉพาะทาง Renew) = มีสัญญาอื่นที่ renewedFromContractId = สัญญานี้ และสัญญาใหม่นั้น **ยังไม่ถูกยกเลิก**
 * (DECISIONS 2.47 + 2.48: สัญญาใหม่ถูกยกเลิก → ตกบริการค้างของสัญญาเดิมกลับเป็นรอตัดสิน)
 * ⚠ ตั้งแต่ M28 SQL `contract_is_renewed` = `isSuperseded` (รวมกรณี New) — ใช้ isSuperseded ตัดสินโมฆะ
 */
export function isRenewed(contract: Contract, contracts: Contract[]): boolean {
  return contracts.some(
    (o) => o.id !== contract.id && o.renewedFromContractId === contract.id && !o.cancelledAt,
  );
}

/**
 * M28 (DECISIONS 2.51 ขยาย 2.47): สัญญานี้ "ถูกแทนแล้ว" → ตกบริการที่ค้างเป็นโมฆะ เมื่อมีสัญญาอื่นที่ยังไม่ถูกยกเลิก (2.48 ②) และ
 *   (ก) ผูก Renew มาที่สัญญานี้ (isRenewed) หรือ
 *   (ข) เป็น New (ไม่ผูกสัญญาไหน) ของลูกค้าคนเดียวกัน ที่เริ่ม **หลัง** วันจบของสัญญานี้ (effectiveEndDate)
 * ตรงกับ SQL `contract_is_renewed` (20261115180000) · ไม่รู้ customerId → ใช้ได้เฉพาะ (ก)
 */
export function isSuperseded(contract: Contract, contracts: Contract[]): boolean {
  if (isRenewed(contract, contracts)) return true;
  if (!contract.customerId) return false;
  const end = effectiveEndDate(contract);
  return contracts.some(
    (o) =>
      o.id !== contract.id &&
      !o.cancelledAt &&
      !o.renewedFromContractId &&
      o.customerId === contract.customerId &&
      o.startDate.slice(0, 10) > end,
  );
}

/**
 * สถานะการแก้ไขของ 1 เดือนที่ตก (4 แบบ)
 * renewed = สัญญานี้ถูกแทนแล้ว (isSuperseded) → ที่ยังรอตัดสินกลายเป็นโมฆะ · ชดเชยแล้ว / ไม่ชดเชย คงไว้ (2.47)
 */
export function missedResolutionStatus(
  contract: Contract,
  missedMonth: string,
  resolution: MissedServiceResolution | undefined,
  visits: Visit[],
  renewed = false,
): MissedResolutionStatus {
  const missed = monthOf(missedMonth);
  const own =
    resolution && resolution.contractId === contract.id && monthOf(resolution.missedMonth) === missed
      ? resolution
      : undefined;
  if (own?.kind === "waived") return "waived";
  if (linkedMakeupVisit(contract.id, missed, visits)) return "made_up";
  return renewed ? "void_renewed" : "pending";
}

/** อยู่ในรายการ "ต้องทำ" / แถว "รอชดเชย" ไหม */
export function needsDecision(status: MissedResolutionStatus): boolean {
  return status === "pending";
}

/** เดือนบริการสุดท้าย 'YYYY-MM' (เดือนเริ่ม + จำนวนเดือน − 1 — กฎข้อ 5 / M30 ไม่ใช้ end_date) */
export function lastServiceMonth(contract: Contract): string {
  return serviceMonthsForTerm(contract.startDate, contract.termMonths).at(-1) as string;
}
