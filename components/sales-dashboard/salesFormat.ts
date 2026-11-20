/**
 * ตัวช่วยแสดงผล/ช่วงเดือนของหน้า Dashboard งานขาย — pure function ล้วน (ทดสอบได้ตรงๆ)
 *
 * Logic summary:
 *   * ปีใช้ ค.ศ. ทั้งหมด (เหมือนทั้งระบบ) · เดือนย่อภาษาไทย "ก.ย. 2026"
 *   * หน้าต่างข้อมูล = เดือนปัจจุบัน (เวลาไทย) ย้อนหลัง SALES_WINDOW_MONTHS เดือน (นับรวมเดือนนี้) — ตัวเลือกเดือนในตัวกรองอยู่ในช่วงนี้
 *   * ช่วงเดือนเริ่มต้น = 3 เดือนล่าสุด (ไม่เกินหน้าต่าง)
 *   * บรรทัดสรุปตัวกรองของแถบ sticky: "ก.ย. 2026 – พ.ย. 2026 · ทุกเขต · ทุกสาขา · ทุกคน"
 */
import { shiftMonth } from "../../lib/service/months";
import type { SalesFilters } from "./salesTypes";

export const SALES_WINDOW_MONTHS = 12;
export const SALES_DEFAULT_MONTHS = 3;

const SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;

/** 'YYYY-MM' → "ก.ย." */
export function monthName(month: string): string {
  return SHORT_MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/** 'YYYY-MM' → "ก.ย. 2026" */
export function monthShort(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

/** 'YYYY-MM-DD' → "16 พ.ย. 2026" · รูปแบบผิด/ว่าง → "-" */
export function formatDate(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "-";
  return `${Number(ymd.slice(8, 10))} ${monthName(ymd.slice(0, 7))} ${ymd.slice(0, 4)}`;
}

/** 12,345 */
export function formatMoney(n: number): string {
  return Math.round(n).toLocaleString("th-TH");
}

/** ≥ 1 ล้าน → "1.23 ล้าน" · น้อยกว่า → "123,456" */
export function formatMoneyShort(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} ล้าน` : formatMoney(n);
}

/** เดือนแรกของหน้าต่างข้อมูล 'YYYY-MM' จากเดือนปัจจุบัน */
export function windowStartMonth(currentMonth: string): string {
  return shiftMonth(currentMonth, -(SALES_WINDOW_MONTHS - 1));
}

/** วันแรกของหน้าต่างข้อมูล 'YYYY-MM-DD' (ใช้เป็น windowStart ของ loadSalesRows) */
export function windowStartDate(currentMonth: string): string {
  return `${windowStartMonth(currentMonth)}-01`;
}

/** ตัวเลือกเดือนเก่า→ใหม่ ในหน้าต่างข้อมูล */
export function monthOptions(currentMonth: string): string[] {
  const out: string[] = [];
  for (let d = -(SALES_WINDOW_MONTHS - 1); d <= 0; d++) out.push(shiftMonth(currentMonth, d));
  return out;
}

/** ตัวกรองเริ่มต้น: 3 เดือนล่าสุด ทุกเขต ทุกสาขา ทุกคน */
export function defaultSalesFilters(currentMonth: string): SalesFilters {
  return {
    fromMonth: shiftMonth(currentMonth, -(SALES_DEFAULT_MONTHS - 1)),
    toMonth: currentMonth,
    zoneId: null,
    branchId: null,
    seller: null,
  };
}

export interface SummaryNames {
  zoneName: string | null;
  branchName: string | null;
}

/** บรรทัดสรุปตัวกรอง (ใช้ในแถบ sticky) */
export function filterSummary(f: SalesFilters, names: SummaryNames): string {
  const range = f.fromMonth === f.toMonth ? monthShort(f.fromMonth) : `${monthShort(f.fromMonth)} – ${monthShort(f.toMonth)}`;
  const seller = f.seller === null ? "ทุกคน" : f.seller === "" ? "ไม่ระบุผู้ขาย" : f.seller;
  return [range, names.zoneName ?? "ทุกเขต", names.branchName ?? "ทุกสาขา", seller].join(" · ");
}
