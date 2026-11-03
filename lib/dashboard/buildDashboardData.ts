import { monthKey } from "../rules/monthKey";
import { BRANCHES, BRANCH_COUNT, type Branch } from "./branches";
import { toDashboardRow } from "./row";
import type {
  DashboardData,
  DashboardRow,
  DashboardSources,
  MonthlyRows,
} from "./types";

/** ค้นหา Branch (area + division) จากชื่อสาขา — ใช้ยืนยันการสะกด + เติม area ที่ถูกต้อง */
const BRANCH_BY_NAME: ReadonlyMap<string, Branch> = new Map(
  BRANCHES.map((b) => [b.branch, b]),
);

/** แถวศูนย์สำหรับสาขาที่ไม่มีข้อมูลในเดือนนั้น (ยังต้องมีครบ 43 สาขา — SPEC §9.1) */
function zeroRow(b: Branch): DashboardRow {
  return {
    area: b.area,
    branch: b.branch,
    s1: 0, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    cust: 0, vS: 0, vM: 0, vL: 0, vXL: 0, value: 0,
  };
}

/**
 * ใส่แถวของ 1 แหล่งข้อมูลลงใน map ของเดือนนั้น (override ค่าเดิมต่อสาขา)
 * - ตรวจชื่อสาขาต้องอยู่ในรายชื่อ 43 สาขา (สะกดตรง) ไม่งั้น throw (กัน typo ทำแถวหลอก)
 * - บังคับใช้ area ตามรายชื่อมาตรฐาน (ชื่อสาขากำหนด area เอง)
 * - ห้ามซ้ำสาขาในแหล่งเดียวกันของเดือนเดียวกัน (สะท้อน bug ต้นทาง) → throw
 */
function applySource(
  target: Map<string, DashboardRow>,
  rows: readonly DashboardRow[] | undefined,
  month: string,
  sourceName: string,
): void {
  if (!rows) return;
  const seen = new Set<string>();
  for (const row of rows) {
    const branch = BRANCH_BY_NAME.get(row.branch);
    if (!branch) {
      throw new Error(
        `buildDashboardData: สาขา "${row.branch}" (${sourceName}, ${month}) ไม่อยู่ในรายชื่อ 43 สาขา — ตรวจการสะกด`,
      );
    }
    if (seen.has(row.branch)) {
      throw new Error(
        `buildDashboardData: สาขา "${row.branch}" ซ้ำใน ${sourceName} เดือน ${month}`,
      );
    }
    seen.add(row.branch);
    target.set(row.branch, { ...toDashboardRow(row), area: branch.area });
  }
}

/** รวบรวมคีย์เดือน (YYYY-MM) จากทุกแหล่ง */
function collectMonths(sources: DashboardSources): string[] {
  const months = new Set<string>();
  const add = (m?: MonthlyRows) => {
    if (m) for (const k of Object.keys(m)) months.add(k);
  };
  add(sources.legacy);
  add(sources.computed);
  add(sources.manual);
  return [...months].sort();
}

/**
 * ประกอบ dashboard_data.json จาก 3 แหล่ง (SPEC §9.1)
 *
 * input ทุกแหล่ง key = `YYYY-MM` · output key = `MMM.YY` (แปลงด้วย monthKey)
 * รวมแบบ override ต่อ (เดือน, สาขา) ตาม precedence: legacy → computed → manual (ค่าหลังทับ)
 * ทุกเดือนรับประกันครบ 43 สาขา (เติมแถวศูนย์ให้สาขาที่ไม่มีข้อมูล) เรียงตามลำดับ SPEC §4
 *
 * throw เมื่อ: ชื่อสาขาสะกดผิด/ไม่รู้จัก, สาขาซ้ำในแหล่งเดียวกันของเดือนเดียวกัน
 */
export function buildDashboardData(sources: DashboardSources): DashboardData {
  const out: DashboardData = {};

  for (const month of collectMonths(sources)) {
    const byBranch = new Map<string, DashboardRow>();
    applySource(byBranch, sources.legacy?.[month], month, "legacy");
    applySource(byBranch, sources.computed?.[month], month, "computed");
    applySource(byBranch, sources.manual?.[month], month, "manual");

    // เรียงตามลำดับสาขามาตรฐาน + เติมแถวศูนย์ให้ครบ 43
    const rows = BRANCHES.map((b) => byBranch.get(b.branch) ?? zeroRow(b));

    const key = monthKey(month);
    if (rows.length !== BRANCH_COUNT) {
      throw new Error(
        `buildDashboardData: เดือน ${key} มี ${rows.length} สาขา (ต้องครบ ${BRANCH_COUNT})`,
      );
    }
    out[key] = rows;
  }

  return out;
}
