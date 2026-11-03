import type { BranchRef, Contract, SnapshotRow, TierRule } from "./types";
import { annualValue, tierOf } from "./tier";
import { serviceMonths } from "./serviceMonths";
import { monthOf } from "./date";

/** สร้างแถว snapshot รูปแบบ Dashboard (SPEC §7.6, §9.1) สำหรับ 1 สาขา × 1 เดือน */
export function buildBranchSnapshot(
  branch: BranchRef,
  contracts: Contract[],
  month: string,
  rules: TierRule[],
): SnapshotRow {
  const row: SnapshotRow = {
    area: branch.area,
    branch: branch.branch,
    s1: 0, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    cust: 0, vS: 0, vM: 0, vL: 0, vXL: 0, value: 0, value_annual: 0,
  };

  for (const c of contracts) {
    if (!serviceMonths(c.startDate, c.termYears).includes(month)) continue;
    if (c.cancelledAt && monthOf(c.cancelledAt) <= month) continue;

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
