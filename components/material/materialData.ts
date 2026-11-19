/**
 * ชั้นอ่านข้อมูลของหน้า "สรุปงานบริการรายเดือน" (/material) — ฝั่ง server
 *
 * Logic summary:
 *   * รับ Supabase client ของผู้ใช้จริง (RLS ทำงาน · ห้าม service role) · select ระบุคอลัมน์ทุกครั้ง
 *   * **จุดเปลี่ยนจุดเดียว (BE กำลังทำ RPC รวมยอดวัสดุ):** `loadMonthVisits()` คือฟังก์ชันเดียวที่ดึงวัสดุ + ประเภทงาน + sale_type
 *     ของ 1 เดือน ตอนนี้อ่านจาก `v_service_materials` (ต่อการเข้า) + `visits`/`contracts`/`visit_teams` แล้วรวมเป็น `MaterialVisit[]`
 *     พอ RPC รวมยอด (เดือน, สาขา, ประเภทงาน, sale_type) มา ให้เปลี่ยนเฉพาะฟังก์ชันนี้ (ถ้า RPC คืนยอดรวมแล้ว ให้ปรับ
 *     `MaterialVisit` → แถวรวม และ `logic.ts` sumMaterials ให้รวมแถวรวมแทน) หน้าจอไม่ต้องแก้
 *   * PostgREST คืนสูงสุด 1,000 แถว/คำขอ → ดึงเป็นหน้าๆ (PAGE) ไม่เกิน MAX_PAGES · ถ้าชนเพดาน ตั้ง `truncated` ให้หน้าจอเตือน
 *     (ไม่แสดงตัวเลขต่ำกว่าจริงแบบเงียบๆ)
 *   * ภาระงาน: เกณฑ์ค่ากลางจาก `workload_hours_per_person()` — พอ BE รวม M42 ให้ดึง `team_workload_hours(team_id)` ที่
 *     `loadThresholds()` (ที่เดียว) · จำนวนคนจาก `teams.headcount`
 *   * กล่อง AG ต่อสาขา: RPC `ag_box_counts_by_branch(p_month)` (M25) — host/admin/recorder เท่านั้น
 *   * ไม่ดึงชื่อลูกค้าเลย (PDPA) · error คืนเป็นรหัส/ข้อความสั้น ไม่ log ข้อมูล
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { monthRange, shiftMonth } from "@/lib/service/months";
import { isTeamKind, type TeamKind } from "@/lib/service/teamKind";

import type { MaterialVisit, SaleType, VisitType } from "./logic";
import type { TeamThresholds } from "./workload";

const PAGE = 1000;
const MAX_PAGES = 30; // 30,000 แถว/เดือน — เกินนี้ถือว่าไม่ปกติ ให้เตือน

export interface BranchInfo {
  id: string;
  name: string;
  division: "central" | "province";
}

export interface TeamInfo {
  id: string;
  code: string;
  name: string;
  kind: TeamKind;
  branchId: string | null;
  headcount: number;
  isActive: boolean;
}

export interface AgBoxRow {
  branchId: string;
  /** กล่อง AG ที่ใช้งานอยู่ตอนนี้ */
  inUse: number;
  /** กล่อง AG ที่ตรวจจริงในเดือนที่เลือก */
  checked: number;
  /** เดือนก่อนหน้า */
  checkedPrev: number;
}

export interface MonthVisits {
  visits: MaterialVisit[];
  truncated: boolean;
}

export interface MaterialPageData {
  month: string;
  prevMonth: string;
  current: MonthVisits;
  previous: MonthVisits;
  branches: BranchInfo[];
  teams: TeamInfo[];
  thresholds: TeamThresholds;
  agBoxes: AgBoxRow[];
}

type Result<T> = { data: T; error: null } | { data: null; error: string };

/** อ่านทีละหน้าจนหมด · คืน truncated เมื่อชนเพดานหน้า */
async function fetchAll<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: Row[]; truncated: boolean; error: string | null }> {
  const rows: Row[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) return { rows, truncated: false, error: error.message };
    const got = (data ?? []) as Row[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}

interface MaterialViewRow {
  visit_id: string;
  bait_outside_g: number | null;
  bait_inside_g: number | null;
  powder_points: number | null;
  timber_pcs: number | null;
  install_bait_g: number | null;
}

interface VisitMetaRow {
  id: string;
  visit_type: VisitType;
  makeup_for_month: string | null;
  duration_min: number | null;
  internal_inspection: boolean | null;
  contracts: { sale_type: SaleType | null; customer_id: string; customers: { branch_id: string } | null } | null;
  visit_teams: { team_id: string }[] | null;
}

/**
 * วัสดุ + ประเภทงาน + sale_type ของ 1 เดือน — **จุดเปลี่ยนจุดเดียวเมื่อ BE ส่ง RPC รวมยอดมา**
 */
export async function loadMonthVisits(
  supabase: SupabaseClient,
  month: string,
): Promise<{ data: MonthVisits | null; error: string | null }> {
  const { from, toExclusive } = monthRange(month);

  const [mats, metas] = await Promise.all([
    fetchAll<MaterialViewRow>((a, b) =>
      supabase
        .from("v_service_materials")
        .select("visit_id, bait_outside_g, bait_inside_g, powder_points, timber_pcs, install_bait_g")
        .gte("visit_date", from)
        .lt("visit_date", toExclusive)
        .order("visit_id")
        .range(a, b),
    ),
    fetchAll<VisitMetaRow>((a, b) =>
      supabase
        .from("visits")
        .select(
          "id, visit_type, makeup_for_month, duration_min, internal_inspection, contracts ( sale_type, customer_id, customers ( branch_id ) ), visit_teams ( team_id )",
        )
        .gte("visit_date", from)
        .lt("visit_date", toExclusive)
        .order("id")
        .range(a, b),
    ),
  ]);
  if (mats.error) return { data: null, error: mats.error };
  if (metas.error) return { data: null, error: metas.error };

  const matById = new Map(mats.rows.map((r) => [r.visit_id, r]));
  const visits: MaterialVisit[] = [];
  for (const meta of metas.rows) {
    const branchId = meta.contracts?.customers?.branch_id;
    if (!branchId) continue; // สัญญา/ลูกค้าอ่านไม่ได้ตามสิทธิ์ → ไม่นับ (ไม่เดาสาขา)
    const m = matById.get(meta.id);
    visits.push({
      visitId: meta.id,
      branchId,
      customerId: meta.contracts?.customer_id ?? meta.id,
      internalInspection: meta.internal_inspection === true,
      visitType: meta.visit_type,
      makeupForMonth: meta.makeup_for_month,
      saleType: meta.contracts?.sale_type ?? null,
      teamIds: (meta.visit_teams ?? []).map((t) => t.team_id),
      durationMin: meta.duration_min,
      outsideG: m?.bait_outside_g ?? 0,
      insideG: m?.bait_inside_g ?? 0,
      installBaitG: m?.install_bait_g ?? 0,
      powderPoints: m?.powder_points ?? 0,
      timberPcs: m?.timber_pcs ?? 0,
    });
  }
  return { data: { visits, truncated: mats.truncated || metas.truncated }, error: null };
}

/** เกณฑ์ภาระงาน — **จุดเปลี่ยนจุดเดียวเมื่อ M42 เข้า main** (ดึง team_workload_hours ต่อทีมมาใส่ byTeam) */
async function loadThresholds(supabase: SupabaseClient): Promise<Result<TeamThresholds>> {
  const { data, error } = await supabase.rpc("workload_hours_per_person");
  if (error) return { data: null, error: error.message };
  const central = Number(data);
  if (!Number.isFinite(central) || central <= 0) return { data: null, error: "ค่าเกณฑ์ภาระงานไม่ถูกต้อง" };
  return { data: { central, byTeam: {} }, error: null };
}

async function loadAgBoxes(supabase: SupabaseClient, month: string): Promise<Result<AgBoxRow[]>> {
  const { data, error } = await supabase.rpc("ag_box_counts_by_branch", { p_month: `${month}-01` });
  if (error) return { data: null, error: error.message };
  const rows = (data ?? []) as {
    branch_id: string;
    ag_in_use: number | null;
    ag_checked: number | null;
    ag_checked_prev: number | null;
  }[];
  return {
    data: rows.map((r) => ({
      branchId: r.branch_id,
      inUse: r.ag_in_use ?? 0,
      checked: r.ag_checked ?? 0,
      checkedPrev: r.ag_checked_prev ?? 0,
    })),
    error: null,
  };
}

export async function loadMaterialPage(
  supabase: SupabaseClient,
  month: string,
): Promise<{ data: MaterialPageData | null; error: string | null }> {
  const prevMonth = shiftMonth(month, -1);
  const [current, previous, branches, teams, thresholds, ag] = await Promise.all([
    loadMonthVisits(supabase, month),
    loadMonthVisits(supabase, prevMonth),
    supabase.from("branches").select("id, name, division").eq("is_active", true).order("name"),
    supabase.from("teams").select("id, code, name, kind, branch_id, headcount, is_active").order("code"),
    loadThresholds(supabase),
    loadAgBoxes(supabase, month),
  ]);

  const failed =
    current.error ?? previous.error ?? branches.error?.message ?? teams.error?.message ?? thresholds.error ?? ag.error;
  if (failed || !current.data || !previous.data || !thresholds.data || !ag.data) {
    return { data: null, error: failed ?? "อ่านข้อมูลไม่สำเร็จ" };
  }

  return {
    data: {
      month,
      prevMonth,
      current: current.data,
      previous: previous.data,
      branches: ((branches.data ?? []) as { id: string; name: string; division: "central" | "province" }[]).map((b) => ({
        id: b.id,
        name: b.name,
        division: b.division,
      })),
      teams: ((teams.data ?? []) as {
        id: string;
        code: string;
        name: string;
        kind: string;
        branch_id: string | null;
        headcount: number | null;
        is_active: boolean | null;
      }[])
        .filter((t) => isTeamKind(t.kind))
        .map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          kind: t.kind as TeamKind,
          branchId: t.branch_id,
          headcount: t.headcount ?? 0,
          isActive: t.is_active ?? true,
        })),
      thresholds: thresholds.data,
      agBoxes: ag.data,
    },
    error: null,
  };
}
