/**
 * รวมข้อมูลทั้งหน้า (แบบ B ที่เจ้าของเลือก · DECISIONS 2.91) ให้เรียกครั้งเดียวได้ทุกส่วนของหน้า
 *
 * Logic summary:
 *   * `filters` (เดือน/เขต/สาขา/ผู้ขาย) กรองก่อน แล้ว `type` ("all" | "new" | "renew") กรองต่อ
 *   * การ์ดสรุป (kpis) คิดจากแถวที่ผ่าน `filters` เท่านั้น — **ไม่กรองตาม type** แต่บอก `highlight` ไว้ให้หน้าไฮไลต์การ์ด
 *   * แนวโน้มรายเดือน / แยกเขต / อันดับผู้ขาย / อันดับสาขา / รายชื่อ คิดจากแถวที่กรอง type แล้ว
 *     — อันดับเรียงตามมูลค่าของประเภทที่เลือก (all = New+Renew) · แถบสีเดียวเพราะอีกประเภทเป็น 0 อยู่แล้ว
 *   * ต่อสัญญาล่าช้าเป็นของ Renew เท่านั้น: เลือก New แล้ว `showLate` = false (หน้าซ่อน/ทำจางป้ายล่าช้า)
 *     และชิป "late" ถูกมองเป็น "all"
 *   * ชิปรายชื่อมีแค่ "all" | "late"
 */
import {
  countNoMailDate,
  filterSales,
  groupByBranch,
  groupByMonth,
  groupByZone,
  rankSellers,
  sumRows,
} from "./salesAggregate";
import type { BranchSales, MonthSales, SalesFilters, SalesRow, SalesTotals, SellerSales, ZoneSales } from "./salesTypes";

export type SalesTypeFilter = "all" | "new" | "renew";
export type ListChip = "all" | "late";

export interface SalesViewOptions {
  type: SalesTypeFilter;
  chip: ListChip;
}

export interface SalesView {
  /** การ์ดสรุป — ไม่กรองตาม type */
  kpis: SalesTotals & { lateShareOfRenew: number };
  /** ประเภทที่ไฮไลต์ในการ์ด (null = ไม่ไฮไลต์) */
  highlight: "new" | "renew" | null;
  showLate: boolean;
  months: MonthSales[];
  zones: ZoneSales[];
  sellers: SellerSales[];
  branches: BranchSales[];
  /** รายชื่อสัญญา (เรียงรับ Mail ใหม่→เก่า) ตาม type + ชิป */
  list: SalesRow[];
  /** จำนวนสัญญาไม่มีวันที่รับ Mail (ตามตัวกรองเขต/สาขา/ผู้ขาย) */
  noMailCount: number;
}

export function filterByType(rows: readonly SalesRow[], type: SalesTypeFilter): SalesRow[] {
  return type === "all" ? [...rows] : rows.filter((r) => r.saleType === type);
}

/** มูลค่าที่ใช้จัดอันดับตามประเภทที่เลือก */
function valueFor(t: SalesTotals, type: SalesTypeFilter): number {
  return type === "new" ? t.newValue : type === "renew" ? t.renewValue : t.newValue + t.renewValue;
}

export function buildSalesView(allRows: readonly SalesRow[], filters: SalesFilters, opt: SalesViewOptions): SalesView {
  const scoped = filterSales(allRows, filters);
  const typed = filterByType(scoped, opt.type);
  const kpiBase = sumRows(scoped);
  const showLate = opt.type !== "new";
  const chip: ListChip = showLate ? opt.chip : "all";

  const branches = groupByBranch(typed).sort(
    (a, b) => valueFor(b, opt.type) - valueFor(a, opt.type) || a.zoneOrder - b.zoneOrder || a.branchName.localeCompare(b.branchName, "th"),
  );

  return {
    kpis: { ...kpiBase, lateShareOfRenew: kpiBase.renewCount ? kpiBase.lateCount / kpiBase.renewCount : 0 },
    highlight: opt.type === "all" ? null : opt.type,
    showLate,
    months: groupByMonth(typed, filters.fromMonth, filters.toMonth),
    zones: groupByZone(typed),
    sellers: rankSellers(typed, "sale"),
    branches,
    list: chip === "late" ? typed.filter((r) => r.isLate) : typed,
    noMailCount: countNoMailDate(allRows, filters),
  };
}
