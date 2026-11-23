/**
 * ตรรกะรวมยอดของหน้า Dashboard งานขาย — pure function ล้วน (ไม่แตะ DB/React) ทดสอบได้ตรงๆ
 *
 * Logic summary:
 *   * filterSales: กรองด้วย "เดือนของ salesDate (วันที่รับ Mail · สัญญานำเข้าไม่มี Mail ใช้วันเริ่มสัญญา — DECISIONS 2.101)" + เขต + สาขา + ผู้ขาย (แถวไม่มี salesDate ไม่ผ่านตัวกรองเดือน)
 *   * countNoMailDate: จำนวนสัญญาที่ไม่มีวันที่รับ Mail (ใช้ตัวกรองเขต/สาขา/ผู้ขายเดียวกัน) ไว้แสดงเป็นหมายเหตุ
 *   * sumRows / groupByBranch / groupByZone / groupByMonth: รวมยอด New/Renew (ราย + มูลค่า) และต่อสัญญาล่าช้า
 *     — ล่าช้านับเฉพาะสัญญา Renew ที่ `isLate` (สูตรอยู่ใน lib/rules/lateRenewal.ts ไม่คำนวณซ้ำที่นี่)
 *     — ล่าช้าเป็นส่วนหนึ่งของ Renew (ไม่ใช่ยอดแยก) · lateValue ไม่ถูกหักออกจาก renewValue
 *   * rankSellers: เรียงผู้ขายตามมูลค่ารวมมาก→น้อย (เท่ากัน เรียงชื่อ) · เลือกจัดอันดับตาม sale_name หรือ am_name
 *   * ผลลัพธ์ทุกฟังก์ชันเรียงแบบกำหนดผลแน่นอน (deterministic) เพื่อให้ทดสอบ/แสดงผลซ้ำได้
 */
import type {
  BranchSales,
  MonthSales,
  SalesFilters,
  SalesRow,
  SalesTotals,
  SellerSales,
  ZoneSales,
} from "./salesTypes";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function emptyTotals(): SalesTotals {
  return { newCount: 0, newValue: 0, renewCount: 0, renewValue: 0, lateCount: 0, lateValue: 0 };
}

function addRow(t: SalesTotals, r: SalesRow): void {
  if (r.saleType === "new") {
    t.newCount += 1;
    t.newValue += r.valueTotal;
  } else {
    t.renewCount += 1;
    t.renewValue += r.valueTotal;
    if (r.isLate) {
      t.lateCount += 1;
      t.lateValue += r.valueTotal;
    }
  }
}

/** เดือน 'YYYY-MM' ของวันที่รับ Mail · null ถ้าไม่มี/รูปแบบผิด */
export function salesMonth(salesDate: string | null): string | null {
  if (!salesDate) return null;
  const m = salesDate.slice(0, 7);
  return MONTH_RE.test(m) ? m : null;
}

/** รายการเดือน 'YYYY-MM' จาก from ถึง to (รวมปลาย) · ช่วงกลับด้านหรือรูปแบบผิด = [] */
export function monthsBetween(from: string, to: string): string[] {
  if (!MONTH_RE.test(from) || !MONTH_RE.test(to) || from > to) return [];
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function passesScope(r: SalesRow, f: SalesFilters): boolean {
  if (f.zoneId && r.zoneId !== f.zoneId) return false;
  if (f.branchId && r.branchId !== f.branchId) return false;
  if (f.seller !== null && (r.saleName ?? "") !== f.seller) return false;
  return true;
}

/** แถวที่ผ่านตัวกรองทั้งหมด (เรียงวันที่รับ Mail ใหม่→เก่า แล้วตามชื่อลูกค้า) */
export function filterSales(rows: readonly SalesRow[], f: SalesFilters): SalesRow[] {
  return rows
    .filter((r) => {
      const m = salesMonth(r.salesDate);
      if (!m || m < f.fromMonth || m > f.toMonth) return false;
      return passesScope(r, f);
    })
    .sort(
      (a, b) =>
        (b.salesDate ?? "").localeCompare(a.salesDate ?? "") ||
        a.customerName.localeCompare(b.customerName, "th") ||
        a.contractId.localeCompare(b.contractId),
    );
}

/** จำนวนสัญญาที่ไม่มีวันที่รับ Mail (ตามตัวกรองเขต/สาขา/ผู้ขาย) — ไม่อยู่ในยอดและกราฟรายเดือน */
export function countNoMailDate(rows: readonly SalesRow[], f: SalesFilters): number {
  return rows.filter((r) => salesMonth(r.salesDate) === null && passesScope(r, f)).length;
}

export function sumRows(rows: readonly SalesRow[]): SalesTotals {
  const t = emptyTotals();
  for (const r of rows) addRow(t, r);
  return t;
}

export function groupByBranch(rows: readonly SalesRow[]): BranchSales[] {
  const map = new Map<string, BranchSales>();
  for (const r of rows) {
    let b = map.get(r.branchId);
    if (!b) {
      b = {
        ...emptyTotals(),
        branchId: r.branchId,
        branchName: r.branchName,
        zoneId: r.zoneId,
        zoneName: r.zoneName,
        zoneOrder: r.zoneOrder,
      };
      map.set(r.branchId, b);
    }
    addRow(b, r);
  }
  return [...map.values()].sort(
    (a, b) => a.zoneOrder - b.zoneOrder || a.branchName.localeCompare(b.branchName, "th") || a.branchId.localeCompare(b.branchId),
  );
}

export function groupByZone(rows: readonly SalesRow[]): ZoneSales[] {
  const map = new Map<string, ZoneSales>();
  for (const r of rows) {
    let z = map.get(r.zoneId);
    if (!z) {
      z = { ...emptyTotals(), zoneId: r.zoneId, zoneName: r.zoneName, zoneOrder: r.zoneOrder };
      map.set(r.zoneId, z);
    }
    addRow(z, r);
  }
  return [...map.values()].sort((a, b) => a.zoneOrder - b.zoneOrder || a.zoneId.localeCompare(b.zoneId));
}

/** ยอดรายเดือนตามวันที่รับ Mail · เติมเดือนที่ไม่มีงานเป็น 0 ให้ครบทุกเดือนในช่วง */
export function groupByMonth(rows: readonly SalesRow[], fromMonth: string, toMonth: string): MonthSales[] {
  const map = new Map<string, MonthSales>(monthsBetween(fromMonth, toMonth).map((m) => [m, { ...emptyTotals(), month: m }]));
  for (const r of rows) {
    const m = salesMonth(r.salesDate);
    const slot = m ? map.get(m) : undefined;
    if (slot) addRow(slot, r);
  }
  return [...map.values()];
}

export type SellerField = "sale" | "am";

/** จัดอันดับผู้ขาย (หรือ AM) ตามมูลค่ารวม New+Renew มาก→น้อย · ไม่มีชื่อ = กลุ่ม "" (ผู้เรียกแสดงเป็น "ไม่ระบุ") */
export function rankSellers(rows: readonly SalesRow[], field: SellerField = "sale"): SellerSales[] {
  const map = new Map<string, SellerSales>();
  for (const r of rows) {
    const name = ((field === "sale" ? r.saleName : r.amName) ?? "").trim();
    let s = map.get(name);
    if (!s) {
      s = { ...emptyTotals(), name, contractCount: 0, totalValue: 0 };
      map.set(name, s);
    }
    addRow(s, r);
    s.contractCount += 1;
    s.totalValue += r.valueTotal;
  }
  return [...map.values()].sort((a, b) => b.totalValue - a.totalValue || a.name.localeCompare(b.name, "th"));
}

/** ชื่อผู้ขายที่ไม่ซ้ำ (sale_name) ไว้ทำตัวเลือกตัวกรอง · เรียงตามชื่อ · ข้ามค่าว่าง */
export function distinctSellers(rows: readonly SalesRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const n = (r.saleName ?? "").trim();
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "th"));
}
