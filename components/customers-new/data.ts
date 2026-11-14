/**
 * ชั้นอ่านข้อมูลของหน้าเปิดงาน (ใช้ฝั่ง server จาก page.tsx)
 *
 * Logic summary:
 *   * รับ Supabase client ที่ล็อกอินด้วยผู้ใช้จริงเข้ามา — **ไม่ใช้ service role** RLS ทำงานตามสิทธิ์ผู้ใช้
 *   * ทุก select ระบุคอลัมน์ชัดเจน ไม่ใช้ `select('*')`
 *   * master (สาขา/เขต/ทีม/ประเภทลูกค้า/เกณฑ์ Tier) อ่านจากตารางจริง · เกณฑ์ Tier มาจาก `tier_rules`
 *   * สัญญาของเดือน = สัญญาที่ "วันเริ่ม" อยู่ในเดือนนั้น
 *   * `updatedAt` (M12) ถูกอ่านมากับสัญญาทุกใบ — ส่งกลับเป็น `p_expected_updated_at` ตอนแก้ · `loadContractById` ใช้โหลดแถวใหม่หลัง AG008
 *   * `auditCount` นับจาก audit_log เฉพาะ host (RLS ให้ host อ่านได้คนเดียว) — role อื่นได้ null
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { TermYears, TierRule } from "@/lib/rules";
import type { UserRole } from "@/lib/db/types";

import type { BranchOption } from "./branchMatch";
import type { ContractFileKind } from "./fileRules";
import { monthRange } from "@/lib/service/months";
import type { ContractFileRow, ContractStatus, MasterData, SaleType, SavedContract } from "./types";

/** ขอบบนของจำนวนสัญญาต่อเดือนที่ดึง (ไฟล์จริง ~133/เดือน) */
export const MONTH_ROW_LIMIT = 1000;

const FILE_COLUMNS =
  "id, kind, version, is_current, storage_path, file_name, size_bytes, was_compressed, reason, uploaded_at";

const CONTRACT_SELECT = `id, customer_id, contract_no, start_date, end_date, term_years, value_total, sale_type, status, sale_name, am_name,
       is_urgent, renewed_from_contract_id, mail_received_date, first_service_date, first_service_time, note, updated_at,
       customers ( name, customer_type, branch_id ),
       contract_teams ( team_id ),
       contract_files ( ${FILE_COLUMNS} )`;

type FileRowDb = {
  id: string;
  kind: ContractFileKind;
  version: number;
  is_current: boolean;
  storage_path: string;
  file_name: string;
  size_bytes: number;
  was_compressed: boolean;
  reason: string | null;
  uploaded_at: string;
};

export function toFileRow(r: FileRowDb): ContractFileRow {
  return {
    id: r.id,
    kind: r.kind,
    version: r.version,
    isCurrent: r.is_current,
    storagePath: r.storage_path,
    fileName: r.file_name,
    sizeBytes: r.size_bytes,
    wasCompressed: r.was_compressed,
    reason: r.reason,
    uploadedAt: r.uploaded_at,
  };
}

/** อ่านไฟล์แนบของสัญญาหนึ่งใบ (ใช้รีเฟรชหลังแนบ/ลบ) */
export async function fetchContractFiles(
  supabase: SupabaseClient,
  contractId: string,
): Promise<{ files: ContractFileRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("contract_files")
    .select(FILE_COLUMNS)
    .eq("contract_id", contractId)
    .order("kind", { ascending: true })
    .order("version", { ascending: true });
  if (error) return { files: [], error: error.message };
  return { files: ((data ?? []) as FileRowDb[]).map(toFileRow), error: null };
}

export async function loadMasterData(
  supabase: SupabaseClient,
): Promise<{ master: MasterData | null; error: string | null }> {
  const [zones, branches, teams, types, tiers] = await Promise.all([
    supabase.from("zones").select("id, name, sort_order").order("sort_order"),
    supabase
      .from("branches")
      .select("id, name, zone_id, division, is_active")
      .eq("is_active", true)
      .order("name"),
    // ทีมส่วนกลาง (branch_id ว่าง) — เฟส 1 ใช้ชุดนี้ชุดเดียว
    supabase.from("teams").select("id, code, branch_id").is("branch_id", null).order("code"),
    supabase
      .from("customer_types")
      .select("code, label, group_label, sort_order")
      .order("sort_order"),
    supabase.from("tier_rules").select("tier, min_annual").order("min_annual"),
  ]);

  const failed = [zones, branches, teams, types, tiers].find((r) => r.error);
  if (failed?.error) return { master: null, error: failed.error.message };

  const zoneRows = (zones.data ?? []) as { id: string; name: string }[];
  const zoneName = new Map(zoneRows.map((z) => [z.id, z.name]));

  const branchOptions: BranchOption[] = (
    (branches.data ?? []) as { id: string; name: string; zone_id: string }[]
  ).map((b) => ({
    id: b.id,
    name: b.name,
    zoneId: b.zone_id,
    zoneName: zoneName.get(b.zone_id) ?? "",
  }));

  const tierRules: TierRule[] = (
    (tiers.data ?? []) as { tier: TierRule["tier"]; min_annual: number | string }[]
  ).map((t) => ({ tier: t.tier, minAnnual: Number(t.min_annual) }));

  return {
    master: {
      zones: zoneRows.map((z) => ({ id: z.id, name: z.name })),
      branches: branchOptions,
      teams: sortTeams((teams.data ?? []) as { id: string; code: string }[]),
      customerTypes: (
        (types.data ?? []) as { code: string; label: string; group_label: string }[]
      ).map((t) => ({ code: t.code, label: t.label, groupLabel: t.group_label })),
      tierRules,
    },
    error: null,
  };
}

/** ทีม A–O ก่อน แล้ว Z แล้วที่เหลือ (Sup) */
export function sortTeams<T extends { code: string }>(teams: T[]): T[] {
  const rank = (code: string) => (/^[A-O]$/.test(code) ? 0 : code === "Z" ? 1 : 2);
  return [...teams].sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}

type ContractRowDb = {
  id: string;
  customer_id: string;
  contract_no: string;
  start_date: string;
  end_date: string | null;
  term_years: number;
  value_total: number | string;
  sale_type: SaleType | null;
  status: ContractStatus;
  sale_name: string | null;
  am_name: string | null;
  is_urgent: boolean;
  renewed_from_contract_id: string | null;
  mail_received_date: string | null;
  first_service_date: string | null;
  first_service_time: string | null;
  note: string | null;
  updated_at: string;
  customers: {
    name: string;
    customer_type: string | null;
    branch_id: string;
  } | null;
  contract_teams: { team_id: string }[] | null;
  contract_files: FileRowDb[] | null;
};

/** สัญญาที่เริ่มในเดือนนี้ พร้อมลูกค้า ทีม ไฟล์แนบ (และจำนวนประวัติถ้าเป็น host) */
export async function loadMonthContracts(
  supabase: SupabaseClient,
  month: string,
  role: UserRole,
): Promise<{ rows: SavedContract[]; truncated: boolean; error: string | null }> {
  const { from, toExclusive } = monthRange(month);
  const { data, error } = await supabase
    .from("contracts")
    .select(CONTRACT_SELECT)
    .gte("start_date", from)
    .lt("start_date", toExclusive)
    .order("contract_no", { ascending: true })
    .limit(MONTH_ROW_LIMIT);

  if (error) return { rows: [], truncated: false, error: error.message };

  const raw = (data ?? []) as unknown as ContractRowDb[];
  const rows = await toSavedContracts(supabase, raw, role);
  return { rows, truncated: raw.length >= MONTH_ROW_LIMIT, error: null };
}

/**
 * อ่านสัญญาใบเดียวตาม id (ค่าล่าสุดจากฐานข้อมูล) — ใช้ปุ่ม "โหลดแถวใหม่" หลังเจอ AG008 (มีคนแก้ไปก่อน)
 * `row: null` + `error: null` = ไม่พบ (ถูกลบแล้วหรือไม่มีสิทธิ์ดู)
 */
export async function loadContractById(
  supabase: SupabaseClient,
  contractId: string,
  role: UserRole,
): Promise<{ row: SavedContract | null; error: string | null }> {
  const { data, error } = await supabase
    .from("contracts")
    .select(CONTRACT_SELECT)
    .eq("id", contractId)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  if (!data) return { row: null, error: null };
  const [row] = await toSavedContracts(supabase, [data as unknown as ContractRowDb], role);
  return { row: row ?? null, error: null };
}

/** แปลงแถวจากฐานข้อมูลเป็น `SavedContract` (อ่านจำนวนประวัติ/เลขที่สัญญาเก่าเพิ่มตามที่ต้องใช้) */
async function toSavedContracts(
  supabase: SupabaseClient,
  raw: ContractRowDb[],
  role: UserRole,
): Promise<SavedContract[]> {
  const audit = role === "host" ? await loadAuditCounts(supabase, raw.map((r) => r.id)) : null;

  // เลขที่สัญญาเก่าของแถว Renew (สัญญาเก่าอาจอยู่คนละเดือน จึงอ่านแยก) · อ่านไม่ได้ = null (หน้าจอแสดง "โหลดไม่ได้")
  const oldIds = [...new Set(raw.map((r) => r.renewed_from_contract_id).filter((v): v is string => !!v))];
  const oldNo = await loadContractNos(supabase, oldIds);

  return raw
    .filter((r) => r.customers)
    .map((r) => ({
      contractId: r.id,
      customerId: r.customer_id,
      contractNo: r.contract_no,
      customerName: r.customers?.name ?? "",
      customerTypeCode: r.customers?.customer_type ?? null,
      branchId: r.customers?.branch_id ?? "",
      saleType: r.sale_type ?? "new",
      status: r.status,
      sellerName: r.sale_name?.trim() ? r.sale_name : (r.am_name ?? ""),
      sellerRole: r.sale_name?.trim() || !r.am_name?.trim() ? "sale" : "am",
      isUrgent: r.is_urgent,
      renewedFrom: r.renewed_from_contract_id
        ? { contractId: r.renewed_from_contract_id, contractNo: oldNo.get(r.renewed_from_contract_id) ?? null }
        : null,
      mailReceivedDate: r.mail_received_date ?? "",
      firstServiceDate: r.first_service_date ?? "",
      firstServiceTime: (r.first_service_time ?? "").slice(0, 5),
      note: r.note ?? "",
      startDate: r.start_date,
      endDate: r.end_date ?? "",
      termYears: (r.term_years === 3 ? 3 : 1) as TermYears,
      valueTotal: Number(r.value_total),
      teamIds: (r.contract_teams ?? []).map((t) => t.team_id),
      updatedAt: r.updated_at,
      files: (r.contract_files ?? [])
        .map(toFileRow)
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.version - b.version),
      // นับไม่ได้ (query ล้ม) = null + auditCountFailed → หน้าจอแสดง "โหลดไม่ได้" ไม่ใช่ 0
      auditCount: audit && !audit.failedIds.has(r.id) ? (audit.counts.get(r.id) ?? 0) : null,
      auditCountFailed: audit ? audit.failedIds.has(r.id) : false,
    }));
}

/** อ่านเลขที่สัญญาตาม id (แบ่งชุด) — ชุดที่ query ล้มจะไม่มี id ในผลลัพธ์ (ผู้เรียกแสดง "โหลดไม่ได้") */
export async function loadContractNos(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 80) {
    const { data, error } = await supabase
      .from("contracts")
      .select("id, contract_no")
      .in("id", ids.slice(i, i + 80));
    if (error) continue;
    for (const o of (data ?? []) as { id: string; contract_no: string }[]) result.set(o.id, o.contract_no);
  }
  return result;
}

/**
 * นับแถว audit_log ต่อสัญญา (host เท่านั้น) — แบ่งชุดกัน URL ยาวเกิน
 * ชุดที่ query ล้ม → เก็บ id ไว้ใน `failedIds` (ไม่ปล่อยให้กลายเป็น 0 เงียบๆ)
 */
export async function loadAuditCounts(
  supabase: SupabaseClient,
  contractIds: string[],
): Promise<{ counts: Map<string, number>; failedIds: Set<string> }> {
  const counts = new Map<string, number>();
  const failedIds = new Set<string>();
  const CHUNK = 80;
  for (let i = 0; i < contractIds.length; i += CHUNK) {
    const ids = contractIds.slice(i, i + CHUNK);
    const { data, error } = await supabase.from("audit_log").select("contract_id").in("contract_id", ids);
    if (error) {
      for (const id of ids) failedIds.add(id);
      continue;
    }
    for (const r of (data ?? []) as { contract_id: string | null }[]) {
      if (r.contract_id) counts.set(r.contract_id, (counts.get(r.contract_id) ?? 0) + 1);
    }
  }
  return { counts, failedIds };
}
