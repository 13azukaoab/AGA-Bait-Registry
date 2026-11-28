/**
 * ชั้นอ่านข้อมูลหน้า "Dashboard งานขาย (New/Renew)" — ใช้ฝั่ง server (page.tsx)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้จริงเสมอ (ไม่ใช้ service role) — RLS: host/admin/recorder อ่านสัญญาได้ **ทุกสาขา** โดยตั้งใจ (M21)
 *     ขอบเขตสาขา (admin) ใช้กับ "การแก้ไข" เท่านั้น ไม่ใช่การอ่าน → หน้านี้จึงเห็นทุกสาขาสำหรับ host/admin
 *     (หน้านี้ให้เฉพาะ host + admin เข้า — ด่านที่ middleware + page)
 *   * วันที่จัดเดือนของยอด (DECISIONS 2.91 + 2.101 + 2.120 · `resolveSalesDate` จุดเดียว):
 *       สัญญานำเข้า (`import_batch` ไม่ว่าง) → ใช้ `start_date` **เสมอ** แม้มี `mail_received_date` (2.120 ข้อ 1:
 *       วันรับ Mail ที่เติมจากไฟล์เปิดงานย้อนหลังต้องไม่ทำให้ยอด/ป้ายล่าช้าของสัญญานำเข้าขยับ)
 *       · สัญญาที่เปิดในแอป (`import_batch` ว่าง) → ใช้ `mail_received_date` · ไม่มี Mail → ไม่นับ (แสดงเป็นหมายเหตุ)
 *     แถวที่ใช้ `start_date` ไม่ติดป้ายล่าช้า (isLate = false · `FLAG_LATE_ON_START_DATE_ROWS`) และไม่ส่ง start_date เข้า isLateRenewal
 *   * query หลัก: สัญญา New/Renew ที่วันที่จัดเดือน ≥ `windowStart` — `.or(windowFilter)` AND กับ `.or(ตัวกรองยกเลิก)`
 *     windowFilter = (เปิดในแอป AND Mail ≥ ต้นช่วง) OR (นำเข้า AND วันเริ่ม ≥ ต้นช่วง)
 *     (PostgREST รวม `or` หลายตัวด้วย AND) · ไม่โหลดแถวที่ไม่มีวันที่ใช้ได้มาทั้งชุด (กินเพดานแล้วข้อมูลจริงถูกตัด)
 *   * จำนวนสัญญาที่ไม่มีวันที่รับ Mail และไม่ถูกนับ (เฉพาะสัญญาที่เปิดในแอป · สัญญานำเข้านับด้วยวันเริ่มเสมอ จึงไม่อยู่ในหมายเหตุนี้
 *     ไม่ว่าจะเติม Mail แล้วหรือยัง) = query นับอย่างเดียว (`head: true`) แสดงเป็นหมายเหตุ
 *   * เพดาน SALES_MAX_ROWS แถว: เกินแล้ว `truncated = true` (ใช้ count จาก query หลัก — ไม่ตัดเงียบ หน้าแสดงคำเตือน)
 *     โหลดทีละ SALES_PAGE_CHUNK แถว
 *   * ตัวกรองสัญญายกเลิก / สัญญานำเข้า รวมที่จุดเดียว (`EXCLUDE_CANCELLED` / `EXCLUDE_IMPORTED`) — เจ้าของเลือกวิธีนับแบบ ก (DECISIONS 2.91):
 *     (กฎล่าสุดของเจ้าของ · M44 แยกเหตุผลยกเลิก `contracts.cancel_reason_code`)
 *     **ไม่นับเฉพาะสัญญาที่ status='cancelled' และเหตุผล = 'entry_error' (ลงข้อมูลผิด)** · ยกเลิกเพราะลูกค้ายกเลิกจริง/อื่นๆ/ไม่มีเหตุผล ยังนับ
 *     **นับสัญญานำเข้า** (ใช้วันเริ่มสัญญาเสมอ · 2.120) · ใช้กับทั้ง query หลักและ query นับ
 *   * ต่อสัญญาล่าช้า: ผู้เรียกส่งฟังก์ชัน `isLate` (= isLateRenewal จาก lib/rules) เข้ามา — ที่นี่ไม่มีสูตรของตัวเอง
 *   * ⚠ PDPA: ผลลัพธ์มีชื่อลูกค้า — ห้าม console.log · error คืนแค่ code (ไม่คืน message ดิบ)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SaleKind, SalesDateSource, SalesRow } from "./salesTypes";

export const SALES_PAGE_CHUNK = 1000;
export const SALES_MAX_ROWS = 5000;

/**
 * ไม่นับสัญญาที่ยกเลิกเพราะ "ลงข้อมูลผิด" (status = 'cancelled' AND cancel_reason_code = 'entry_error') — DECISIONS 2.91 ล่าสุด
 * (ชื่อค่าคงที่ใช้ EXCLUDE_CANCELLED เดิม) · ยกเลิกเหตุอื่น / ไม่มีเหตุผล ยังนับ
 */
export const EXCLUDE_CANCELLED = true;

/**
 * เงื่อนไข PostgREST `or` ที่ "เก็บ" แถวไว้ = NOT (status = 'cancelled' AND cancel_reason_code = 'entry_error')
 *   = status ≠ cancelled  หรือ  เหตุผลว่าง  หรือ  เหตุผล ≠ entry_error
 * ⚠ ต้องมี `is.null` ของเหตุผลด้วย — SQL เทียบ NULL <> 'entry_error' ได้ค่า "ไม่รู้" (ไม่ผ่าน) ถ้าไม่ใส่ สัญญายกเลิกที่ไม่มีเหตุผลจะหายจากยอดโดยผิด
 */
export const KEEP_UNLESS_ENTRY_ERROR_CANCELLED = "status.neq.cancelled,cancel_reason_code.is.null,cancel_reason_code.neq.entry_error";
/**
 * สัญญานำเข้าใช้ "วันเริ่มสัญญา" จัดเดือนของยอด (DECISIONS 2.101 · 22 พ.ย. 2026) — **เสมอ แม้มีวันที่รับ Mail** (2.120 · 28 พ.ย. 2026)
 * false = กลับไปกฎ 2.91 เดิม (ทุกสัญญาใช้วันที่รับ Mail · ไม่มี Mail = ไม่นับ · สัญญานำเข้าที่เติม Mail แล้วจะใช้ Mail + ติดป้ายล่าช้าได้)
 */
export const USE_START_DATE_FOR_IMPORTED = true;
/**
 * แถวที่ใช้วันเริ่มสัญญา **ไม่ติดป้าย "ต่อสัญญาล่าช้า"** (เจ้าของยืนยัน 22 พ.ย. · กฎล่าช้านิยามจากวันที่รับ Mail ซึ่งไม่มี)
 * จุดเดียวที่แก้ได้ · ห้ามส่ง start_date เข้า isLateRenewal
 */
export const FLAG_LATE_ON_START_DATE_ROWS = false;

/** ไม่นับสัญญานำเข้า (contracts.import_batch ไม่ว่าง) · false = นับสัญญานำเข้าที่มีวันที่รับ Mail (DECISIONS 2.91 แบบ ก) */
export const EXCLUDE_IMPORTED = false;

export interface SalesLoadOptions {
  excludeCancelled: boolean;
  excludeImported: boolean;
  /** สัญญานำเข้าใช้วันเริ่มสัญญาเสมอ (2.101 + 2.120) — ไม่มีผลถ้า excludeImported = true */
  useStartDateForImported: boolean;
}

export const DEFAULT_SALES_LOAD_OPTIONS: SalesLoadOptions = {
  excludeCancelled: EXCLUDE_CANCELLED,
  excludeImported: EXCLUDE_IMPORTED,
  useStartDateForImported: USE_START_DATE_FOR_IMPORTED,
};

export type SalesLoadResult =
  | {
      ok: true;
      rows: SalesRow[];
      /** มีสัญญาในช่วงมากกว่า SALES_MAX_ROWS (โหลดมาแค่ส่วนแรก) */
      truncated: boolean;
      /**
       * จำนวนสัญญา New/Renew ที่ไม่มีวันที่รับ Mail และ "ไม่ถูกนับในยอด" (นับอย่างเดียว)
       * = เฉพาะสัญญาที่เปิดในแอป (ถ้าเปิด useStartDateForImported สัญญานำเข้าใช้วันเริ่มสัญญาเสมอ จึงไม่รวมที่นี่)
       */
      noMailCount: number;
    }
  | { ok: false; code: string };

/** แถวดิบจาก Supabase (embed ลูกค้า → สาขา → เขต) */
export interface SalesRowDb {
  id: string;
  customer_id: string;
  sale_type: string | null;
  sale_name: string | null;
  am_name: string | null;
  mail_received_date: string | null;
  /** วันเริ่มสัญญา (NOT NULL ใน DB) — ใช้แทนวันที่รับ Mail เฉพาะสัญญานำเข้า (2.101) */
  start_date: string | null;
  /** ไม่ว่าง = สัญญานำเข้าจากทะเบียนเดิม */
  import_batch: string | null;
  value_total: number | string | null;
  customers: {
    name: string | null;
    branch_id: string;
    branches: {
      name: string;
      zone_id: string;
      zones: { name: string; sort_order: number } | { name: string; sort_order: number }[] | null;
    } | null;
  } | null;
}

/** ตัวตัดสินต่อสัญญาล่าช้า — ส่ง `isLateRenewal` จาก lib/rules เข้ามา */
export type LateFn = (saleType: SaleKind, mailReceivedDate: string | null) => boolean;

const SELECT =
  "id, customer_id, sale_type, sale_name, am_name, mail_received_date, start_date, import_batch, value_total, " +
  "customers!inner(name, branch_id, branches!inner(name, zone_id, zones!inner(name, sort_order)))";

/**
 * กฎเลือกวันที่จัดเดือนของยอด — จุดเดียว (DECISIONS 2.91 + 2.101 + 2.120):
 *   1) สัญญานำเข้า (import_batch ไม่ว่าง) + เปิด useStartDateForImported → ใช้วันเริ่มสัญญา (source "start") เสมอ แม้มี Mail
 *   2) มีวันที่รับ Mail → ใช้วันนั้น (source "mail") — สัญญาที่เปิดในแอป (หรือทุกสัญญาเมื่อปิดสวิตช์)
 *   3) อื่นๆ → ไม่มีวันที่ (null) = ไม่นับ
 */
export function resolveSalesDate(
  raw: Pick<SalesRowDb, "mail_received_date" | "start_date" | "import_batch">,
  useStartDateForImported: boolean,
): { date: string | null; source: SalesDateSource | null } {
  if (useStartDateForImported && raw.import_batch && raw.start_date) return { date: raw.start_date.slice(0, 10), source: "start" };
  if (raw.mail_received_date) return { date: raw.mail_received_date.slice(0, 10), source: "mail" };
  return { date: null, source: null };
}

/** แปลงแถวดิบเป็น SalesRow · แถวที่ไม่ใช่ New/Renew หรือขาดสาขา/เขต = null (ข้าม) */
export function toSalesRow(
  raw: SalesRowDb,
  isLate: LateFn,
  useStartDateForImported: boolean = USE_START_DATE_FOR_IMPORTED,
): SalesRow | null {
  if (raw.sale_type !== "new" && raw.sale_type !== "renew") return null;
  const cust = raw.customers;
  const branch = cust?.branches;
  if (!cust || !branch) return null;
  const zone = Array.isArray(branch.zones) ? branch.zones[0] : branch.zones;
  if (!zone) return null;
  const saleType: SaleKind = raw.sale_type;
  const mail = raw.mail_received_date ? raw.mail_received_date.slice(0, 10) : null;
  const { date: salesDate, source: dateSource } = resolveSalesDate(raw, useStartDateForImported);
  const value = Number(raw.value_total ?? 0);
  return {
    contractId: raw.id,
    customerId: raw.customer_id,
    customerName: cust.name ?? "",
    branchId: cust.branch_id,
    branchName: branch.name,
    zoneId: branch.zone_id,
    zoneName: zone.name,
    zoneOrder: zone.sort_order,
    saleType,
    saleName: raw.sale_name?.trim() || null,
    amName: raw.am_name?.trim() || null,
    salesDate,
    dateSource,
    valueTotal: Number.isFinite(value) ? value : 0,
    // ล่าช้านิยามจากวันที่รับ Mail เท่านั้น — แถวที่ใช้วันเริ่มสัญญาไม่ติดป้าย (2.101) · ห้ามส่ง start_date เข้า isLate
    isLate: dateSource === "mail" || FLAG_LATE_ON_START_DATE_ROWS ? isLate(saleType, mail) : false,
  };
}

/** ตัวสร้าง query ที่ต่อเงื่อนไขได้ (ใช้ร่วมระหว่าง query หลักกับ query นับ) */
interface Chainable {
  or(filters: string): Chainable;
  is(column: string, value: null): Chainable;
}

/** ต่อเงื่อนไขกรองสัญญายกเลิก/นำเข้าตามตัวเลือก — จุดเดียวของทั้งสอง query */
function applyScope<T>(query: T, opt: SalesLoadOptions, noMailOnly = false): T {
  let q = query as unknown as Chainable;
  if (opt.excludeCancelled) q = q.or(KEEP_UNLESS_ENTRY_ERROR_CANCELLED);
  if (opt.excludeImported) q = q.is("import_batch", null);
  // query นับ "ไม่มีวันที่รับ Mail": สัญญานำเข้าใช้วันเริ่มสัญญาเสมอ (ไม่ขึ้นกับ Mail) → เหลือเฉพาะสัญญาที่เปิดในแอป
  if (noMailOnly && opt.useStartDateForImported && !opt.excludeImported) q = q.is("import_batch", null);
  return q as unknown as T;
}

/**
 * เงื่อนไขหน้าต่างเวลา (PostgREST `or`) — เป็น AND กับ `or` ของตัวกรองสัญญายกเลิก (PostgREST ถือ `or` ซ้ำเป็น AND กัน)
 *   = (สัญญาที่เปิดในแอป AND Mail ≥ windowStart) OR (สัญญานำเข้า AND วันเริ่มสัญญา ≥ windowStart)
 *   ตรงกับ resolveSalesDate ข้อ 1–2 · ใช้เฉพาะเมื่อเปิด useStartDateForImported (ปิด = gte Mail ธรรมดา)
 * windowStart ผ่านการตรวจรูปแบบ YYYY-MM-DD แล้วก่อนเรียก (ไม่ใช่ข้อความอิสระ)
 */
export function windowFilter(windowStart: string): string {
  return `and(import_batch.is.null,mail_received_date.gte.${windowStart}),and(import_batch.not.is.null,start_date.gte.${windowStart})`;
}

/**
 * โหลดสัญญา New/Renew ที่วันที่จัดเดือน (สัญญาในแอป: วันที่รับ Mail · สัญญานำเข้า: วันเริ่มสัญญาเสมอ) ตั้งแต่ `windowStart` ('YYYY-MM-DD') ขึ้นไป + นับสัญญาที่ไม่มีวันที่รับ Mail
 * `windowStart` ต้องเป็นวันที่รูปแบบ YYYY-MM-DD (ตรวจก่อนต่อเข้า query — ไม่รับข้อความอิสระ)
 */
export async function loadSalesRows(
  supabase: SupabaseClient,
  windowStart: string,
  isLate: LateFn,
  options: SalesLoadOptions = DEFAULT_SALES_LOAD_OPTIONS,
): Promise<SalesLoadResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(windowStart)) return { ok: false, code: "bad_window" };

  const startDateOn = options.useStartDateForImported && !options.excludeImported;
  const page = (from: number, withCount: boolean) => {
    const base = supabase
      .from("contracts")
      .select(SELECT, withCount ? { count: "exact" } : undefined)
      .not("sale_type", "is", null);
    // เปิดวันเริ่มสัญญา = `or` 2 กรณี (แอป: Mail · นำเข้า: วันเริ่ม) · ปิด = gte ของวันที่รับ Mail อย่างเดียว (กฎ 2.91 เดิม)
    const windowed = startDateOn ? base.or(windowFilter(windowStart)) : base.gte("mail_received_date", windowStart);
    return applyScope(windowed.order("id", { ascending: true }).range(from, from + SALES_PAGE_CHUNK - 1), options);
  };

  // query นับอย่างเดียว (head) — ไม่ส่งแถวกลับ
  const noMailQuery = applyScope(
    supabase.from("contracts").select("id", { count: "exact", head: true }).not("sale_type", "is", null).is("mail_received_date", null),
    options,
    true,
  );

  const [first, noMail] = await Promise.all([page(0, true), noMailQuery]);
  if (first.error) return { ok: false, code: first.error.code ?? "query_failed" };
  if (noMail.error) return { ok: false, code: noMail.error.code ?? "query_failed" };

  const out: SalesRow[] = [];
  const collect = (batch: SalesRowDb[]) => {
    for (const raw of batch) {
      const r = toSalesRow(raw, isLate, options.useStartDateForImported);
      if (r) out.push(r);
    }
  };
  const firstBatch = (first.data ?? []) as unknown as SalesRowDb[];
  collect(firstBatch);

  const total = first.count ?? firstBatch.length;
  const truncated = total > SALES_MAX_ROWS;
  const limit = Math.min(total, SALES_MAX_ROWS);
  for (let from = SALES_PAGE_CHUNK; from < limit; from += SALES_PAGE_CHUNK) {
    const next = await page(from, false);
    if (next.error) return { ok: false, code: next.error.code ?? "query_failed" };
    const batch = (next.data ?? []) as unknown as SalesRowDb[];
    collect(batch);
    if (batch.length < SALES_PAGE_CHUNK) break;
  }

  return { ok: true, rows: out, truncated, noMailCount: noMail.count ?? 0 };
}
