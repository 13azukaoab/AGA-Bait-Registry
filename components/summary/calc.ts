/**
 * ตรรกะคำนวณของหน้า Dashboard สรุปมูลค่า (`/summary`) — pure function ล้วน ไม่แตะ DB/React
 *
 * หน้าที่:
 *  - แปลง key เดือนจาก DB (`YYYY-MM` หรือ `MMM.YY`) ให้เป็นรูปแบบเดียวกัน
 *  - กรองแถวตาม หน่วยงาน/เขต/สาขา
 *  - รวมยอด · หาอัตราเปลี่ยนแปลง (MoM/YoY) · จัดอันดับสาขา · ทำข้อมูลกราฟรายเดือน
 *  - ตัวกรอง Tier: เลือก Tier ใด → ใช้เฉพาะมูลค่า/จำนวนของ Tier นั้น (vS/vM/vL/vXL, s1+s3 …)
 *    ไม่มีเกณฑ์ราคา hardcode — เกณฑ์ Tier อยู่ที่ tier_rules ฝั่ง DB ตั้งแต่ตอนคำนวณ snapshot แล้ว
 *
 * ข้อมูลทั้งหมดมาจาก v_branch_summary (ตัวเลขรวมรายสาขา ไม่มีข้อมูลรายลูกค้า)
 */
import { BRANCHES } from "@/lib/dashboard/branches";

export type Division = "central" | "province";
export type Tier = "S" | "M" | "L" | "XL";

export const TIERS: readonly Tier[] = ["S", "M", "L", "XL"];

/** แถวสรุป 1 สาขา × 1 เดือน — เฉพาะคอลัมน์ที่ Dashboard ใช้ (ไม่มี report_*, confirmed_*) */
export interface SummaryRow {
  /** เดือนรูปแบบ `YYYY-MM` (normalize แล้ว) */
  ym: string;
  /** ชื่อเขต เช่น "เขต 1" */
  zone: string;
  branch: string;
  division: Division;
  s1: number;
  s3: number;
  m1: number;
  m3: number;
  l1: number;
  l3: number;
  xl1: number;
  xl3: number;
  cust: number;
  vS: number;
  vM: number;
  vL: number;
  vXL: number;
  value: number;
}

const MONTH_ABBR = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

export interface ParsedMonth {
  /** `YYYY-MM` */
  ym: string;
  /** `MMM.YY` เช่น `SEP.26` */
  key: string;
}

/**
 * รับ month_key จาก DB ได้ 2 แบบ: `2026-09` หรือ `SEP.26` → คืน null ถ้าอ่านไม่ออก
 * (ปี 2 หลักถือเป็น 20xx)
 */
export function parseMonthKey(raw: string): ParsedMonth | null {
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
  if (iso) {
    const year = iso[1] as string;
    const month = Number(iso[2]);
    return { ym: raw, key: `${MONTH_ABBR[month - 1]}.${year.slice(-2)}` };
  }
  const abbr = /^([A-Za-z]{3})\.(\d{2})$/.exec(raw);
  if (abbr) {
    const idx = MONTH_ABBR.indexOf((abbr[1] as string).toUpperCase() as (typeof MONTH_ABBR)[number]);
    if (idx >= 0) {
      const ym = `20${abbr[2]}-${String(idx + 1).padStart(2, "0")}`;
      return { ym, key: `${MONTH_ABBR[idx]}.${abbr[2]}` };
    }
  }
  return null;
}

/** `YYYY-MM` → `MMM.YY` */
export function ymToKey(ym: string): string {
  return parseMonthKey(ym)?.key ?? ym;
}

/** เลื่อนเดือน `YYYY-MM` ไปข้างหน้า/ถอยหลัง delta เดือน */
export function shiftMonth(ym: string, delta: number): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/* ───────────── ตัวกรอง ───────────── */

export interface RowFilter {
  /** `all` = ทั้งประเทศ */
  division: Division | "all";
  /** `all` หรือชื่อเขต */
  zone: string;
  /** `all` หรือชื่อสาขา */
  branch: string;
}

export function filterRows(rows: readonly SummaryRow[], f: RowFilter): SummaryRow[] {
  return rows.filter(
    (r) =>
      (f.division === "all" || r.division === f.division) &&
      (f.zone === "all" || r.zone === f.zone) &&
      (f.branch === "all" || r.branch === f.branch),
  );
}

const BRANCH_ORDER: ReadonlyMap<string, number> = new Map(
  BRANCHES.map((b, i) => [b.branch, i]),
);

/** เรียงตามลำดับสาขามาตรฐาน SPEC §4 (สาขาที่ไม่รู้จักไปท้าย เรียงชื่อ) */
export function sortByBranchOrder(rows: readonly SummaryRow[]): SummaryRow[] {
  return [...rows].sort((a, b) => {
    const ia = BRANCH_ORDER.get(a.branch) ?? Number.MAX_SAFE_INTEGER;
    const ib = BRANCH_ORDER.get(b.branch) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib || a.branch.localeCompare(b.branch, "th");
  });
}

/** เรียงชื่อเขตตามเลขเขต (เขต 2 ก่อนเขต 10) */
export function sortZones(zones: Iterable<string>): string[] {
  const num = (z: string) => Number(/\d+/.exec(z)?.[0] ?? Number.MAX_SAFE_INTEGER);
  return [...new Set(zones)].sort((a, b) => num(a) - num(b) || a.localeCompare(b, "th"));
}

/* ───────────── ตัวเลขรวม ───────────── */

/** ค่าที่ใช้แสดงของ 1 แถวภายใต้ตัวกรอง Tier (ไม่เลือกเลย = ทุก Tier) */
export function rowMetrics(
  row: SummaryRow,
  tiers: ReadonlySet<Tier>,
): { value: number; cust: number } {
  if (tiers.size === 0) return { value: row.value, cust: row.cust };
  let value = 0;
  let cust = 0;
  if (tiers.has("S")) { value += row.vS; cust += row.s1 + row.s3; }
  if (tiers.has("M")) { value += row.vM; cust += row.m1 + row.m3; }
  if (tiers.has("L")) { value += row.vL; cust += row.l1 + row.l3; }
  if (tiers.has("XL")) { value += row.vXL; cust += row.xl1 + row.xl3; }
  return { value, cust };
}

export interface Totals {
  value: number;
  cust: number;
  branches: number;
}

export function sumMetrics(rows: readonly SummaryRow[], tiers: ReadonlySet<Tier>): Totals {
  let value = 0;
  let cust = 0;
  for (const r of rows) {
    const m = rowMetrics(r, tiers);
    value += m.value;
    cust += m.cust;
  }
  return { value, cust, branches: rows.length };
}

/** ผลรวมทุกฟิลด์ตัวเลขของตาราง 16 ฟิลด์ (แถวรวมท้ายตาราง) */
export type FieldTotals = Omit<SummaryRow, "ym" | "zone" | "branch" | "division">;

export function sumFields(rows: readonly SummaryRow[]): FieldTotals {
  const t: FieldTotals = {
    s1: 0, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    cust: 0, vS: 0, vM: 0, vL: 0, vXL: 0, value: 0,
  };
  for (const r of rows) {
    t.s1 += r.s1; t.s3 += r.s3; t.m1 += r.m1; t.m3 += r.m3;
    t.l1 += r.l1; t.l3 += r.l3; t.xl1 += r.xl1; t.xl3 += r.xl3;
    t.cust += r.cust; t.vS += r.vS; t.vM += r.vM; t.vL += r.vL; t.vXL += r.vXL;
    t.value += r.value;
  }
  return t;
}

/** อัตราเปลี่ยนแปลงเป็น % (เช่น 0.4 = +0.4%) · null เมื่อไม่มีฐานเทียบ (prev ว่างหรือ 0) */
export function changePct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/* ───────────── อันดับสาขา ───────────── */

export type RankSort = "value" | "cust";

export interface RankItem {
  branch: string;
  zone: string;
  value: number;
  cust: number;
  /** % เทียบเดือนก่อนของสาขานั้น (ตามตัวกรอง Tier) */
  mom: number | null;
}

export function rankBranches(
  rows: readonly SummaryRow[],
  prevRows: readonly SummaryRow[],
  tiers: ReadonlySet<Tier>,
  sortBy: RankSort,
): RankItem[] {
  const prevByBranch = new Map(prevRows.map((r) => [r.branch, rowMetrics(r, tiers)]));
  const items = rows.map((r): RankItem => {
    const m = rowMetrics(r, tiers);
    const prev = prevByBranch.get(r.branch);
    return {
      branch: r.branch,
      zone: r.zone,
      value: m.value,
      cust: m.cust,
      mom: changePct(sortBy === "value" ? m.value : m.cust, prev ? (sortBy === "value" ? prev.value : prev.cust) : null),
    };
  });
  return items.sort(
    (a, b) =>
      b[sortBy] - a[sortBy] ||
      (BRANCH_ORDER.get(a.branch) ?? 0) - (BRANCH_ORDER.get(b.branch) ?? 0),
  );
}

/* ───────────── กราฟรายเดือน ───────────── */

export interface TrendPoint {
  ym: string;
  key: string;
  central: number;
  province: number;
}

/**
 * มูลค่ารายเดือนแยก ส่วนกลาง / ต่างจังหวัด (เรียงเก่า→ใหม่)
 * ใช้แถวที่ผ่านตัวกรอง เขต/สาขา แล้ว (ไม่กรองหน่วยงาน เพราะกราฟนี้เทียบสองหน่วยงาน)
 */
export function buildTrend(
  rowsByMonth: ReadonlyMap<string, readonly SummaryRow[]>,
  filter: Pick<RowFilter, "zone" | "branch">,
  tiers: ReadonlySet<Tier>,
): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const ym of [...rowsByMonth.keys()].sort()) {
    const rows = filterRows(rowsByMonth.get(ym) ?? [], { division: "all", ...filter });
    let central = 0;
    let province = 0;
    for (const r of rows) {
      const v = rowMetrics(r, tiers).value;
      if (r.division === "central") central += v;
      else province += v;
    }
    points.push({ ym, key: ymToKey(ym), central, province });
  }
  return points;
}

export function groupByMonth(rows: readonly SummaryRow[]): Map<string, SummaryRow[]> {
  const map = new Map<string, SummaryRow[]>();
  for (const r of rows) {
    const list = map.get(r.ym);
    if (list) list.push(r);
    else map.set(r.ym, [r]);
  }
  return map;
}
