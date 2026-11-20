/**
 * ชั้นอ่านข้อมูลของหน้า "รายละเอียดลูกค้า" (/customers/[id]) — ฝั่ง server
 *
 * Logic summary:
 *   * รับ Supabase client ของผู้ใช้จริง (RLS ทำงาน · ห้าม service role) · ทุก select ระบุคอลัมน์ ไม่ใช้ `select('*')`
 *   * โหลดทั้งหมดของลูกค้า 1 ราย: ข้อมูลลูกค้า/เบอร์ → สัญญา (+ทีม) → สถานี/การเข้า/ผลตรวจ/ไฟล์/ผลตัดสินตกบริการ/เปลี่ยนไม้
 *   * ผลตรวจ (station_checks) โหลดเฉพาะแถวที่ "พบปลวก" (ตรวจแล้ว + มีกลุ่ม/สัดส่วนปลวก) — แถวอื่นไม่ใช้ในหน้านี้ ลดปริมาณข้อมูล
 *   * เพดานแถว: ตารางที่อาจเกิน 1,000 แถวอ่านเป็นหน้าๆ (fetchAll) หยุดที่ ROW_CAP · ถ้าชนเพดานตั้ง `truncated`
 *     ให้หน้าจอเตือน — ไม่ตัดแถวเงียบๆ
 *   * ไทม์ไลน์ (audit_log) อ่านเฉพาะ host (RLS ก็บังคับ) · เก็บเฉพาะ "ชื่อช่องที่เปลี่ยน" ส่งให้หน้าจอ ไม่ส่งค่าเก่า/ใหม่ (ข้อมูลส่วนบุคคล)
 *   * อ่านพลาด = คืน error ให้หน้าจอแจ้งชัด · ไม่ log ข้อมูลลูกค้า (log เฉพาะ code/message ของ DB)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { effectiveEndDate, tierOf, annualValueForTerm, type TierRule } from "@/lib/rules";
import { monthOf } from "@/lib/rules/date";
import { currentBangkokMonth, todayBangkok } from "@/lib/service/months";
import { termMonthsOf } from "@/lib/service/termMonths";
import { TIER_RULE_COLUMNS, toTierRules, type TierRuleRow } from "@/lib/tierRules";
import type { UserRole } from "@/lib/db/types";

import { effectiveContractStatus } from "@/components/todo/contractEnd";

import { changedFieldNames } from "./logic";
import type {
  AuditEntry,
  CheckRow,
  ContractRow,
  ContractStatus,
  CustomerDetailData,
  CustomerInfo,
  FileRow,
  PhoneRow,
  ResolutionRow,
  StationRow,
  StationStatus,
  StationType,
  TimberMonth,
  VisitRow,
  VisitType,
} from "./types";

const PAGE = 1000;
/** เพดานรวมต่อชุดข้อมูล (กันหน้าหนักผิดปกติ) */
export const ROW_CAP = 5000;
const CHUNK = 60;
const AUDIT_LIMIT = 300;

type Err = { message: string; code?: string } | null;

/** ข้อความ error ภายใน = รหัสเท่านั้น (ข้อความดิบของ Postgres อาจมีค่าข้อมูลลูกค้า — ห้ามส่งต่อ/ห้าม log) */
function dbErr(e: { code?: string | null }): string {
  return `db-error:${e.code ?? "unknown"}`;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** อ่านเป็นหน้าๆ จนหมด หรือชน ROW_CAP (ตั้ง capped) */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: Err }>,
): Promise<{ rows: T[]; error: string | null; capped: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < ROW_CAP; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error: dbErr(error), capped: false };
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, error: null, capped: false };
  }
  return { rows, error: null, capped: true };
}

type CustomerDb = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  contact_name: string | null;
  note: string | null;
  customer_type: string | null;
  branch_id: string;
  contact_updated_at: string | null;
  contact_updated_by: string | null;
  contact_cross_team: boolean;
  branches: { name: string; zone_id: string; zones: { name: string } | null } | null;
};

type ContractDb = {
  id: string;
  contract_no: string;
  start_date: string;
  end_date: string | null;
  term_months: number;
  value_total: number | string;
  sale_type: "new" | "renew" | null;
  status: ContractStatus;
  closed_at: string | null;
  cancelled_at: string | null;
  renewed_from_contract_id: string | null;
  stations_initialized_at: string | null;
  contract_teams: { teams: { code: string } | null }[];
};

const CONTRACT_COLUMNS =
  "id, contract_no, start_date, end_date, term_months, value_total, sale_type, status, closed_at, cancelled_at, renewed_from_contract_id, stations_initialized_at, contract_teams ( teams ( code ) )";

/**
 * แปลงแถวสัญญา → ContractRow
 * `status` = สถานะที่ใช้ตัดสินบนหน้าจอ: สัญญา active ที่เลยวันสิ้นสุด (เวลาไทย `today`) ถือเป็น expired_pending_collection
 * (ไม่มีงานเบื้องหลังตั้งสถานะนี้ให้เอง — นิยามกลางที่ components/todo/contractEnd.ts) · สถานะดิบเก็บใน `dbStatus`
 */
export function toContractRow(c: ContractDb, rules: TierRule[], today: string = todayBangkok()): ContractRow {
  const termMonths = termMonthsOf(c.term_months);
  const valueTotal = Number(c.value_total);
  const end = effectiveEndDate({ startDate: c.start_date, termMonths, ...(c.end_date ? { endDate: c.end_date } : {}) });
  return {
    id: c.id,
    no: c.contract_no,
    startDate: c.start_date,
    endDate: c.end_date,
    termMonths,
    valueTotal,
    saleType: c.sale_type,
    status: effectiveContractStatus(c.status, end, today),
    dbStatus: c.status,
    closedAt: c.closed_at,
    cancelledAt: c.cancelled_at,
    renewedFromId: c.renewed_from_contract_id,
    stationsInitializedAt: c.stations_initialized_at,
    teamCodes: c.contract_teams.map((t) => t.teams?.code).filter((x): x is string => !!x),
    tier: tierOf(annualValueForTerm(valueTotal, termMonths), rules, monthOf(c.start_date)),
  };
}

/** รหัสสถานีที่แสดง: ใช้ code ในฐานข้อมูลถ้ามี ไม่งั้น ชนิด-เลข */
export function stationCodeOf(type: StationType, no: number | null, code: string | null): string {
  if (code && code.trim()) return code;
  return no !== null ? `${type}-${no}` : type;
}

export async function loadCustomerDetail(
  supabase: SupabaseClient,
  args: { customerId: string; role: UserRole; myTeamId: string | null },
): Promise<{ data: CustomerDetailData | null; notFound: boolean; error: string | null }> {
  const fail = (error: string) => ({ data: null, notFound: false, error });
  const today = todayBangkok();
  const currentMonth = currentBangkokMonth();

  // 1) ลูกค้า (RLS: ไม่มีสิทธิ์/ไม่พบ = ไม่มีแถว)
  const cu = await supabase
    .from("customers")
    .select(
      "id, name, address, phone, contact_name, note, customer_type, branch_id, contact_updated_at, contact_updated_by, contact_cross_team, branches ( name, zone_id, zones ( name ) )",
    )
    .eq("id", args.customerId)
    .maybeSingle();
  if (cu.error) return fail(dbErr(cu.error));
  if (!cu.data) return { data: null, notFound: true, error: null };
  const c = cu.data as unknown as CustomerDb;

  // 2) ข้อมูลอ้างอิง + เบอร์ + สัญญา
  const [phonesRes, contractsRes, rulesRes, typeRes, deadlineRes, myTeamRes, closuresRes] = await Promise.all([
    supabase.from("customer_phones").select("id, phone, label, sort_order, created_at").eq("customer_id", c.id).order("sort_order").order("created_at"),
    supabase.from("contracts").select(CONTRACT_COLUMNS).eq("customer_id", c.id).order("start_date", { ascending: false }),
    supabase.from("tier_rules").select(TIER_RULE_COLUMNS).order("effective_month").order("min_annual"),
    c.customer_type
      ? supabase.from("customer_types").select("label").eq("code", c.customer_type).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc("missed_makeup_deadline_months"),
    args.myTeamId ? supabase.from("teams").select("code").eq("id", args.myTeamId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("month_closures").select("month_key").eq("scope", "central").not("closed_at", "is", null),
  ]);
  for (const r of [phonesRes, contractsRes, rulesRes, typeRes, deadlineRes, myTeamRes]) {
    if (r.error) {
      console.error("[customer-detail] load error code:", (r.error as { code?: string }).code);
      return fail(dbErr(r.error as { code?: string }));
    }
  }

  const tierRules = toTierRules((rulesRes.data ?? []) as TierRuleRow[]);
  let contracts: ContractRow[];
  try {
    contracts = ((contractsRes.data ?? []) as unknown as ContractDb[]).map((x) => toContractRow(x, tierRules, todayBangkok()));
  } catch {
    return fail("อ่านข้อมูลสัญญาไม่ได้ (ค่าระยะสัญญาไม่ถูกต้อง)");
  }
  const contractIds = contracts.map((x) => x.id);
  const contractNoById = new Map(contracts.map((x) => [x.id, x.no]));

  let truncated = false;
  const stationRows: StationRow[] = [];
  const visits: VisitRow[] = [];
  const checks: CheckRow[] = [];
  const files: FileRow[] = [];
  const resolutions: ResolutionRow[] = [];
  const timber: TimberMonth[] = [];
  const userIds = new Set<string>();
  if (c.contact_updated_by) userIds.add(c.contact_updated_by);

  if (contractIds.length > 0) {
    // 3) สถานี + ที่ย้ายมา
    const stRes = await fetchAll<{
      id: string;
      contract_id: string;
      type: StationType;
      station_no: number | null;
      code: string | null;
      point_label: string | null;
      installed_at: string | null;
      status: StationStatus;
      removed_at: string | null;
      collected_at: string | null;
      not_collected_on: string | null;
      not_collected_reason: string | null;
    }>((from, to) =>
      supabase
        .from("stations")
        .select("id, contract_id, type, station_no, code, point_label, installed_at, status, removed_at, collected_at, not_collected_on, not_collected_reason")
        .in("contract_id", contractIds)
        .order("id")
        .range(from, to),
    );
    if (stRes.error) return fail(stRes.error);
    truncated ||= stRes.capped;
    const moved = await supabase.from("station_transfers").select("station_id, from_contract_id").in("to_contract_id", contractIds);
    if (moved.error) return fail(dbErr(moved.error));
    const movedFrom = new Map<string, string>();
    for (const m of (moved.data ?? []) as { station_id: string; from_contract_id: string }[]) {
      const no = contractNoById.get(m.from_contract_id);
      if (no) movedFrom.set(m.station_id, no);
    }
    for (const s of stRes.rows) {
      stationRows.push({
        id: s.id,
        contractId: s.contract_id,
        type: s.type,
        no: s.station_no,
        code: stationCodeOf(s.type, s.station_no, s.code),
        pointLabel: s.point_label,
        installedAt: s.installed_at,
        status: s.status,
        removedAt: s.removed_at,
        collectedAt: s.collected_at,
        notCollectedOn: s.not_collected_on,
        notCollectedReason: s.not_collected_reason,
        movedFromContractNo: movedFrom.get(s.id) ?? null,
      });
    }

    // 4) การเข้าบริการ (+ทีม) และวัสดุสรุปต่อครั้ง (v_service_materials)
    const viRes = await fetchAll<{
      id: string;
      contract_id: string;
      visit_date: string;
      visit_type: VisitType;
      start_time: string | null;
      end_time: string | null;
      duration_min: number | null;
      internal_inspection: boolean | null;
      signed_by_proxy: boolean | null;
      first_install: boolean | null;
      note: string | null;
      created_by: string | null;
      makeup_for_month: string | null;
      visit_teams: { teams: { code: string } | null }[];
    }>((from, to) =>
      supabase
        .from("visits")
        .select(
          "id, contract_id, visit_date, visit_type, start_time, end_time, duration_min, internal_inspection, signed_by_proxy, first_install, note, created_by, makeup_for_month, visit_teams ( teams ( code ) )",
        )
        .in("contract_id", contractIds)
        .order("visit_date", { ascending: false })
        .order("id")
        .range(from, to),
    );
    if (viRes.error) return fail(viRes.error);
    truncated ||= viRes.capped;
    const matRes = await fetchAll<{ visit_id: string; bait_outside_g: number; bait_inside_g: number; powder_points: number; timber_pcs: number }>((from, to) =>
      supabase
        .from("v_service_materials")
        .select("visit_id, bait_outside_g, bait_inside_g, powder_points, timber_pcs")
        .in("contract_id", contractIds)
        .order("visit_id")
        .range(from, to),
    );
    if (matRes.error) return fail(matRes.error);
    const mat = new Map(matRes.rows.map((m) => [m.visit_id, m]));
    for (const v of viRes.rows) {
      if (v.created_by) userIds.add(v.created_by);
      const m = mat.get(v.id);
      visits.push({
        id: v.id,
        contractId: v.contract_id,
        date: v.visit_date,
        type: v.visit_type,
        teamCodes: v.visit_teams.map((t) => t.teams?.code).filter((x): x is string => !!x),
        startTime: v.start_time ? v.start_time.slice(0, 5) : null,
        endTime: v.end_time ? v.end_time.slice(0, 5) : null,
        durationMin: v.duration_min,
        internalInspection: v.internal_inspection,
        signedByProxy: v.signed_by_proxy,
        timberPcs: m ? m.timber_pcs : null,
        baitIgIcG: m ? m.bait_outside_g : null,
        baitAgG: m ? m.bait_inside_g : null,
        powderPoints: m ? m.powder_points : null,
        firstInstall: v.first_install,
        note: v.note,
        createdByName: v.created_by,
        makeupForMonth: v.makeup_for_month,
      });
    }

    // 5) ผลตรวจที่พบปลวก (เป็นก้อนตามรหัสการเข้า)
    for (const part of chunks(
      visits.map((v) => v.id),
      CHUNK,
    )) {
      const chRes = await fetchAll<{
        visit_id: string;
        station_id: string;
        follow_up_no: number | null;
        termite_caste: string | null;
        termite_group: "subterranean" | "garden" | null;
        bait_added_g: number | null;
        note: string | null;
        checked: boolean;
      }>((from, to) =>
        supabase
          .from("station_checks")
          .select("visit_id, station_id, follow_up_no, termite_caste, termite_group, bait_added_g, note, checked")
          .in("visit_id", part)
          .eq("checked", true)
          .or("termite_caste.not.is.null,termite_group.not.is.null")
          .order("visit_id")
          .order("station_id")
          .range(from, to),
      );
      if (chRes.error) return fail(chRes.error);
      truncated ||= chRes.capped;
      for (const k of chRes.rows) {
        checks.push({
          visitId: k.visit_id,
          stationId: k.station_id,
          followUpNo: k.follow_up_no,
          caste: k.termite_caste,
          termiteGroup: k.termite_group,
          baitAddedG: k.bait_added_g,
          note: k.note,
          checked: k.checked,
        });
      }
    }

    // 6) ไฟล์แนบ · ผลตัดสินตกบริการ · เปลี่ยนไม้รายเดือน
    const [fRes, rRes, tRes] = await Promise.all([
      supabase
        .from("contract_files")
        .select("id, contract_id, kind, version, is_current, storage_path, file_name, size_bytes, reason, uploaded_at, uploaded_by")
        .in("contract_id", contractIds)
        .order("version"),
      supabase
        .from("missed_service_resolutions")
        .select("contract_id, missed_month, kind, reason, evidence_path, decided_by, decided_at")
        .in("contract_id", contractIds),
      supabase.from("v_contract_monthly_timber").select("contract_id, month, ig_station_nos, ic_station_nos").in("contract_id", contractIds).order("month"),
    ]);
    for (const r of [fRes, rRes, tRes]) if (r.error) return fail(dbErr(r.error));
    for (const f of (fRes.data ?? []) as {
      id: string;
      contract_id: string;
      kind: "contract_pdf" | "site_plan";
      version: number;
      is_current: boolean;
      storage_path: string;
      file_name: string;
      size_bytes: number;
      reason: string | null;
      uploaded_at: string;
      uploaded_by: string | null;
    }[]) {
      if (f.uploaded_by) userIds.add(f.uploaded_by);
      files.push({
        id: f.id,
        contractId: f.contract_id,
        kind: f.kind,
        version: f.version,
        isCurrent: f.is_current,
        storagePath: f.storage_path,
        fileName: f.file_name,
        sizeBytes: f.size_bytes,
        reason: f.reason,
        uploadedAt: f.uploaded_at,
        uploadedByName: f.uploaded_by,
      });
    }
    for (const r of (rRes.data ?? []) as {
      contract_id: string;
      missed_month: string;
      kind: "makeup" | "waived";
      reason: string | null;
      evidence_path: string | null;
      decided_by: string | null;
      decided_at: string | null;
    }[]) {
      if (r.decided_by) userIds.add(r.decided_by);
      resolutions.push({
        contractId: r.contract_id,
        missedMonth: r.missed_month,
        kind: r.kind,
        reason: r.reason,
        evidencePath: r.evidence_path,
        decidedByName: r.decided_by,
        decidedAt: r.decided_at,
      });
    }
    for (const t of (tRes.data ?? []) as { contract_id: string; month: string; ig_station_nos: number[] | null; ic_station_nos: number[] | null }[]) {
      timber.push({ contractId: t.contract_id, month: t.month, igNos: t.ig_station_nos ?? [], icNos: t.ic_station_nos ?? [] });
    }
  }

  // 7) ไทม์ไลน์ — host เท่านั้น
  let audit: AuditEntry[] | null = null;
  if (args.role === "host") {
    const phoneIds = ((phonesRes.data ?? []) as { id: string }[]).map((p) => p.id);
    const conds = [`row_id.eq.${c.id}`];
    if (contractIds.length) conds.push(`contract_id.in.(${contractIds.join(",")})`);
    if (phoneIds.length) conds.push(`row_id.in.(${phoneIds.join(",")})`);
    const aRes = await supabase
      .from("audit_log")
      .select("id, table_name, action, old_data, new_data, changed_by, changed_at, contract_id, month_key")
      .or(conds.join(","))
      .order("changed_at", { ascending: false })
      .limit(AUDIT_LIMIT);
    if (aRes.error) return fail(dbErr(aRes.error));
    audit = ((aRes.data ?? []) as {
      id: string;
      table_name: string;
      action: "insert" | "update" | "delete";
      old_data: Record<string, unknown> | null;
      new_data: Record<string, unknown> | null;
      changed_by: string | null;
      changed_at: string;
      contract_id: string | null;
      month_key: string | null;
    }[]).map((a) => {
      if (a.changed_by) userIds.add(a.changed_by);
      return {
        id: a.id,
        tableName: a.table_name,
        action: a.action,
        at: a.changed_at,
        byName: a.changed_by,
        contractId: a.contract_id,
        monthKey: a.month_key,
        changedFields: changedFieldNames(a.old_data, a.new_data),
      };
    });
  }

  // 8) ชื่อผู้ทำรายการ (อ่านไม่ได้ตามสิทธิ์ = แสดง "—" ไม่ทำให้หน้าพัง)
  const names = new Map<string, string>();
  for (const part of chunks([...userIds], CHUNK)) {
    const pr = await supabase.from("profiles").select("user_id, display_name, username").in("user_id", part);
    if (pr.error) {
      console.error("[customer-detail] profiles read skipped", (pr.error as { code?: string }).code);
      break;
    }
    for (const p of (pr.data ?? []) as { user_id: string; display_name: string | null; username: string }[]) {
      names.set(p.user_id, p.display_name?.trim() || p.username);
    }
  }
  const nm = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  for (const v of visits) v.createdByName = nm(v.createdByName);
  for (const f of files) f.uploadedByName = nm(f.uploadedByName);
  for (const r of resolutions) r.decidedByName = nm(r.decidedByName);
  for (const a of audit ?? []) a.byName = nm(a.byName);

  const customer: CustomerInfo = {
    id: c.id,
    name: c.name,
    address: c.address,
    legacyPhone: c.phone,
    contactName: c.contact_name,
    note: c.note,
    customerTypeLabel: (typeRes.data as { label: string } | null)?.label ?? null,
    branchId: c.branch_id,
    branchName: c.branches?.name ?? "—",
    zoneId: c.branches?.zone_id ?? "",
    zoneName: c.branches?.zones?.name ?? "—",
    contactUpdatedAt: c.contact_updated_at,
    contactUpdatedByName: nm(c.contact_updated_by),
    contactCrossTeam: c.contact_cross_team,
  };

  const closedMonths = closuresRes.error
    ? []
    : ((closuresRes.data ?? []) as { month_key: string }[]).map((m) => m.month_key.slice(0, 7));

  // วันสิ้นสุด: ตรวจว่า lib/rules อ่านค่าได้ (ไม่ throw) ก่อนส่งให้หน้าจอ
  for (const k of contracts) effectiveEndDate({ startDate: k.startDate, termMonths: k.termMonths, ...(k.endDate ? { endDate: k.endDate } : {}) });

  return {
    data: {
      customer,
      phones: ((phonesRes.data ?? []) as { id: string; phone: string; label: string | null; sort_order: number }[]).map(
        (p): PhoneRow => ({ id: p.id, phone: p.phone, label: p.label, sortOrder: p.sort_order }),
      ),
      contracts,
      stations: stationRows,
      visits,
      checks,
      files,
      resolutions,
      timber,
      audit,
      today,
      currentMonth,
      makeupDeadlineMonths: Number(deadlineRes.data ?? 12),
      myTeamCode: (myTeamRes.data as { code: string } | null)?.code ?? null,
      truncated,
      closedMonths,
      role: args.role,
    },
    notFound: false,
    error: null,
  };
}
