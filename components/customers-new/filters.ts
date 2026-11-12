/**
 * ตัวกรองตารางเปิดงาน: เดือน / เขต / สาขา / สถานะ / "กรองในตารางนี้"
 *
 * Logic summary:
 *   * เดือน = เดือนของ "วันเริ่มสัญญา" (เดือนเปิดงาน) รูปแบบ 'YYYY-MM'
 *   * ค้นหา = ชื่อลูกค้า หรือ เลขที่สัญญา เฉพาะแถวของเดือนที่เลือก (ตัดช่องว่าง/ไม่สนตัวพิมพ์)
 *   * สถานะที่กรองได้ตอนนี้: ครบแล้ว / ขาดข้อมูลจำเป็น / ยังไม่แนบไฟล์ / มีคำเตือนอื่น
 *     ("รอนัดบริการ" ผูกกับช่องวันที่บริการที่ schema ยังไม่มี — เพิ่มเมื่อมี migration)
 */

export type StatusFilter = "" | "ok" | "miss" | "nofile" | "warn";

export interface FilterableRow {
  customerName: string;
  contractNo: string;
  /** 'YYYY-MM-DD' หรือว่าง */
  startDate: string;
  branchId: string | null;
  zoneId: string | null;
  hasPdf: boolean;
  /** ขาดข้อมูลจำเป็น */
  missing: boolean;
  /** มีคำเตือนที่ไม่บล็อก (ระยะสัญญา/วันที่) */
  warned: boolean;
}

export interface RowFilters {
  month: string; // 'YYYY-MM'
  zoneId: string; // "" = ทั้งหมด
  branchId: string;
  status: StatusFilter;
  search: string;
}

function squash(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export function matchesFilters(row: FilterableRow, f: RowFilters): boolean {
  if (f.month && row.startDate.slice(0, 7) !== f.month) return false;
  if (f.zoneId && row.zoneId !== f.zoneId) return false;
  if (f.branchId && row.branchId !== f.branchId) return false;

  const q = squash(f.search);
  if (q && !squash(row.customerName).includes(q) && !squash(row.contractNo).includes(q)) {
    return false;
  }

  switch (f.status) {
    case "ok":
      return !row.missing && !row.warned && row.hasPdf;
    case "miss":
      return row.missing;
    case "nofile":
      return !row.hasPdf;
    case "warn":
      return row.warned;
    default:
      return true;
  }
}

export function applyFilters<T extends FilterableRow>(rows: readonly T[], f: RowFilters): T[] {
  return rows.filter((r) => matchesFilters(r, f));
}

/** รายการเดือนสำหรับตัวเลือก: จากวันเริ่มของแถวที่มี เรียงใหม่→เก่า ไม่ซ้ำ */
export function monthOptions(startDates: readonly string[]): string[] {
  const set = new Set<string>();
  for (const d of startDates) if (/^\d{4}-\d{2}/.test(d)) set.add(d.slice(0, 7));
  return [...set].sort().reverse();
}
