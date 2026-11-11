import { monthKey } from "../rules/monthKey";
import { BRANCHES, BRANCH_COUNT, type Branch } from "./branches";
import { toDashboardRow } from "./row";
import type {
  DashboardData,
  DashboardRow,
  DashboardSources,
  MonthlyRows,
} from "./types";

/**
 * ประกอบไฟล์ dashboard_data.json จาก 3 แหล่ง (SPEC §9.1)
 *
 * กฎ "ยกค่าเดือนล่าสุด" (SPEC §6.5, §7.7 v1.5, §9.1):
 * - สาขา **ต่างจังหวัด** (`division = province`) เดือนไหนไม่มีข้อมูล → ใช้ค่าของเดือนล่าสุดที่มีข้อมูล
 * - สาขา **ส่วนกลาง** (`division = central`) ไม่ยกค่า — คำนวณจากทะเบียนเสมอ ไม่มีข้อมูล = แถวศูนย์
 * - ต่างจังหวัดที่ยังไม่เคยมีข้อมูลเลย (เดือนแรกของไฟล์) → แถวศูนย์ เพราะไม่มีค่าให้ยก
 *   (ไฟล์ต้องครบ 43 สาขาทุกเดือนเสมอ — ห้ามข้ามแถว)
 *
 * กฎ "ใช้เขตปัจจุบัน" (เจ้าของตัดสิน 11 พ.ย. 2026):
 * สาขาที่เคยย้ายเขต (พระราม 2 เขต 1 → เขต 13 · ปราจีนบุรี เขต 5 → เขต 13 ตั้งแต่ JUN.26)
 * ให้ใช้เขตปัจจุบันตามรายชื่อ 43 สาขากับ **ทุกเดือนรวมเดือนย้อนหลัง** — ไม่เก็บเขตเดิมของแถว legacy
 * เพื่อให้เทียบยอดรายเขตข้ามเดือนได้แบบเดียวกันตลอด (ยอดรวมทั้งประเทศไม่เปลี่ยน)
 */

/** ค้นหา Branch (area + division) จากชื่อสาขา — ใช้ยืนยันการสะกด + เติม area ที่ถูกต้อง */
const BRANCH_BY_NAME: ReadonlyMap<string, Branch> = new Map(
  BRANCHES.map((b) => [b.branch, b]),
);

/** แถวศูนย์สำหรับสาขาที่ไม่มีข้อมูลและไม่มีค่าให้ยกมา (ยังต้องมีครบ 43 สาขา — SPEC §9.1) */
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

/** รวบรวมคีย์เดือน (YYYY-MM) จากทุกแหล่ง เรียงจากเก่าไปใหม่ (จำเป็นต่อการยกค่าเดือนก่อน) */
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

export interface BuildDashboardDataOptions {
  /**
   * ยกค่าเดือนล่าสุดให้สาขาต่างจังหวัดที่เดือนนั้นไม่มีข้อมูล (ค่าตั้งต้น `true` ตาม SPEC §6.5)
   * ตั้ง `false` เมื่ออยากเห็นเฉพาะข้อมูลที่กรอกจริง (เช่น หน้าตรวจความครบก่อนปิดเดือน)
   */
  carryForwardProvince?: boolean;
}

/**
 * ประกอบ dashboard_data.json จาก 3 แหล่ง (SPEC §9.1)
 *
 * input ทุกแหล่ง key = `YYYY-MM` · output key = `MMM.YY` (แปลงด้วย monthKey)
 * รวมแบบ override ต่อ (เดือน, สาขา) ตาม precedence: legacy → computed → manual (ค่าหลังทับ)
 * ทุกเดือนรับประกันครบ 43 สาขา เรียงตามลำดับ SPEC §4
 * สาขาที่ไม่มีข้อมูลในเดือนนั้น: ต่างจังหวัด = ยกค่าเดือนล่าสุด · ส่วนกลาง = แถวศูนย์
 *
 * throw เมื่อ: ชื่อสาขาสะกดผิด/ไม่รู้จัก, สาขาซ้ำในแหล่งเดียวกันของเดือนเดียวกัน
 */
export function buildDashboardData(
  sources: DashboardSources,
  options: BuildDashboardDataOptions = {},
): DashboardData {
  const carryForward = options.carryForwardProvince ?? true;
  const out: DashboardData = {};

  /** ค่าล่าสุดที่ "มีข้อมูลจริง" ของแต่ละสาขาต่างจังหวัด (ไม่เก็บค่าที่ยกมา — ผลลัพธ์เท่ากันแต่ตามรอยง่ายกว่า) */
  const lastProvinceRow = new Map<string, DashboardRow>();

  for (const month of collectMonths(sources)) {
    const byBranch = new Map<string, DashboardRow>();
    applySource(byBranch, sources.legacy?.[month], month, "legacy");
    applySource(byBranch, sources.computed?.[month], month, "computed");
    applySource(byBranch, sources.manual?.[month], month, "manual");

    // เรียงตามลำดับสาขามาตรฐาน + เติมให้ครบ 43 (ยกค่าเดือนก่อน / แถวศูนย์)
    const rows = BRANCHES.map((b) => {
      const row = byBranch.get(b.branch);
      if (row) {
        if (b.division === "province") lastProvinceRow.set(b.branch, row);
        return row;
      }
      if (carryForward && b.division === "province") {
        const prev = lastProvinceRow.get(b.branch);
        if (prev) return { ...prev }; // copy — ห้ามใช้ reference ร่วมกันหลายเดือน
      }
      return zeroRow(b);
    });

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
