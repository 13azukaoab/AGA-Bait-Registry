/**
 * ชั้นอ่านข้อมูลหน้า "Dashboard งานขาย (New/Renew)" — ใช้ฝั่ง server (page.tsx)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้จริงเสมอ (ไม่ใช้ service role) — RLS บังคับขอบเขต: host เห็นทุกสาขา · admin เห็นตามสาขาของตน
 *   * ดึง "สัญญาที่มี sale_type" (New/Renew) ที่วันที่รับ Mail อยู่ในหน้าต่างเวลา (windowStart ขึ้นไป) + สัญญาที่ยังไม่มีวันที่รับ Mail
 *     (ไว้แสดงหมายเหตุ "ไม่มีวันที่รับ Mail N ราย") · ทีละ 1,000 แถว สูงสุด MAX_ROWS · เกินนี้ตัดและบอกผู้ใช้ (truncated)
 *   * ตัวกรอง/รวมยอดทำฝั่ง client ใน salesAggregate.ts (ตัวกรองผู้ขายเป็นข้อความอิสระ จึงไม่ใส่ใน URL — PDPA)
 *   * ต่อสัญญาล่าช้า: ผู้เรียกส่งฟังก์ชัน `isLate` (= isLateRenewal จาก lib/rules) เข้ามา — ที่นี่ไม่มีสูตรของตัวเอง
 *   * ⚠ PDPA: ผลลัพธ์มีชื่อลูกค้า — ห้าม console.log · error คืนแค่ code (ไม่คืน message ดิบ)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SaleKind, SalesRow } from "./salesTypes";

export const SALES_PAGE_CHUNK = 1000;
export const SALES_MAX_ROWS = 5000;

export type SalesLoadResult =
  | { ok: true; rows: SalesRow[]; truncated: boolean }
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

/**
 * โหลดสัญญา New/Renew ที่วันที่รับ Mail ตั้งแต่ `windowStart` ('YYYY-MM-DD') ขึ้นไป + สัญญาที่ยังไม่มีวันที่รับ Mail
 * `windowStart` ต้องเป็นวันที่รูปแบบ YYYY-MM-DD (ตรวจก่อนต่อเข้า query — ไม่รับข้อความอิสระ)
 */
export async function loadSalesRows(supabase: SupabaseClient, windowStart: string, isLate: LateFn): Promise<SalesLoadResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(windowStart)) return { ok: false, code: "bad_window" };

  const out: SalesRow[] = [];
  let truncated = false;
  for (let from = 0; from < SALES_MAX_ROWS; from += SALES_PAGE_CHUNK) {
    const { data, error } = await supabase
      .from("contracts")
      .select(SELECT)
      .not("sale_type", "is", null)
      .or(`mail_received_date.is.null,mail_received_date.gte.${windowStart}`)
      .order("id", { ascending: true })
      .range(from, from + SALES_PAGE_CHUNK - 1);
    if (error) return { ok: false, code: error.code ?? "query_failed" };
    const batch = (data ?? []) as unknown as SalesRowDb[];
    for (const raw of batch) {
      const r = toSalesRow(raw, isLate);
      if (r) out.push(r);
    }
    if (batch.length < SALES_PAGE_CHUNK) return { ok: true, rows: out, truncated };
  }
  truncated = true;
  return { ok: true, rows: out, truncated };
}
