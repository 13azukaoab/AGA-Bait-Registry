import type { BranchRef, Contract, SnapshotRow, TierRule, Visit } from "./types";
import { rulesForMonth, tierOf } from "./tier";
import { annualValueForTerm, serviceMonthsForTerm, tierKey } from "./term";
import { monthOf } from "./date";
import { lastServiceMonth, trackingStartMonth } from "./missedResolution";
import { isMissedService } from "./missedService";
import { isPausedMonth } from "./pauseMonth";

/**
 * สร้างแถว snapshot รูปแบบ Dashboard (SPEC §7.6, §9.1) สำหรับ 1 สาขา × 1 เดือน
 * นับสัญญาเมื่อ: month อยู่ในเดือนบริการ หรือ (M18 · DECISIONS 2.45) month อยู่หลังสัญญาจบ
 * และมีการเข้าชดเชยจริงในเดือนนั้น · ไม่ถูกยกเลิกก่อน/ในเดือนนั้น · นับต่อสัญญาไม่เกิน 1 ครั้งต่อเดือน
 * · Tier/มูลค่าเดิมของสัญญา
 * M29 (DECISIONS 2.87): เดือนที่พักสัญญา (contract.pauses) ไม่นับ (ลูกค้า/มูลค่าไม่อยู่ในยอดเดือนนั้น) ·
 *   การเข้า "ชดเชยจากพักสัญญา" หลังสัญญาจบ นับในเดือนที่เข้าจริงเหมือนชดเชยตกบริการ (2.45)
 * M30: ระยะเป็นเดือน (termMonths) · สัญญา Custom (ไม่ใช่ 12/36) นับในกลุ่ม 1 ปี (s1/m1/l1/xl1)
 *
 * ⚠ สำหรับคนต่อ Dashboard Sync (ผลตรวจ M2): loader ต้องส่ง
 *   (1) visits = การเข้า **ทั้งหมด** ของสัญญา พร้อม makeupForMonth (visits.makeup_for_month)
 *   (2) Contract.stationsInitializedAt (contracts.stations_initialized_at) + cancelledAt + renewedFromContractId
 *   ขาดข้อใด → เดือนชดเชยหลังสัญญาจบจะ "ไม่ถูกนับ" แบบเงียบๆ (ไม่ error)
 * visits (ไม่บังคับ — ไม่ส่ง = ผลเหมือนก่อน M18): การเข้าทั้งหมดของสัญญาเหล่านี้ ต้องมี makeupForMonth
 * และสัญญาต้องมี stationsInitializedAt (ไม่มี = ไม่นับเดือนชดเชย)
 * ('YYYY-MM' — ตัดจาก 'YYYY-MM-01' ของ DB) ใช้หาการเข้าชดเชย + ตรวจว่าเดือนที่ผูกยังตกจริง
 */
export function buildBranchSnapshot(
  branch: BranchRef,
  contracts: Contract[],
  month: string,
  rules: TierRule[],
  visits?: Visit[],
): SnapshotRow {
  const row: SnapshotRow = {
    area: branch.area,
    branch: branch.branch,
    s1: 0, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    cust: 0, vS: 0, vM: 0, vL: 0, vXL: 0, value: 0, value_annual: 0,
  };

  // M20: เลือกชุดเกณฑ์ของเดือนนี้ครั้งเดียว (DECISIONS 2.31)
  const monthRules = rulesForMonth(rules, month);

  for (const c of contracts) {
    if (c.cancelledAt && monthOf(c.cancelledAt) <= month) continue;
    if (isPausedMonth(c, month)) continue; // M29
    const inService = serviceMonthsForTerm(c.startDate, c.termMonths).includes(month);
    // เดือนชดเชยในช่วงสัญญานับอยู่แล้ว ไม่นับซ้ำ · หลังสัญญาจบนับเมื่อมีการเข้าชดเชยจริงในเดือนนี้
    // เดือนที่ผูกต้องไม่ก่อนเดือนเริ่มนับตกบริการ (ตั้งสถานี) — เกณฑ์เดียวกับ DB (กันสัญญาเก่าดันตัวเลข)
    const trackFrom = trackingStartMonth(c);
    // 2.47: สัญญาใหม่ (ต่อจากสัญญานี้) ใช้งานในเดือนนี้ → ลูกค้านับที่สัญญาใหม่แล้ว ไม่นับสัญญาเก่าซ้ำ
    const renewalActive = contracts.some(
      (o) =>
        o.renewedFromContractId === c.id &&
        !(o.cancelledAt && monthOf(o.cancelledAt) <= month) &&
        serviceMonthsForTerm(o.startDate, o.termMonths).includes(month),
    );
    const countsAsMakeup =
      !inService &&
      !!visits &&
      trackFrom !== null &&
      !renewalActive &&
      month > lastServiceMonth(c) &&
      visits.some(
        (v) =>
          v.contractId === c.id &&
          v.visitType === "routine" &&
          !!v.makeupForMonth &&
          monthOf(v.makeupForMonth) >= trackFrom &&
          monthOf(v.visitDate) === month &&
          // เดือนที่ผูกต้องยัง "ตกจริง" (มี routine ปกติภายหลัง = การผูกนั้นไม่มีผล)
          (isMissedService(c, monthOf(v.makeupForMonth), visits) ||
            isPausedMonth(c, v.makeupForMonth)), // M29: ชดเชยจากพักสัญญา
      );
    if (!inService && !countsAsMakeup) continue;

    // M30: มูลค่าจัด Tier ตามเดือน (< 12 เดือน = มูลค่าจริง) · คีย์ = tier + กลุ่มสี (36 → 3 · อื่น → 1)
    const av = annualValueForTerm(c.valueTotal, c.termMonths);
    const tier = tierOf(av, monthRules);

    const countKey = tierKey(tier, c.termMonths);
    row[countKey] = row[countKey] + 1;

    const valueKey = `v${tier}` as "vS" | "vM" | "vL" | "vXL";
    row[valueKey] += c.valueTotal;

    row.cust += 1;
    row.value += c.valueTotal;
    row.value_annual += av;
  }
  return row;
}
