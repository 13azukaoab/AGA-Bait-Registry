import type {
  BranchRef,
  Contract,
  MakeupSnapshotPolicy,
  MissedServiceResolution,
  SnapshotRow,
  TierRule,
  Visit,
} from "./types";
import { annualValue, tierOf } from "./tier";
import { serviceMonths } from "./serviceMonths";
import { monthOf } from "./date";
import { lastServiceMonth, makeupCountsInSnapshot } from "./missedResolution";

/**
 * M18 (DECISIONS 2.41 ②): ข้อมูลเดือนชดเชย (ไม่บังคับ — ไม่ส่ง = ผลเหมือนเดิมทุกประการ)
 * visits ใช้เฉพาะเมื่อ policy = "visited" (ต้องมีการเข้าที่ผูก makeupForMonth ของสัญญาเหล่านี้)
 */
export interface SnapshotMakeupInput {
  resolutions: MissedServiceResolution[];
  visits: Visit[];
  policy?: MakeupSnapshotPolicy;
}

/**
 * สร้างแถว snapshot รูปแบบ Dashboard (SPEC §7.6, §9.1) สำหรับ 1 สาขา × 1 เดือน
 * นับสัญญาเมื่อ: month อยู่ในเดือนบริการ หรือ (M18) month เป็นเดือนชดเชยหลังสัญญาจบ
 * · ไม่ถูกยกเลิกก่อน/ในเดือนนั้น · นับต่อสัญญาไม่เกิน 1 ครั้งต่อเดือน · Tier/มูลค่าเดิมของสัญญา
 */
export function buildBranchSnapshot(
  branch: BranchRef,
  contracts: Contract[],
  month: string,
  rules: TierRule[],
  makeups?: SnapshotMakeupInput,
): SnapshotRow {
  const row: SnapshotRow = {
    area: branch.area,
    branch: branch.branch,
    s1: 0, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    cust: 0, vS: 0, vM: 0, vL: 0, vXL: 0, value: 0, value_annual: 0,
  };

  for (const c of contracts) {
    if (c.cancelledAt && monthOf(c.cancelledAt) <= month) continue;
    const inService = serviceMonths(c.startDate, c.termYears).includes(month);
    // เดือนชดเชยในช่วงสัญญานับอยู่แล้ว ไม่นับซ้ำ · หลังสัญญาจบนับเมื่อมีการตัดสินชดเชยเดือนนี้
    const isAfterEnd = month > lastServiceMonth(c);
    const countsAsMakeup =
      !inService &&
      isAfterEnd &&
      !!makeups &&
      makeups.resolutions.some(
        (r) =>
          r.contractId === c.id &&
          r.makeupMonth === month &&
          makeupCountsInSnapshot(r, makeups.visits, makeups.policy),
      );
    if (!inService && !countsAsMakeup) continue;

    const av = annualValue(c.valueTotal, c.termYears);
    const tier = tierOf(av, rules);

    const countKey = `${tier.toLowerCase()}${c.termYears}` as
      | "s1" | "s3" | "m1" | "m3" | "l1" | "l3" | "xl1" | "xl3";
    row[countKey] = row[countKey] + 1;

    const valueKey = `v${tier}` as "vS" | "vM" | "vL" | "vXL";
    row[valueKey] += c.valueTotal;

    row.cust += 1;
    row.value += c.valueTotal;
    row.value_annual += av;
  }
  return row;
}
