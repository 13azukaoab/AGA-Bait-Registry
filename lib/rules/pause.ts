/**
 * M29 — พักสัญญา (ลูกค้าค้างจ่าย) · DECISIONS 2.52 · 2.63 · 2.87
 *
 * Logic summary:
 *   - 1 ช่วงพัก = { from, resumedAt? } (ตาราง contract_pauses) · สัญญาหนึ่งพักได้หลายครั้ง ไม่ซ้อนกัน (DB บังคับ)
 *   - คิดเป็น "เดือน" (เวลาไทย): เดือนของ from = พักทั้งเดือน · เดือนของ resumedAt = กลับมาใช้งาน (ต้องเข้าบริการตามปกติ)
 *     → เดือนที่พัก = [เดือน from, เดือน resumedAt) · ยังไม่กลับมาต่อ = ทุกเดือนตั้งแต่เดือน from
 *     · พักแล้วกลับมาต่อในเดือนเดียวกัน = ไม่มีเดือนพัก
 *   - เดือนที่พัก: ไม่นับตกบริการ (isMissedService) · ไม่นับใน snapshot/Dashboard (buildBranchSnapshot)
 *   - ไม่ยืดสัญญา (2.87 ข): เดือนบริการ/วันสิ้นสุดคงเดิม · เดือนบริการที่พักต้อง "ชดเชยจากพักสัญญา" ให้ครบ
 *     → บันทึกด้วยการเข้าชดเชยแบบเดิม (visits.makeup_for_month = เดือนที่พัก) · DB ติดป้าย origin = 'pause'
 *     · นับตั้งแต่เดือนตั้งสถานี (trackingStartMonth — เกณฑ์เดียวกับตกบริการ 2.46)
 *   - ตรงกับ SQL `contract_month_paused()` (20261115300001_contract_pause.sql) — แก้ฝั่งหนึ่งต้องแก้อีกฝั่ง
 */
import type { Contract, Visit } from "./types";
import { monthOf } from "./date";
import { isPausedMonth } from "./pauseMonth";
import { serviceMonthsForTerm } from "./term";
import { linkedMakeupVisit, trackingStartMonth } from "./missedResolution";

export { isPausedMonth };

/** เดือนบริการที่พัก ก่อนเดือน upto ('YYYY-MM' · ไม่รวม upto) · ไม่รวมเดือนตั้งแต่ยกเลิก */
export function pausedServiceMonths(contract: Contract, upto: string): string[] {
  if (!contract.pauses || contract.pauses.length === 0) return [];
  const end = monthOf(upto);
  const cancelled = contract.cancelledAt ? monthOf(contract.cancelledAt) : undefined;
  return serviceMonthsForTerm(contract.startDate, contract.termMonths).filter(
    (m) => m < end && (cancelled === undefined || m < cancelled) && isPausedMonth(contract, m),
  );
}

export interface PauseMakeupMonth {
  /** เดือนบริการที่พัก 'YYYY-MM' */
  month: string;
  /** เดือนของการเข้าชดเชยที่ผูกไว้ 'YYYY-MM' · undefined = ยังค้าง */
  madeUpMonth: string | undefined;
}

/**
 * เดือนที่ต้อง "ชดเชยจากพักสัญญา" (2.87) ก่อนเดือน currentMonth + สถานะชดเชยของแต่ละเดือน
 * นับเฉพาะช่วงพักที่กลับมาต่อแล้ว (ช่วงที่ยังพักอยู่ยังไม่ถึงเวลาชดเชย)
 * ยังไม่ตั้งสถานี / สัญญายกเลิก → [] (ไม่มีเรื่องให้ตาม — เกณฑ์เดียวกับ missedMonths)
 */
export function pauseMakeupMonths(
  contract: Contract,
  visits: readonly Visit[],
  currentMonth: string,
): PauseMakeupMonth[] {
  const from = trackingStartMonth(contract);
  if (from === null || contract.cancelledAt) return [];
  // เฉพาะช่วงพักที่กลับมาต่อแล้ว (ตรงกับ SQL list_pause_makeups: end_kind = 'resumed') — ยังพักอยู่ = ยังชดเชยไม่ได้
  const resumed = (contract.pauses ?? []).filter((p) => p.resumedAt !== undefined);
  return pausedServiceMonths({ ...contract, pauses: resumed }, currentMonth)
    .filter((m) => m >= from)
    .map((m) => {
      const v = linkedMakeupVisit(contract.id, m, [...visits]);
      return { month: m, madeUpMonth: v ? monthOf(v.visitDate) : undefined };
    });
}
