/**
 * ชั้นอ่านข้อมูลของหน้ากรอกข้อมูลทำบริการ (/service)
 *
 * Logic summary:
 *   * รับ Supabase client ของผู้ใช้จริง — **ไม่ใช้ service role** · RLS ทำงานตามสิทธิ์ · ทุก select ระบุคอลัมน์ ไม่ใช้ `select('*')`
 *   * ฝั่ง server (page.tsx): master (เขต/สาขา/ทีม A–O+Z/เกณฑ์ Tier) + รายชื่อสัญญาของ "เดือนที่เลือก" ตามสาขา
 *       - รายชื่อ = สัญญา active / รอเก็บสถานี ที่ `serviceMonths` ครอบเดือนนั้น (ปิดแล้ว/ยกเลิก = ซ่อน — AG007)
 *       - Tier คำนวณด้วย `tierOf` + `tier_rules` (ห้าม hardcode)
 *       - "กรอกแล้ว" = มีการเข้าแบบบริการประจำเดือน (`routine`) ในเดือนนั้นอย่างน้อย 1 ครั้ง (DECISIONS 2.23 · ตรงกฎตกบริการ
 *         SPEC §7.4 — งานซ่อม/ติดตามผล/ติดกล่องนอกรอบไม่ทำให้ขึ้น "กรอกแล้ว") · AG n = จำนวนกล่อง AG ที่ยังใช้งาน
 *       - ป้าย New/Renew เดือนนี้ = สัญญาเริ่มในเดือนที่เลือก (`start_date`) + `renewed_from_contract_id` (2.38 ค)
 *   * ฝั่ง client (เลือกรายแล้วโหลดรายละเอียด): สถานี · การเข้าในเดือน · ทีมจากการเข้าครั้งล่าสุด · ประวัติ F ของ AG ·
 *     สถานีสัญญาเก่า (Renew ที่ยังไม่ตั้งสถานี) · และรายละเอียดของการเข้าที่จะแก้
 *   * อ่านพลาด = คืน error ให้หน้าจอบอกชัด ไม่แสดงตัวเลขสมมติ
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { annualValue, serviceMonths, tierOf, type TierRule } from "@/lib/rules";

import { contractMonthTag } from "./contractTag";
import { monthRange, serviceTeams } from "./months";
import { trimDbTime } from "./timeInput";
import type {
  AgHistory,
  BranchOption,
  CheckRow,
  ContractDetail,
  ContractListItem,
  ContractStatus,
  LoadedVisit,
  StationRow,
  StationStatus,
  StationType,
  TeamOption,
  TermiteGroup,
  VisitSummary,
  VisitType,
  WorkKind,
  WorkRowDb,
  ZoneOption,
} from "./types";

export const CONTRACT_LIMIT = 1000;
const CHUNK = 80;
const STATION_LIMIT = 1000;

export interface ServiceMaster {
  zones: ZoneOption[];
  branches: BranchOption[];
  teams: TeamOption[];
  tierRules: TierRule[];
}

export async function loadServiceMaster(
  supabase: SupabaseClient,
): Promise<{ master: ServiceMaster | null; error: string | null }> {
  const [zones, branches, teams, tiers] = await Promise.all([
    supabase.from("zones").select("id, name, sort_order").order("sort_order"),
    supabase.from("branches").select("id, name, zone_id, is_active").eq("is_active", true).order("name"),
    supabase.from("teams").select("id, code, branch_id").is("branch_id", null).order("code"),
    supabase.from("tier_rules").select("tier, min_annual").order("min_annual"),
  ]);
  const failed = [zones, branches, teams, tiers].find((r) => r.error);
  if (failed?.error) return { master: null, error: failed.error.message };

  return {
    master: {
      zones: ((zones.data ?? []) as { id: string; name: string }[]).map((z) => ({ id: z.id, name: z.name })),
      branches: ((branches.data ?? []) as { id: string; name: string; zone_id: string }[]).map((b) => ({
        id: b.id,
        name: b.name,
        zoneId: b.zone_id,
      })),
      teams: serviceTeams((teams.data ?? []) as { id: string; code: string }[]),
      tierRules: ((tiers.data ?? []) as { tier: TierRule["tier"]; min_annual: number | string }[]).map((t) => ({
        tier: t.tier,
        minAnnual: Number(t.min_annual),
      })),
    },
    error: null,
  };
}

type ContractDb = {
  id: string;
  contract_no: string;
  customer_id: string;
  start_date: string;
  term_years: number;
  value_total: number | string;
  status: ContractStatus;
  renewed_from_contract_id: string | null;
  stations_initialized_at: string | null;
  customers: { name: string; branch_id: string } | null;
};

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * ตัวเลขสดของสัญญาเดียว (AG n + จำนวน routine ของเดือน) — เรียกหลังบันทึก/ลบเพื่อรีเฟรชรายชื่อทันที
 * (นับจากฐานข้อมูลจริง ไม่ใช้การบวก/ลบเอง เพราะการบันทึก 1 ครั้งเปลี่ยน AG ได้หลายจุด: ติดใหม่/ถอด)
 */
export async function loadContractCounts(
  supabase: SupabaseClient,
  contractId: string,
  month: string,
): Promise<{ agCount: number; routineCount: number; stationsInitialized: boolean } | null> {
  const { from, toExclusive } = monthRange(month);
  const [ag, routine, contract] = await Promise.all([
    supabase
      .from("stations")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", contractId)
      .eq("type", "AG")
      .in("status", ["active", "eliminated", "pending_removal"]),
    supabase
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", contractId)
      .eq("visit_type", "routine")
      .gte("visit_date", from)
      .lt("visit_date", toExclusive),
    supabase.from("contracts").select("stations_initialized_at").eq("id", contractId).maybeSingle(),
  ]);
  if (ag.error || routine.error || contract.error || !contract.data) return null;
  return {
    agCount: ag.count ?? 0,
    routineCount: routine.count ?? 0,
    stationsInitialized: (contract.data as { stations_initialized_at: string | null }).stations_initialized_at !== null,
  };
}

/** รายชื่อสัญญาของสาขาที่เลือกในเดือนที่เลือก */
export async function loadContractList(
  supabase: SupabaseClient,
  month: string,
  branchIds: readonly string[],
  tierRules: readonly TierRule[],
): Promise<{ items: ContractListItem[]; truncated: boolean; error: string | null }> {
  if (branchIds.length === 0) return { items: [], truncated: false, error: null };
  const { from, toExclusive } = monthRange(month);

  const { data, error } = await supabase
    .from("contracts")
    .select(
      `id, contract_no, customer_id, start_date, term_years, value_total, status, renewed_from_contract_id,
       stations_initialized_at, customers!inner ( name, branch_id )`,
    )
    .in("customers.branch_id", [...branchIds])
    .in("status", ["active", "expired_pending_collection"])
    .lt("start_date", toExclusive)
    .order("contract_no", { ascending: true })
    .limit(CONTRACT_LIMIT);
  if (error) return { items: [], truncated: false, error: error.message };

  const raw = ((data ?? []) as unknown as ContractDb[]).filter(
    (c) => c.customers && serviceMonths(c.start_date, c.term_years).includes(month),
  );
  const ids = raw.map((c) => c.id);

  const visitCount = new Map<string, number>();
  const agCount = new Map<string, number>();
  const results = await Promise.all(
    chunks(ids, CHUNK).map(async (part) => {
      const [v, a] = await Promise.all([
        supabase
          .from("visits")
          .select("contract_id")
          .in("contract_id", part)
          .eq("visit_type", "routine")
          .gte("visit_date", from)
          .lt("visit_date", toExclusive),
        supabase
          .from("stations")
          .select("contract_id")
          .in("contract_id", part)
          .eq("type", "AG")
          .in("status", ["active", "eliminated", "pending_removal"]),
      ]);
      return { v, a };
    }),
  );
  for (const r of results) {
    if (r.v.error) return { items: [], truncated: false, error: r.v.error.message };
    if (r.a.error) return { items: [], truncated: false, error: r.a.error.message };
    for (const x of (r.v.data ?? []) as { contract_id: string }[]) {
      visitCount.set(x.contract_id, (visitCount.get(x.contract_id) ?? 0) + 1);
    }
    for (const x of (r.a.data ?? []) as { contract_id: string }[]) {
      agCount.set(x.contract_id, (agCount.get(x.contract_id) ?? 0) + 1);
    }
  }

  const items: ContractListItem[] = raw.map((c) => {
    const years = (c.term_years === 3 ? 3 : 1) as 1 | 3;
    return {
      contractId: c.id,
      contractNo: c.contract_no,
      customerId: c.customer_id,
      customerName: c.customers?.name ?? "",
      branchId: c.customers?.branch_id ?? "",
      status: c.status,
      tier: tierOf(annualValue(Number(c.value_total), years), [...tierRules]),
      termYears: years,
      renewedFromContractId: c.renewed_from_contract_id,
      stationsInitialized: c.stations_initialized_at !== null,
      agCount: agCount.get(c.id) ?? 0,
      routineCountInMonth: visitCount.get(c.id) ?? 0,
      monthTag: contractMonthTag(c.start_date, c.renewed_from_contract_id, month),
    };
  });
  return { items, truncated: (data ?? []).length >= CONTRACT_LIMIT, error: null };
}

type StationDb = {
  id: string;
  type: StationType;
  station_no: number | null;
  status: StationStatus;
  point_label: string | null;
  install_bait_g: number | null;
  installed_at: string | null;
};

const toStation = (s: StationDb): StationRow => ({
  id: s.id,
  type: s.type,
  no: s.station_no,
  status: s.status,
  pointLabel: s.point_label ?? "",
  installBaitG: s.install_bait_g,
  installedAt: s.installed_at,
});

const STATION_COLUMNS = "id, type, station_no, status, point_label, install_bait_g, installed_at";

export async function loadStations(
  supabase: SupabaseClient,
  contractId: string,
): Promise<{ stations: StationRow[]; truncated: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("stations")
    .select(STATION_COLUMNS)
    .eq("contract_id", contractId)
    .order("type")
    .order("station_no", { ascending: true })
    .limit(STATION_LIMIT);
  if (error) return { stations: [], truncated: false, error: error.message };
  const rows = (data ?? []) as unknown as StationDb[];
  return { stations: rows.map(toStation), truncated: rows.length >= STATION_LIMIT, error: null };
}

type VisitDb = { id: string; visit_date: string; visit_type: VisitType; start_time: string; end_time: string };
const toVisit = (v: VisitDb): VisitSummary => ({
  id: v.id,
  visitDate: v.visit_date,
  visitType: v.visit_type,
  startTime: trimDbTime(v.start_time),
  endTime: trimDbTime(v.end_time),
});

/** รายละเอียดสัญญาที่เลือก (สถานี · การเข้าในเดือน · ทีมล่าสุด · ประวัติ F · สถานีสัญญาเก่า) */
export async function loadContractDetail(
  supabase: SupabaseClient,
  item: ContractListItem,
  month: string,
): Promise<{ detail: ContractDetail | null; error: string | null }> {
  const { from, toExclusive } = monthRange(month);
  const needsOld = !item.stationsInitialized && item.renewedFromContractId !== null;

  const [st, visits, last, old] = await Promise.all([
    loadStations(supabase, item.contractId),
    supabase
      .from("visits")
      .select("id, visit_date, visit_type, start_time, end_time")
      .eq("contract_id", item.contractId)
      .neq("visit_type", "follow_up") // ติดตามผลนอกรอบอยู่ที่หน้า "กล่อง AG นอกรอบประจำเดือน" (/bait)
      .gte("visit_date", from)
      .lt("visit_date", toExclusive)
      .order("visit_date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("visits")
      .select("visit_date, visit_teams ( team_id )")
      .eq("contract_id", item.contractId)
      .order("visit_date", { ascending: false })
      .limit(1),
    needsOld
      ? supabase
          .from("stations")
          .select(STATION_COLUMNS)
          .eq("contract_id", item.renewedFromContractId as string)
          .in("status", ["active", "eliminated", "pending_removal"])
          .order("type")
          .order("station_no", { ascending: true })
          .limit(STATION_LIMIT)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (st.error) return { detail: null, error: st.error };
  if (visits.error) return { detail: null, error: visits.error.message };
  if (last.error) return { detail: null, error: last.error.message };
  if (old.error) return { detail: null, error: old.error.message };

  const oldStations = ((old.data ?? []) as StationDb[]).map(toStation);
  // ประวัติ F ของกล่อง AG ของสัญญานี้ + ของสัญญาเก่าที่จะย้ายมา (Renew)
  const agIds = [...st.stations, ...oldStations].filter((s) => s.type === "AG").map((s) => s.id);
  const agHistory: AgHistory[] = [];
  if (agIds.length > 0) {
    const hist = await supabase
      .from("station_checks")
      .select("station_id, follow_up_no, visits!inner ( visit_date )")
      .in("station_id", agIds)
      .eq("checked", true);
    if (hist.error) return { detail: null, error: hist.error.message };
    const by = new Map<string, AgHistory>();
    for (const r of (hist.data ?? []) as unknown as {
      station_id: string;
      follow_up_no: number | null;
      visits: { visit_date: string } | null;
    }[]) {
      if (r.follow_up_no === null || !r.visits) continue;
      const h = by.get(r.station_id) ?? { stationId: r.station_id, checks: [] };
      h.checks.push({ visitDate: r.visits.visit_date, followUpNo: r.follow_up_no });
      by.set(r.station_id, h);
    }
    agHistory.push(...by.values());
  }

  const lastRow = ((last.data ?? []) as unknown as { visit_teams: { team_id: string }[] | null }[])[0];

  return {
    detail: {
      contractId: item.contractId,
      stations: st.stations,
      stationsTruncated: st.truncated,
      oldStations,
      visitsInMonth: ((visits.data ?? []) as unknown as VisitDb[]).map(toVisit),
      lastTeamIds: (lastRow?.visit_teams ?? []).map((t) => t.team_id),
      agHistory,
    },
    error: null,
  };
}

/** โหลดการเข้า 1 ครั้งเพื่อแก้ (ทีม · ผลตรวจ · งานซ่อม) */
export async function loadVisit(
  supabase: SupabaseClient,
  visitId: string,
): Promise<{ visit: LoadedVisit | null; error: string | null }> {
  const [v, teams, checks, works, removals] = await Promise.all([
    supabase.from("visits").select("id, visit_date, visit_type, start_time, end_time").eq("id", visitId).maybeSingle(),
    supabase.from("visit_teams").select("team_id").eq("visit_id", visitId),
    supabase
      .from("station_checks")
      .select(
        "station_id, checked, termite_group, termite_caste, bait_added_g, bait_eaten_pct, powder_points, timber_replaced, follow_up_no",
      )
      .eq("visit_id", visitId)
      .limit(2000),
    supabase.from("station_works").select("id, kind, station_type, station_nos, detail, created_at").eq("visit_id", visitId).order("created_at"),
    supabase.from("station_ag_removals").select("station_id").eq("visit_id", visitId),
  ]);
  const failed = [v, teams, checks, works, removals].find((r) => r.error);
  if (failed?.error) return { visit: null, error: failed.error.message };
  if (!v.data) return { visit: null, error: "ไม่พบการเข้าบริการนี้ (อาจถูกลบไปแล้ว)" };

  return {
    visit: {
      ...toVisit(v.data as unknown as VisitDb),
      teamIds: ((teams.data ?? []) as { team_id: string }[]).map((t) => t.team_id),
      removedStationIds: ((removals.data ?? []) as { station_id: string }[]).map((r) => r.station_id),
      checks: ((checks.data ?? []) as unknown as {
        station_id: string;
        checked: boolean;
        termite_group: TermiteGroup | null;
        termite_caste: string | null;
        bait_added_g: number | null;
        bait_eaten_pct: number | null;
        powder_points: number | null;
        timber_replaced: boolean;
        follow_up_no: number | null;
      }[]).map(
        (c): CheckRow => ({
          stationId: c.station_id,
          checked: c.checked,
          termiteGroup: c.termite_group,
          termiteCaste: c.termite_caste,
          baitAddedG: c.bait_added_g,
          baitEatenPct: c.bait_eaten_pct,
          powderPoints: c.powder_points,
          timberReplaced: c.timber_replaced,
          followUpNo: c.follow_up_no,
        }),
      ),
      works: ((works.data ?? []) as unknown as {
        id: string;
        kind: WorkKind;
        station_type: StationType;
        station_nos: number[];
        detail: string | null;
      }[]).map(
        (w): WorkRowDb => ({
          id: w.id,
          kind: w.kind,
          stationType: w.station_type,
          stationNos: [...w.station_nos].sort((a, b) => a - b),
          detail: w.detail ?? "",
        }),
      ),
    },
    error: null,
  };
}
