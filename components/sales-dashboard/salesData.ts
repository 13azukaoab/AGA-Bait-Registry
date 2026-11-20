/**
 * ชั้นอ่านข้อมูลหน้า "Dashboard งานขาย (New/Renew)" — ใช้ฝั่ง server (page.tsx)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้จริงเสมอ (ไม่ใช้ service role) — RLS: host/admin/recorder อ่านสัญญาได้ **ทุกสาขา** โดยตั้งใจ (M21)
 *     ขอบเขตสาขา (admin) ใช้กับ "การแก้ไข" เท่านั้น ไม่ใช่การอ่าน → หน้านี้จึงเห็นทุกสาขาสำหรับ host/admin
 *     (หน้านี้ให้เฉพาะ host + admin เข้า — ด่านที่ middleware + page)
 *   * query หลัก: สัญญา New/Renew ที่ "มีวันที่รับ Mail" ตั้งแต่ `windowStart` ขึ้นไป เท่านั้น — ไม่โหลดแถวที่ไม่มีวันที่รับ Mail มาทั้งชุด
 *     (หลังนำเข้าข้อมูลมีสัญญานำเข้าหลักพันที่ไม่มีวันที่รับ Mail · ถ้าโหลดมาจะกินเพดานแล้วข้อมูลขายจริงถูกตัด)
 *   * จำนวนสัญญาที่ไม่มีวันที่รับ Mail = query นับอย่างเดียว (`head: true` ไม่ส่งแถวกลับ) แสดงเป็นหมายเหตุ
 *   * เพดาน SALES_MAX_ROWS แถว: เกินแล้ว `truncated = true` (ใช้ count จาก query หลัก — ไม่ตัดเงียบ หน้าแสดงคำเตือน)
 *     โหลดทีละ SALES_PAGE_CHUNK แถว
 *   * ตัวกรองสัญญายกเลิก / สัญญานำเข้า รวมที่จุดเดียว (`EXCLUDE_CANCELLED` / `EXCLUDE_IMPORTED`) — **ตอนนี้ปิดทั้งคู่ = นับทุกสัญญา**
 *     ห้ามเปลี่ยนค่าจนกว่าเจ้าของตัดสิน (รอ HQ แจ้งผล) · ใช้กับทั้ง query หลักและ query นับ
 *   * ต่อสัญญาล่าช้า: ผู้เรียกส่งฟังก์ชัน `isLate` (= isLateRenewal จาก lib/rules) เข้ามา — ที่นี่ไม่มีสูตรของตัวเอง
 *   * ⚠ PDPA: ผลลัพธ์มีชื่อลูกค้า — ห้าม console.log · error คืนแค่ code (ไม่คืน message ดิบ)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SaleKind, SalesRow } from "./salesTypes";

export const SALES_PAGE_CHUNK = 1000;
export const SALES_MAX_ROWS = 5000;

/** ไม่นับสัญญายกเลิก (contracts.status = 'cancelled') · false = นับ (พฤติกรรมปัจจุบัน) — รอเจ้าของตัดสิน */
export const EXCLUDE_CANCELLED = false;
/** ไม่นับสัญญานำเข้า (contracts.import_batch ไม่ว่าง) · false = นับ (พฤติกรรมปัจจุบัน) — รอเจ้าของตัดสิน */
export const EXCLUDE_IMPORTED = false;

export interface SalesLoadOptions {
  excludeCancelled: boolean;
  excludeImported: boolean;
}

export const DEFAULT_SALES_LOAD_OPTIONS: SalesLoadOptions = {
  excludeCancelled: EXCLUDE_CANCELLED,
  excludeImported: EXCLUDE_IMPORTED,
};

export type SalesLoadResult =
  | {
      ok: true;
      rows: SalesRow[];
      /** มีสัญญาในช่วงมากกว่า SALES_MAX_ROWS (โหลดมาแค่ส่วนแรก) */
      truncated: boolean;
      /** จำนวนสัญญา New/Renew ที่ไม่มีวันที่รับ Mail (นับอย่างเดียว ไม่รวมในยอด) */
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
  "id, customer_id, sale_type, sale_name, am_name, mail_received_date, value_total, " +
  "customers!inner(name, branch_id, branches!inner(name, zone_id, zones!inner(name, sort_order)))";

/** แปลงแถวดิบเป็น SalesRow · แถวที่ไม่ใช่ New/Renew หรือขาดสาขา/เขต = null (ข้าม) */
export function toSalesRow(raw: SalesRowDb, isLate: LateFn): SalesRow | null {
  if (raw.sale_type !== "new" && raw.sale_type !== "renew") return null;
  const cust = raw.customers;
  const branch = cust?.branches;
  if (!cust || !branch) return null;
  const zone = Array.isArray(branch.zones) ? branch.zones[0] : branch.zones;
  if (!zone) return null;
  const saleType: SaleKind = raw.sale_type;
  const mail = raw.mail_received_date ? raw.mail_received_date.slice(0, 10) : null;
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
    mailDate: mail,
    valueTotal: Number.isFinite(value) ? value : 0,
    isLate: isLate(saleType, mail),
  };
}

/** ตัวสร้าง query ที่ต่อเงื่อนไขได้ (ใช้ร่วมระหว่าง query หลักกับ query นับ) */
interface Chainable {
  neq(column: string, value: string): Chainable;
  is(column: string, value: null): Chainable;
}

/** ต่อเงื่อนไขกรองสัญญายกเลิก/นำเข้าตามตัวเลือก — จุดเดียวของทั้งสอง query */
function applyScope<T>(query: T, opt: SalesLoadOptions): T {
  let q = query as unknown as Chainable;
  if (opt.excludeCancelled) q = q.neq("status", "cancelled");
  if (opt.excludeImported) q = q.is("import_batch", null);
  return q as unknown as T;
}

/**
 * โหลดสัญญา New/Renew ที่วันที่รับ Mail ตั้งแต่ `windowStart` ('YYYY-MM-DD') ขึ้นไป + นับสัญญาที่ไม่มีวันที่รับ Mail
 * `windowStart` ต้องเป็นวันที่รูปแบบ YYYY-MM-DD (ตรวจก่อนต่อเข้า query — ไม่รับข้อความอิสระ)
 */
export async function loadSalesRows(
  supabase: SupabaseClient,
  windowStart: string,
  isLate: LateFn,
  options: SalesLoadOptions = DEFAULT_SALES_LOAD_OPTIONS,
): Promise<SalesLoadResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(windowStart)) return { ok: false, code: "bad_window" };

  const page = (from: number, withCount: boolean) =>
    applyScope(
      supabase
        .from("contracts")
        .select(SELECT, withCount ? { count: "exact" } : undefined)
        .not("sale_type", "is", null)
        .gte("mail_received_date", windowStart)
        .order("id", { ascending: true })
        .range(from, from + SALES_PAGE_CHUNK - 1),
      options,
    );

  // query นับอย่างเดียว (head) — ไม่ส่งแถวกลับ
  const noMailQuery = applyScope(
    supabase.from("contracts").select("id", { count: "exact", head: true }).not("sale_type", "is", null).is("mail_received_date", null),
    options,
  );

  const [first, noMail] = await Promise.all([page(0, true), noMailQuery]);
  if (first.error) return { ok: false, code: first.error.code ?? "query_failed" };
  if (noMail.error) return { ok: false, code: noMail.error.code ?? "query_failed" };

  const out: SalesRow[] = [];
  const collect = (batch: SalesRowDb[]) => {
    for (const raw of batch) {
      const r = toSalesRow(raw, isLate);
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
