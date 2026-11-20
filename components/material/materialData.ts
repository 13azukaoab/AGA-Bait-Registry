/**
 * ชั้นอ่านข้อมูลของหน้า "สรุปงานบริการรายเดือน" (/material) — ฝั่ง server
 *
 * Logic summary:
 *   * รับ Supabase client ของผู้ใช้จริง (RLS ทำงาน · ห้าม service role) · select ระบุคอลัมน์ทุกครั้ง
 *   * วัสดุ: RPC `material_usage_summary(p_month, p_branch_id)` (M42 · แถวต่อ สาขา × ประเภทงาน × sale_type) เรียก 2 ครั้ง
 *     (เดือนนี้ + เดือนก่อน เพื่อ % เทียบ) ที่ `loadMonthUsage()` — **จุดดึงวัสดุจุดเดียว** · MU001 = เดือนไม่ใช่วันที่ 1 (ไม่เกิดเพราะส่งวันที่ 1 เสมอ)
 *   * การเข้ารายครั้ง (ไม่มีวัสดุ) `loadMonthVisits()` ใช้เฉพาะภาระงานรายทีม (เวลา + ทีม) และ "ตรวจภายใน" (นับลูกค้าไม่ซ้ำ)
 *     — เมื่อ BE ส่ง RPC สรุปตรวจภายใน (M43 `inside_inspection_summary`) มา เปลี่ยนส่วนตรวจภายในที่ฟังก์ชันนี้
 *   * PostgREST คืนสูงสุด 1,000 แถว/คำขอ → ดึงเป็นหน้าๆ (PAGE) ไม่เกิน MAX_PAGES · ถ้าชนเพดาน ตั้ง `truncated` ให้หน้าจอเตือน
 *   * เกณฑ์ภาระงาน: `team_workload_hours(team_id)` ต่อทีม (M42 · 2.88 · ค่าของทีมหรือค่ากลาง) ที่ `loadThresholds()` · จำนวนคนจาก `teams.headcount`
 *   * กล่อง AG ต่อสาขา: RPC `ag_box_counts_by_branch(p_month)` (M25)
 *   * ไม่ดึงชื่อลูกค้าเลย (PDPA) · error คืนเป็นข้อความสั้น ไม่ log ข้อมูล
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { monthRange, shiftMonth } from "@/lib/service/months";
import { isTeamKind, type TeamKind } from "@/lib/service/teamKind";

import type { CustomerGroup, MaterialVisit, UsageRow, WorkGroup } from "./logic";
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

export interface MonthData {
  /** วัสดุรวมแล้วจาก RPC (สาขา × ประเภทงาน × sale_type) */
  usage: UsageRow[];
  /** การเข้ารายครั้ง (ไม่มีวัสดุ) */
  visits: MaterialVisit[];
  truncated: boolean;
}

export interface MaterialPageData {
  month: string;
  prevMonth: string;
  current: MonthData;
  previous: MonthData;
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

interface UsageRpcRow {
  branch_id: string;
  work_group: string;
  sale_type: string;
  visit_count: number | null;
  bait_outside_g: number | string | null;
  bait_inside_g: number | string | null;
  powder_points: number | string | null;
  timber_pcs: number | string | null;
  install_bait_g: number | string | null;
}

const WORK_GROUPS: readonly WorkGroup[] = ["routine", "makeup", "problem"];
const CUSTOMER_GROUPS: readonly CustomerGroup[] = ["new", "renew", "unknown"];

/** bigint จาก PostgREST อาจมาเป็นข้อความ → แปลงเป็นตัวเลข */
const num = (v: number | string | null): number => Number(v ?? 0);

/** วัสดุของ 1 เดือนจาก RPC material_usage_summary — **จุดดึงวัสดุจุดเดียว** */
async function loadMonthUsage(supabase: SupabaseClient, month: string): Promise<Result<UsageRow[]>> {
  const { data, error } = await supabase.rpc("material_usage_summary", { p_month: `${month}-01`, p_branch_id: null });
  if (error) return { data: null, error: error.message };
  const rows: UsageRow[] = [];
  for (const r of (data ?? []) as UsageRpcRow[]) {
    const workGroup = WORK_GROUPS.find((g) => g === r.work_group);
    const saleType = CUSTOMER_GROUPS.find((g) => g === r.sale_type);
    if (!workGroup || !saleType) return { data: null, error: "รูปแบบข้อมูลสรุปวัสดุไม่ตรงที่คาด" };
    rows.push({
      branchId: r.branch_id,
      workGroup,
      saleType,
      visitCount: num(r.visit_count),
      outsideG: num(r.bait_outside_g),
      insideG: num(r.bait_inside_g),
      installBaitG: num(r.install_bait_g),
      powderPoints: num(r.powder_points),
      timberPcs: num(r.timber_pcs),
    });
  }
  return { data: rows, error: null };
}

interface VisitMetaRow {
  id: string;
  duration_min: number | null;
  internal_inspection: boolean | null;
  contracts: { customer_id: string; customers: { branch_id: string } | null } | null;
  visit_teams: { team_id: string }[] | null;
}

/** การเข้ารายครั้งของ 1 เดือน (ไม่มีวัสดุ) — สำหรับภาระงานรายทีมและตรวจภายใน */
async function loadMonthVisits(
  supabase: SupabaseClient,
  month: string,
): Promise<Result<{ visits: MaterialVisit[]; truncated: boolean }>> {
  const { from, toExclusive } = monthRange(month);
  const metas = await fetchAll<VisitMetaRow>((a, b) =>
    supabase
      .from("visits")
      .select("id, duration_min, internal_inspection, contracts ( customer_id, customers ( branch_id ) ), visit_teams ( team_id )")
      .gte("visit_date", from)
      .lt("visit_date", toExclusive)
      .order("id")
      .range(a, b),
  );
  if (metas.error) return { data: null, error: metas.error };

  const visits: MaterialVisit[] = [];
  for (const meta of metas.rows) {
    const branchId = meta.contracts?.customers?.branch_id;
    if (!branchId) continue; // สัญญา/ลูกค้าอ่านไม่ได้ตามสิทธิ์ → ไม่นับ (ไม่เดาสาขา)
    visits.push({
      visitId: meta.id,
      branchId,
      customerId: meta.contracts?.customer_id ?? meta.id,
      internalInspection: meta.internal_inspection === true,
      teamIds: (meta.visit_teams ?? []).map((t) => t.team_id),
      durationMin: meta.duration_min,
    });
  }
  return { data: { visits, truncated: metas.truncated }, error: null };
}

async function loadMonthData(supabase: SupabaseClient, month: string): Promise<Result<MonthData>> {
  const [usage, visits] = await Promise.all([loadMonthUsage(supabase, month), loadMonthVisits(supabase, month)]);
  if (usage.error !== null) return { data: null, error: usage.error };
  if (visits.error !== null) return { data: null, error: visits.error };
  return { data: { usage: usage.data, visits: visits.data.visits, truncated: visits.data.truncated }, error: null };
}

/** เกณฑ์ภาระงานต่อทีม: ค่ากลาง + `team_workload_hours(team_id)` (M42 · ค่าของทีมหรือค่ากลาง) */
async function loadThresholds(supabase: SupabaseClient, teamIds: readonly string[]): Promise<Result<TeamThresholds>> {
  const central = await supabase.rpc("workload_hours_per_person");
  if (central.error) return { data: null, error: central.error.message };
  const centralHours = Number(central.data);
  if (!Number.isFinite(centralHours) || centralHours <= 0) return { data: null, error: "ค่าเกณฑ์ภาระงานไม่ถูกต้อง" };

  const results = await Promise.all(teamIds.map((id) => supabase.rpc("team_workload_hours", { p_team_id: id })));
  const byTeam: Record<string, number> = {};
  for (const [i, r] of results.entries()) {
    const id = teamIds[i];
    if (!id) continue;
    if (r.error) return { data: null, error: r.error.message };
    const hours = Number(r.data);
    if (Number.isFinite(hours) && hours > 0) byTeam[id] = hours;
  }
  return { data: { central: centralHours, byTeam }, error: null };
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
  const [current, previous, branches, teamsRes, ag] = await Promise.all([
    loadMonthData(supabase, month),
    loadMonthData(supabase, prevMonth),
    supabase.from("branches").select("id, name, division").eq("is_active", true).order("name"),
    supabase.from("teams").select("id, code, name, kind, branch_id, headcount, is_active").order("code"),
    loadAgBoxes(supabase, month),
  ]);

  const failed = current.error ?? previous.error ?? branches.error?.message ?? teamsRes.error?.message ?? ag.error;
  if (failed || !current.data || !previous.data || !ag.data) {
    return { data: null, error: failed ?? "อ่านข้อมูลไม่สำเร็จ" };
  }

  const teams: TeamInfo[] = ((teamsRes.data ?? []) as {
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
    }));

  // RLS ของ visits อ่านได้ทุกส่วนงาน แต่วัสดุ (RPC) จำกัดตามขอบเขตส่วนงานของผู้ใช้ → ตัดการเข้า/สาขานอกขอบเขตออก
  // ให้ทุกส่วนของหน้าใช้ขอบเขตเดียวกัน (ขอบเขต = สาขาที่ ag_box_counts_by_branch คืนมา ซึ่งกรองตามส่วนงานแล้ว)
  const inScope = new Set(ag.data.map((a) => a.branchId));
  const scopeMonth = (m: MonthData): MonthData => ({
    ...m,
    usage: m.usage.filter((u) => inScope.has(u.branchId)),
    visits: m.visits.filter((v) => inScope.has(v.branchId)),
  });

  const thresholds = await loadThresholds(
    supabase,
    teams.map((t) => t.id),
  );
  if (!thresholds.data) return { data: null, error: thresholds.error };

  return {
    data: {
      month,
      prevMonth,
      current: scopeMonth(current.data),
      previous: scopeMonth(previous.data),
      branches: ((branches.data ?? []) as { id: string; name: string; division: "central" | "province" }[])
        .filter((b) => inScope.has(b.id))
        .map((b) => ({ id: b.id, name: b.name, division: b.division })),
      teams,
      thresholds: thresholds.data,
      agBoxes: ag.data,
    },
    error: null,
  };
}
