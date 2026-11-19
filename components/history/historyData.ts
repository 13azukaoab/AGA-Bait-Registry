/**
 * ชั้นอ่านข้อมูลหน้า "ประวัติการแก้ไข" — ใช้ได้ทั้ง server (page.tsx) และ client (กด "โหลดเพิ่ม" / ส่งออก)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้จริงเสมอ — RLS ของ audit_log อนุญาตเฉพาะ host อ่าน (ไม่ใช้ service role)
 *   * ชื่อผู้แก้: `audit_log.changed_by` อ้าง auth.users ไม่ใช่ profiles → embed ไม่ได้ ต้องโหลด profiles แยก
 *     (host อ่านได้ทุกแถว) แล้ว map เอง · ตำแหน่งใช้ `actor_position_code` (ตำแหน่ง ณ ตอนแก้ ไม่ใช่ตำแหน่งปัจจุบัน)
 *   * keyset: ดึง PAGE_SIZE+1 แถว เรียง changed_at DESC, id DESC (ดู historyQuery.ts)
 *   * กลุ่มการกรอกปกติ: ดึง visits (id, created_by, created_at, สาขาผ่านสัญญา→ลูกค้า) ทีละ 1,000 แถว
 *     สูงสุด MAX_VISIT_STAMPS · เกินนี้ตัดและบอกผู้ใช้ว่า "มากกว่า" (ไม่แสดงเหมือนครบ)
 *   * ⚠ PDPA: ผลลัพธ์มีข้อมูลลูกค้า — ห้าม console.log · error คืนแค่ code (ไม่คืน message ดิบ)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { bangkokRangeUtc, allowedBranchIds, applyAuditFilters, monthDateRange, PAGE_SIZE, type Cursor, type FilterLike } from "./historyQuery";
import type { VisitStamp } from "./historyGroups";
import type {
  AuditAction,
  AuditRow,
  BranchRef,
  ClosureRef,
  ContractInfo,
  HistoryFilters,
  HistoryRefs,
  PersonRef,
  PositionRef,
} from "./historyTypes";

export const MAX_VISIT_STAMPS = 5000;
const VISIT_CHUNK = 1000;
/** ส่งออกสูงสุดกี่แถวต่อครั้ง — เกินนี้ตัดและแจ้งผู้ใช้ให้ลดช่วง/ตัวกรอง */
export const MAX_EXPORT_ROWS = 20000;

export type LoadResult<T> = { ok: true; data: T } | { ok: false; code: string };

const AUDIT_COLUMNS =
  "id, table_name, row_id, action, old_data, new_data, changed_by, changed_at, branch_id, contract_id, month_key, actor_position_code";

interface AuditDb {
  id: string;
  table_name: string;
  row_id: string | null;
  action: AuditAction;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: string | null;
  changed_at: string;
  branch_id: string | null;
  contract_id: string | null;
  month_key: string | null;
  actor_position_code: string | null;
}

export function toAuditRow(r: AuditDb): AuditRow {
  return {
    id: r.id,
    tableName: r.table_name,
    rowId: r.row_id,
    action: r.action,
    oldData: r.old_data,
    newData: r.new_data,
    changedBy: r.changed_by,
    changedAt: r.changed_at,
    branchId: r.branch_id,
    contractId: r.contract_id,
    monthKey: r.month_key,
    actorPositionCode: r.actor_position_code,
  };
}

function fail(error: { code?: string } | null): { ok: false; code: string } {
  return { ok: false, code: error?.code ? String(error.code) : "UNKNOWN" };
}

// ---------- ข้อมูลอ้างอิง (server โหลดครั้งเดียวต่อหน้า) ----------

export async function loadHistoryRefs(supabase: SupabaseClient): Promise<LoadResult<HistoryRefs>> {
  const [br, pr, po, cl] = await Promise.all([
    supabase.from("branches").select("id, name, division, zone_id, zones ( name )").order("name"),
    supabase.from("profiles").select("user_id, display_name").order("display_name"),
    supabase.from("positions").select("code, name_th, short_name_th"),
    supabase.from("month_closures").select("month_key, scope, closed_at, last_resync_at"),
  ]);
  const err = br.error ?? pr.error ?? po.error ?? cl.error;
  if (err) return fail(err);

  const branches: BranchRef[] = (br.data ?? []).map((b: Record<string, unknown>) => {
    const zone = b.zones as { name: string } | { name: string }[] | null;
    const zoneName = Array.isArray(zone) ? (zone[0]?.name ?? "") : (zone?.name ?? "");
    return {
      id: b.id as string,
      name: b.name as string,
      division: b.division as "central" | "province",
      zoneId: b.zone_id as string,
      zoneName,
    };
  });
  const people: PersonRef[] = (pr.data ?? []).map((p: Record<string, unknown>) => ({
    userId: p.user_id as string,
    displayName: ((p.display_name as string | null) ?? "").trim() || "ไม่ระบุชื่อ",
  }));
  const positions: PositionRef[] = (po.data ?? []).map((p: Record<string, unknown>) => ({
    code: p.code as string,
    label: ((p.short_name_th as string | null) ?? "").trim() || (p.name_th as string),
  }));
  const closures: ClosureRef[] = (cl.data ?? []).map((c: Record<string, unknown>) => ({
    monthKey: c.month_key as string,
    scope: c.scope as "central" | "province",
    closedAt: (c.closed_at as string | null) ?? null,
    lastResyncAt: (c.last_resync_at as string | null) ?? null,
  }));
  return { ok: true, data: { branches, people, positions, closures } };
}

/** แปลงเลขสัญญา (ตรงตัว) เป็น id — ไม่เจอ = null */
export async function findContractByNo(supabase: SupabaseClient, contractNo: string): Promise<LoadResult<ContractInfo | null>> {
  const no = contractNo.trim();
  if (no === "") return { ok: true, data: null };
  const { data, error } = await supabase.from("contracts").select("id, contract_no, customers ( name )").eq("contract_no", no).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toContractInfo(data as Record<string, unknown>) : null };
}

function toContractInfo(r: Record<string, unknown>): ContractInfo {
  const cu = r.customers as { name: string } | { name: string }[] | null;
  const name = Array.isArray(cu) ? (cu[0]?.name ?? "") : (cu?.name ?? "");
  return { id: r.id as string, contractNo: r.contract_no as string, customerName: name };
}

/** เลขสัญญา + ชื่อลูกค้าของ contract id ที่ปรากฏในหน้า (ทีละก้อน กัน URL ยาว) */
export async function loadContractInfos(supabase: SupabaseClient, ids: readonly string[]): Promise<LoadResult<ContractInfo[]>> {
  const unique = [...new Set(ids)];
  const out: ContractInfo[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase
      .from("contracts")
      .select("id, contract_no, customers ( name )")
      .in("id", unique.slice(i, i + 100));
    if (error) return fail(error);
    for (const r of data ?? []) out.push(toContractInfo(r as Record<string, unknown>));
  }
  return { ok: true, data: out };
}

// ---------- audit_log (keyset) ----------

export interface AuditPage {
  rows: AuditRow[];
  /** null = ไม่มีหน้าถัดไป */
  next: Cursor | null;
}

export async function fetchAuditPage(
  supabase: SupabaseClient,
  filters: HistoryFilters,
  refs: Pick<HistoryRefs, "branches" | "closures">,
  cursor: Cursor | null,
): Promise<LoadResult<AuditPage>> {
  const base = supabase
    .from("audit_log")
    .select(AUDIT_COLUMNS)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  const filtered = applyAuditFilters(base as unknown as FilterLike, filters, refs, cursor);
  if (!filtered) return { ok: true, data: { rows: [], next: null } };

  const { data, error } = await (filtered as unknown as PromiseLike<{ data: AuditDb[] | null; error: { code?: string } | null }>);
  if (error || !data) return fail(error);
  const hasMore = data.length > PAGE_SIZE;
  const rows = data.slice(0, PAGE_SIZE).map(toAuditRow);
  const last = rows[rows.length - 1];
  return { ok: true, data: { rows, next: hasMore && last ? { changedAt: last.changedAt, id: last.id } : null } };
}

// ---------- กลุ่มการกรอกปกติ (visits) ----------

/** กลุ่มการกรอกปกติใช้ได้กับตัวกรองชุดนี้หรือไม่ (กลุ่มคือ "เพิ่ม ผลบริการ" ที่ไม่ใช่การแก้หลังปิด) */
export function groupsApplicable(f: HistoryFilters): boolean {
  if (f.postCloseOnly) return false;
  if (f.kinds.length > 0 && !f.kinds.includes("service")) return false;
  if (f.actions.length > 0 && !f.actions.includes("insert")) return false;
  return true;
}

export interface VisitStampResult {
  stamps: VisitStamp[];
  /** true = มีมากกว่า MAX_VISIT_STAMPS แถว ผลที่ได้เป็นแค่ส่วนที่ใหม่ที่สุด */
  truncated: boolean;
}

interface VisitDb {
  id: string;
  created_by: string | null;
  created_at: string;
  contracts: { customers: { branch_id: string } | { branch_id: string }[] | null } | { customers: { branch_id: string } | { branch_id: string }[] | null }[] | null;
}

function branchOfVisit(v: VisitDb): string | null {
  const c = Array.isArray(v.contracts) ? v.contracts[0] : v.contracts;
  const cu = c ? (Array.isArray(c.customers) ? c.customers[0] : c.customers) : null;
  return cu?.branch_id ?? null;
}

export async function fetchVisitStamps(
  supabase: SupabaseClient,
  filters: HistoryFilters,
  refs: Pick<HistoryRefs, "branches">,
): Promise<LoadResult<VisitStampResult>> {
  if (!groupsApplicable(filters)) return { ok: true, data: { stamps: [], truncated: false } };
  const branchIds = allowedBranchIds(filters, refs.branches);
  if (branchIds && branchIds.length === 0) return { ok: true, data: { stamps: [], truncated: false } };

  const range = bangkokRangeUtc(filters.from, filters.to);
  const stamps: VisitStamp[] = [];
  let truncated = false;

  for (let from = 0; from < MAX_VISIT_STAMPS; from += VISIT_CHUNK) {
    let qy = supabase
      .from("visits")
      .select("id, created_by, created_at, contracts!inner ( customers!inner ( branch_id ) )")
      .gte("created_at", range.gte)
      .lt("created_at", range.lt)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + VISIT_CHUNK - 1);
    if (filters.people.length) qy = qy.in("created_by", filters.people);
    if (branchIds) qy = qy.in("contracts.customers.branch_id", branchIds);
    if (filters.contractId) qy = qy.eq("contract_id", filters.contractId);
    if (filters.months.length) {
      qy = qy.or(
        filters.months
          .map((m) => {
            const r = monthDateRange(m);
            return `and(visit_date.gte.${r.start},visit_date.lt.${r.endExclusive})`;
          })
          .join(","),
      );
    }
    const { data, error } = await qy;
    if (error || !data) return fail(error);
    for (const v of data as unknown as VisitDb[]) {
      stamps.push({ id: v.id, createdBy: v.created_by, createdAt: v.created_at, branchId: branchOfVisit(v) });
    }
    if (data.length < VISIT_CHUNK) return { ok: true, data: { stamps, truncated } };
    if (from + VISIT_CHUNK >= MAX_VISIT_STAMPS) truncated = true;
  }
  return { ok: true, data: { stamps, truncated } };
}

export interface VisitDetail {
  id: string;
  visitDate: string;
  contractNo: string;
  customerName: string;
}

/** รายการย่อยของกลุ่ม (กางดู) — ดึงทีละก้อนตาม id ที่ขอ */
export async function fetchVisitDetails(supabase: SupabaseClient, ids: readonly string[]): Promise<LoadResult<VisitDetail[]>> {
  if (ids.length === 0) return { ok: true, data: [] };
  const { data, error } = await supabase
    .from("visits")
    .select("id, visit_date, contracts ( contract_no, customers ( name ) )")
    .in("id", ids.slice(0, 100))
    .order("created_at", { ascending: false });
  if (error || !data) return fail(error);
  const out: VisitDetail[] = (data as Record<string, unknown>[]).map((r) => {
    const c0 = r.contracts as { contract_no: string; customers: { name: string } | { name: string }[] | null } | null | unknown[];
    const c = (Array.isArray(c0) ? c0[0] : c0) as { contract_no: string; customers: { name: string } | { name: string }[] | null } | undefined;
    const cu = c ? (Array.isArray(c.customers) ? c.customers[0] : c.customers) : null;
    return { id: r.id as string, visitDate: r.visit_date as string, contractNo: c?.contract_no ?? "", customerName: cu?.name ?? "" };
  });
  return { ok: true, data: out };
}
