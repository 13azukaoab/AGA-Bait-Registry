/**
 * ชั้นอ่านข้อมูลหน้า "ทะเบียนลูกค้า/สัญญา" — ใช้ได้ทั้ง server (page.tsx) และ client (โหลดเพิ่ม / เปลี่ยนตัวกรอง / ส่งออก)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้จริงเสมอ (ไม่ใช้ service role) — RLS: host/admin/recorder อ่านสัญญาได้ **ทุกสาขา** โดยตั้งใจ (M21)
 *     viewer อ่านตารางพวกนี้ไม่ได้ (PDPA) — หน้านี้ตรวจ role ที่ page.tsx ด้วย canAccessPath แล้ว
 *   * แบ่งหน้าแบบ keyset: ดึง limit+1 แถว (รู้ว่ามีหน้าต่อไปไหม) · ห้ามโหลดทั้งตาราง (หลังนำเข้าราว 2,400+ สัญญา)
 *   * Tier / สถานะที่แบ่งด้วยวันที่ ฐานข้อมูลกรองให้แม่นยำไม่ได้ (ไม่มีคอลัมน์ tier · ไม่มี view) →
 *     บีบผลฝั่งฐานข้อมูลเท่าที่ทำได้ก่อน แล้ว **กรองซ้ำแบบแม่นยำฝั่งแอป** เป็นก้อนละ POST_CHUNK แถว
 *     ต่อจน "ครบหน้า" หรือสแกนครบ MAX_POST_CHUNKS ก้อน — ถ้ายังไม่ครบหน้าแต่ยังมีข้อมูลต่อ จะคืน `next` ให้กด "โหลดเพิ่ม"
 *     พร้อม `scanned` (จำนวนสัญญาที่ตรวจแล้ว) · ไม่ตัดเงียบและไม่แกล้งบอกว่าครบ
 *   * จำนวนทั้งหมด (`dbTotal`) นับจาก query หน้าแรก (count exact) เฉพาะตัวกรองที่ฐานข้อมูลทำได้
 *   * Tier = tierOf(annualValueForTerm(มูลค่า, ระยะ), เกณฑ์, เดือนเริ่มสัญญา) จาก lib/rules — ไม่มีสูตรของตัวเอง
 *     เกณฑ์ที่ใช้กับเดือนนั้นไม่ได้ (rulesForMonth โยน error) → tier = null แสดง "—"
 *   * ⚠ PDPA: ผลลัพธ์มีชื่อลูกค้า — ห้าม console.log · error คืนแค่ code (ไม่คืน message ดิบ)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { bangkokDate } from "@/components/customer-detail/logic";
import { annualValueForTerm, effectiveEndDate, tierOf, type TierRule } from "@/lib/rules";
import { monthOf } from "@/lib/rules/date";
import { TIER_RULE_COLUMNS, toTierRules, type TierRuleRow } from "@/lib/tierRules";

import { needsPostFilter } from "./registryFilters";
import { applyRegistryFilters, PAGE_SIZE, SORTS, type FilterLike } from "./registryQuery";
import { registryStatus } from "./registryStatus";
import type { BranchRef, Cursor, DbContractStatus, RegistryFilters, RegistryRow } from "./registryTypes";

/** ขนาดก้อนตอนต้องกรองซ้ำฝั่งแอป */
export const POST_CHUNK = 200;
/** สแกนต่อเนื่องได้กี่ก้อนต่อการกด 1 ครั้ง (กันวนทั้งตารางในครั้งเดียว) */
export const MAX_POST_CHUNKS = 5;
/** ส่งออกสูงสุดกี่แถวต่อครั้ง — เกินนี้ตัดและแจ้งผู้ใช้ให้ลดตัวกรอง */
export const MAX_EXPORT_ROWS = 20000;
const EXPORT_CHUNK = 1000;

export type LoadResult<T> = { ok: true; data: T } | { ok: false; code: string };

export interface RegistryRefs {
  branches: BranchRef[];
  tierRules: TierRule[];
}

export interface PageData {
  rows: RegistryRow[];
  /** cursor หน้าถัดไป · null = ไม่มีต่อแล้ว */
  next: Cursor | null;
  /** จำนวนสัญญาที่ตรวจแล้วในการโหลดครั้งนี้ (ก่อนกรองซ้ำ) */
  scanned: number;
  /** จำนวนสัญญาที่ตรงตัวกรองฝั่งฐานข้อมูล (นับเฉพาะตอนโหลดหน้าแรก · ไม่ใช่หน้าแรก = null) */
  dbTotal: number | null;
}

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
export function todayBangkok(): string {
  return bangkokDate(new Date().toISOString());
}

function fail(error: { code?: string } | null): { ok: false; code: string } {
  return { ok: false, code: error?.code ? String(error.code) : "UNKNOWN" };
}

export async function loadRegistryRefs(supabase: SupabaseClient): Promise<LoadResult<RegistryRefs>> {
  const [br, tr] = await Promise.all([
    supabase.from("branches").select("id, name, zone_id, zones ( name, sort_order )").order("name"),
    supabase.from("tier_rules").select(TIER_RULE_COLUMNS).order("effective_month").order("min_annual"),
  ]);
  const err = br.error ?? tr.error;
  if (err) return fail(err);

  const branches: BranchRef[] = (br.data ?? []).map((b: Record<string, unknown>) => {
    const z = b.zones as { name: string; sort_order: number } | { name: string; sort_order: number }[] | null;
    const zone = Array.isArray(z) ? z[0] : z;
    return {
      id: b.id as string,
      name: b.name as string,
      zoneId: b.zone_id as string,
      zoneName: zone?.name ?? "",
      zoneOrder: zone?.sort_order ?? 0,
    };
  });
  return { ok: true, data: { branches, tierRules: toTierRules((tr.data ?? []) as TierRuleRow[]) } };
}

// ---------- แปลงแถวดิบ → RegistryRow ----------

/** แถวดิบจาก Supabase (embed ลูกค้า → สาขา → เขต · ชนิดลูกค้า · จำนวนสถานี) */
export interface RegistryRowDb {
  id: string;
  customer_id: string;
  contract_no: string;
  start_date: string;
  end_date: string | null;
  term_months: number;
  value_total: number | string | null;
  status: DbContractStatus;
  customers: {
    name: string | null;
    branch_id: string;
    customer_types: { label: string } | { label: string }[] | null;
    branches: { name: string; zones: { name: string } | { name: string }[] | null } | { name: string; zones: { name: string } | { name: string }[] | null }[] | null;
  } | null;
  stations: { count: number }[] | null;
}

const SELECT =
  "id, customer_id, contract_no, start_date, end_date, term_months, value_total, status, " +
  "customers!inner(name, branch_id, customer_types(label), branches!inner(name, zones!inner(name))), " +
  "stations(count)";

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** ค่าดิบของคอลัมน์เรียง → cursor ของแถวนี้ */
export function cursorOf(raw: Pick<RegistryRowDb, "id" | "start_date" | "end_date" | "value_total">, sortKey: RegistryFilters["sort"]): Cursor {
  const col = SORTS[sortKey].column;
  const v = raw[col];
  return { value: v === null || v === undefined ? null : String(v), id: raw.id };
}

function tierFor(value: number, termMonths: number, startDate: string, rules: TierRule[]): RegistryRow["tier"] {
  try {
    return tierOf(annualValueForTerm(value, termMonths), rules, monthOf(startDate));
  } catch {
    return null;
  }
}

/** แปลงแถวดิบ · ขาดลูกค้า/สาขา = null (ข้าม) */
export function toRegistryRow(raw: RegistryRowDb, rules: TierRule[], today: string, sortKey: RegistryFilters["sort"]): RegistryRow | null {
  const cust = raw.customers;
  const branch = one(cust?.branches);
  if (!cust || !branch) return null;
  const valueNum = Number(raw.value_total ?? 0);
  const value = Number.isFinite(valueNum) ? valueNum : 0;
  const start = raw.start_date.slice(0, 10);
  const end = effectiveEndDate({ startDate: start, endDate: raw.end_date ?? undefined, termMonths: raw.term_months });
  const termMonths = raw.term_months;
  const annual = annualValueForTerm(value, termMonths);
  const stationCount = raw.stations?.[0]?.count;
  return {
    contractId: raw.id,
    customerId: raw.customer_id,
    customerName: cust.name ?? "",
    customerTypeLabel: one(cust.customer_types)?.label ?? null,
    contractNo: raw.contract_no,
    startDate: start,
    endDate: end,
    termMonths,
    valueTotal: value,
    annualValue: annual,
    tier: tierFor(value, termMonths, start, rules),
    branchId: cust.branch_id,
    branchName: branch.name,
    zoneName: one(branch.zones)?.name ?? "",
    stationCount: typeof stationCount === "number" ? stationCount : null,
    dbStatus: raw.status,
    status: registryStatus(raw.status, end, today),
    cursor: cursorOf(raw, sortKey),
  };
}

/** แถวนี้ผ่านตัวกรองที่ต้องกรองซ้ำฝั่งแอป (Tier · สถานะ) ไหม */
export function matchesPostFilter(row: Pick<RegistryRow, "tier" | "status">, f: Pick<RegistryFilters, "sizes" | "statuses">): boolean {
  if (f.sizes.length > 0 && (row.tier === null || !f.sizes.includes(row.tier))) return false;
  if (f.statuses.length > 0 && !f.statuses.includes(row.status)) return false;
  return true;
}

// ---------- โหลดหนึ่งหน้า (keyset) ----------

export interface PageContext {
  refs: RegistryRefs;
  today: string;
}

/**
 * โหลดสัญญาหนึ่งหน้า (`limit` แถว) ต่อจาก `cursor` (null = หน้าแรก) ตามตัวกรอง + คำค้น (ผ่าน sanitizeSearch แล้ว)
 * ตัวกรองซ้ำฝั่งแอปทำเป็นก้อน — ดูหัวไฟล์
 */
export async function loadRegistryPage(
  supabase: SupabaseClient,
  ctx: PageContext,
  filters: RegistryFilters,
  search: string,
  cursor: Cursor | null,
  limit: number = PAGE_SIZE,
): Promise<LoadResult<PageData>> {
  const sort = SORTS[filters.sort];
  const post = needsPostFilter(filters);
  const chunk = post ? POST_CHUNK : limit;
  const maxChunks = post ? MAX_POST_CHUNKS : 1;

  const rows: RegistryRow[] = [];
  let cur = cursor;
  let scanned = 0;
  let dbTotal: number | null = null;

  for (let i = 0; i < maxChunks; i++) {
    const base = supabase.from("contracts").select(SELECT, i === 0 && cursor === null ? { count: "exact" } : undefined);
    const filtered = applyRegistryFilters(base as unknown as FilterLike, filters, ctx.refs.branches, search, cur);
    if (filtered === null) return { ok: true, data: { rows: [], next: null, scanned: 0, dbTotal: 0 } };

    const ordered = (filtered as unknown as typeof base)
      .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
      .order("id", { ascending: sort.ascending })
      .limit(chunk + 1);
    const res = await ordered;
    if (res.error) return fail(res.error);
    if (i === 0 && cursor === null) dbTotal = res.count ?? 0;

    const batch = (res.data ?? []) as unknown as RegistryRowDb[];
    const hasExtra = batch.length > chunk;
    const used = hasExtra ? batch.slice(0, chunk) : batch;

    for (let k = 0; k < used.length; k++) {
      const raw = used[k] as RegistryRowDb;
      scanned++;
      const row = toRegistryRow(raw, ctx.refs.tierRules, ctx.today, filters.sort);
      if (row && matchesPostFilter(row, filters)) rows.push(row);
      if (rows.length >= limit) {
        // ครบหน้า — cursor = แถวสุดท้ายที่เอามาแสดง · ถ้ายังมีแถวเหลือในก้อน/ก้อนถัดไป = ยังมีต่อ
        const more = k < used.length - 1 || hasExtra;
        return { ok: true, data: { rows, next: more ? cursorOf(raw, filters.sort) : null, scanned, dbTotal } };
      }
    }
    if (!hasExtra) return { ok: true, data: { rows, next: null, scanned, dbTotal } };
    const last = used[used.length - 1];
    if (!last) return { ok: true, data: { rows, next: null, scanned, dbTotal } };
    cur = cursorOf(last, filters.sort);
  }
  // สแกนครบงบก้อนแล้วแต่ยังไม่ครบหน้า และยังมีข้อมูลต่อ → ให้กดโหลดเพิ่ม
  return { ok: true, data: { rows, next: cur, scanned, dbTotal } };
}

// ---------- ส่งออก ----------

export interface ExportResult {
  rows: RegistryRow[];
  /** true = มีมากกว่า MAX_EXPORT_ROWS (ตัดแล้ว) */
  truncated: boolean;
}

/** โหลดทุกแถวตามตัวกรอง (ทีละ EXPORT_CHUNK) สูงสุด MAX_EXPORT_ROWS · ใช้ตัวกรอง/ลำดับเดียวกับที่เห็นในหน้า */
export async function loadRegistryForExport(
  supabase: SupabaseClient,
  ctx: PageContext,
  filters: RegistryFilters,
  search: string,
): Promise<LoadResult<ExportResult>> {
  const all: RegistryRow[] = [];
  let cursor: Cursor | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const res: LoadResult<PageData> = await loadRegistryPage(supabase, ctx, filters, search, cursor, EXPORT_CHUNK);
    if (!res.ok) return res;
    all.push(...res.data.rows);
    if (all.length >= MAX_EXPORT_ROWS) {
      return { ok: true, data: { rows: all.slice(0, MAX_EXPORT_ROWS), truncated: all.length > MAX_EXPORT_ROWS || res.data.next !== null } };
    }
    if (!res.data.next) return { ok: true, data: { rows: all, truncated: false } };
    cursor = res.data.next;
  }
  return { ok: true, data: { rows: all, truncated: true } };
}
