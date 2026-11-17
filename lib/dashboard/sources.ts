/**
 * ประกอบ "แหล่งข้อมูล 3 ทาง" (legacy / computed / manual) จากแถวในฐานข้อมูล ก่อนส่งเข้า buildDashboardData (M27)
 * pure function ทั้งไฟล์ — ไม่แตะฐานข้อมูล (ตัวอ่านจริงอยู่ที่ supabaseSyncPorts.ts) เพื่อเทสได้ง่าย
 *
 * Logic summary (SPEC §7.6, §7.7, §9.1 · CLAUDE.md กฎ 7):
 *   ช่วงเดือนในไฟล์ = เดือน legacy ทั้งหมด (ก่อน go-live) + go-live … `lastMonth` (เดือนล่าสุดที่จบแล้ว ตามเวลาไทย)
 *   - legacy  : แถว `source = 'legacy'` ของเดือนก่อน go-live — **ไม่มีเลย = error `legacy_missing`**
 *               (กันไฟล์ใหม่เหลือ 1–2 เดือนแล้วทับประวัติบน Dashboard)
 *   - manual  : แถว `source = 'manual'` (ต่างจังหวัด) ของเดือน go-live … lastMonth
 *   - computed: สาขาส่วนกลาง ทีละเดือน go-live … lastMonth
 *       * เดือนที่ **ปิดส่วนกลางแล้ว** (`month_closures` scope central) → ใช้แถว `source = 'computed'` ที่เก็บไว้
 *         ตามเดิม **ห้ามคำนวณใหม่** (กฎ 7) · ไม่มีแถวเก็บไว้ = error `closed_snapshot_missing` (ไม่ส่งแถวศูนย์)
 *       * เดือนที่ยังไม่ปิด → คำนวณสดจากทะเบียนด้วย `buildBranchSnapshot` (สูตรเดียวกับ lib/rules)
 *   ค่าเงินที่คำนวณสดปัดเป็น 2 ตำแหน่ง (เหมือน numeric(14,2) ใน DB) กันเศษทศนิยมของ float
 *   ทำให้ "ข้อมูลไม่เปลี่ยน = ข้าม" พังเพราะต่างกันแค่หลักที่ 15
 */
import { buildBranchSnapshot } from "../rules/snapshot";
import { listMonths, monthOf } from "../rules/date";
import type { Contract, TierRule, Visit } from "../rules/types";
import { BRANCHES, type Branch } from "./branches";
import { DashboardSyncError } from "./errors";
import { toDashboardRow } from "./row";
import type { DashboardRow, DashboardSources, MonthlyRows } from "./types";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** แถว snapshot ที่อ่านจาก `monthly_branch_snapshots` (แปลงชื่อสาขาแล้ว · เดือน `YYYY-MM`) */
export interface StoredSnapshotRow extends DashboardRow {
  month: string;
  source: "computed" | "legacy" | "manual";
}

/** สัญญาพร้อมสาขาของลูกค้า (customers.branch_id → ชื่อสาขา) */
export interface BranchContract extends Contract {
  branch: string;
}

export interface CentralRegistry {
  contracts: readonly BranchContract[];
  visits: readonly Visit[];
  rules: readonly TierRule[];
}

export interface AssembleInput {
  /** `go_live_month()` แปลงเป็น `YYYY-MM` */
  goLiveMonth: string;
  /** เดือนล่าสุดที่จบแล้ว (เวลาไทย) `YYYY-MM` — เดือนปัจจุบันยังไม่ส่ง */
  lastMonth: string;
  snapshots: readonly StoredSnapshotRow[];
  /** เดือน (`YYYY-MM`) ที่ปิดส่วนกลางแล้ว */
  closedCentralMonths: ReadonlySet<string>;
  /** ทะเบียนส่วนกลางสำหรับคำนวณเดือนที่ยังไม่ปิด */
  registry: CentralRegistry;
}

const CENTRAL: readonly Branch[] = BRANCHES.filter((b) => b.division === "central");
const CENTRAL_NAMES: ReadonlySet<string> = new Set(CENTRAL.map((b) => b.branch));

/** เดือนปัจจุบัน `YYYY-MM` ตามเวลาไทย */
export function bangkokMonth(at: Date): string {
  return monthOf(at.toISOString());
}

/** เดือนก่อนหน้า `YYYY-MM` */
export function previousMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** เดือน from … to (รวมทั้ง 2 ฝั่ง) · to < from = ว่าง */
export function monthRange(from: string, to: string): string[] {
  if (to < from) return [];
  const count =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
    1;
  return listMonths(from, count);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** แถวส่วนกลางที่คำนวณสด 1 เดือน (24 สาขา · ค่าเงินปัด 2 ตำแหน่ง) */
export function computeCentralRows(registry: CentralRegistry, month: string): DashboardRow[] {
  const contractsByBranch = new Map<string, BranchContract[]>();
  for (const c of registry.contracts) {
    if (!CENTRAL_NAMES.has(c.branch)) continue;
    const list = contractsByBranch.get(c.branch) ?? [];
    list.push(c);
    contractsByBranch.set(c.branch, list);
  }
  const visitsByContract = new Map<string, Visit[]>();
  for (const v of registry.visits) {
    const list = visitsByContract.get(v.contractId) ?? [];
    list.push(v);
    visitsByContract.set(v.contractId, list);
  }

  return CENTRAL.map((b) => {
    const contracts = contractsByBranch.get(b.branch) ?? [];
    const visits = contracts.flatMap((c) => visitsByContract.get(c.id) ?? []);
    const row = toDashboardRow(
      buildBranchSnapshot(b, contracts, month, [...registry.rules], visits),
    );
    return {
      ...row,
      vS: round2(row.vS),
      vM: round2(row.vM),
      vL: round2(row.vL),
      vXL: round2(row.vXL),
      value: round2(row.value),
    };
  });
}

function addRow(target: MonthlyRows, month: string, row: DashboardRow): void {
  const list = (target[month] ?? []) as DashboardRow[];
  list.push(toDashboardRow(row));
  target[month] = list;
}

/**
 * ประกอบ DashboardSources จากแถวในฐานข้อมูล (ดู Logic summary หัวไฟล์)
 * throw `DashboardSyncError` เมื่อ: ไม่มี legacy เลย · เดือนส่วนกลางที่ปิดแล้วไม่มี snapshot
 */
export function assembleDashboardSources(input: AssembleInput): DashboardSources {
  const { goLiveMonth, lastMonth } = input;
  if (!MONTH_RE.test(goLiveMonth) || !MONTH_RE.test(lastMonth)) {
    throw new DashboardSyncError(
      "load_failed",
      `เดือนไม่ถูกรูปแบบ (go-live "${goLiveMonth}", ล่าสุด "${lastMonth}")`,
    );
  }

  const legacy: MonthlyRows = {};
  const manual: MonthlyRows = {};
  const storedComputed: MonthlyRows = {};

  for (const s of input.snapshots) {
    if (s.source === "legacy") {
      if (s.month < goLiveMonth) addRow(legacy, s.month, s);
    } else if (s.month >= goLiveMonth && s.month <= lastMonth) {
      if (s.source === "manual") addRow(manual, s.month, s);
      else if (CENTRAL_NAMES.has(s.branch)) addRow(storedComputed, s.month, s);
    }
  }

  if (Object.keys(legacy).length === 0) {
    throw new DashboardSyncError(
      "legacy_missing",
      "ยังไม่มีข้อมูล Dashboard เดิม (legacy) ในฐานข้อมูล — ต้องนำเข้าก่อน ไม่งั้นข้อมูลย้อนหลังบน Dashboard จะหาย",
    );
  }

  const computed: MonthlyRows = {};
  for (const month of monthRange(goLiveMonth, lastMonth)) {
    if (input.closedCentralMonths.has(month)) {
      // ต้องมีครบทุกสาขาส่วนกลาง — ขาดบางสาขาแล้วปล่อยไป buildDashboardData จะเติมแถวศูนย์เงียบๆ
      const stored = storedComputed[month] ?? [];
      const have = new Set(stored.map((r) => r.branch));
      const missing = CENTRAL.filter((b) => !have.has(b.branch)).length;
      if (missing > 0) {
        throw new DashboardSyncError(
          "closed_snapshot_missing",
          `เดือน ${month} ปิดส่วนกลางแล้วแต่ snapshot ที่เก็บไว้ขาด ${missing} สาขา — ระบบไม่คำนวณเดือนที่ปิดแล้วใหม่เอง ต้องกด "คำนวณ snapshot ใหม่"`,
        );
      }
      computed[month] = stored;
    } else {
      computed[month] = computeCentralRows(input.registry, month);
    }
  }

  return { legacy, computed, manual };
}
