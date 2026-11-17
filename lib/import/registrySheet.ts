/**
 * แปลงชีท "ทะเบียนบริการรายสาขา" (เช่น OCT.26_เขต 1 … .xlsx · 1 ชีท = 1 สาขา) → RawRow ของ importContracts
 * ใช้ตอนทดลองนำเข้า / seed ข้อมูลจริง (phase 6 · SPEC §10, §14 ข้อ 12) — pure function ไม่อ่านไฟล์เอง
 *
 * Logic summary:
 *   - ทะเบียนไม่ใช่รูปแบบ "เปิดงาน" (SOURCE_COLUMNS) ที่ importContracts รับ → ต้องแปลงก่อน
 *   - หัวตารางกินพื้นที่ 2 แถว และแต่ละชีทวางไม่ตรงกัน (บางชีทมีคอลัมน์ IC เพิ่ม · บางชีทหัวอยู่แถวบน)
 *     → หาแถวหัวที่มี "เลขที่สัญญา" แล้วรวม 2 แถว (แถวล่างชนะ ถ้าแถวล่างว่าง/เป็น "False" ใช้แถวบน)
 *     · บางชีทหัว 3 แถว (เขต 9 สระบุรี: เริ่มสัญญา/New/Renew/ทีม อยู่แถวที่ 3) → รวม 3 แถวด้วยกฎเดียวกัน
 *     · หัววันที่รับทั้ง "เริ่ม"/"สิ้นสุด" และ "เริ่มสัญญา"/"สิ้นสุดสัญญา" (เขต 9)
 *   - หาคอลัมน์จากชื่อหัว ไม่ใช้ตำแหน่งตายตัว
 *     · ประเภทลูกค้า = หัวที่ขึ้นต้น "H =" (หรือแถวบนเขียน "ประเภทลูกค้า")
 *     · New / Renew = หัว "New"/"Renew" · ถ้าไม่มี (บางชีทหัวเป็น "False") ใช้คอลัมน์ "ประเภทสัญญา" (แถวบน) และคอลัมน์ถัดไป
 *   - สาขา = ชื่อชีท (ทะเบียนไม่มีคอลัมน์สาขา) · ผู้ขาย = ไม่มีในทะเบียน → ใส่ค่าแทนได้ผ่าน option (ว่าง = importContracts แจ้ง "ไม่มีผู้ขาย")
 *   - วันที่ที่เป็นตัวเลข serial → 'YYYY-MM-DD' · วันที่ที่พิมพ์เป็นข้อความ → ส่งต่อตามเดิมให้ parseSourceDate ตรวจ
 *   - ไม่ส่งวันที่บริการ / จำนวนเดือน (ทะเบียนเก็บผลบริการรายเดือนแยกบล็อก) → ระยะสัญญาอ่านจากช่องมูลค่า + วันที่ (M30)
 *   - คืนเลขแถว Excel ของทุกแถว (excelRow) เพื่อรายงานปัญหาเป็น "เลขแถว" ไม่ต้องอ้างชื่อลูกค้า (PDPA)
 */
import type { RawRow, SourceColumn } from "./types";

export type CellValue = string | number | boolean | null;

/** คอลัมน์ที่ต้องหาให้เจอในหัวตารางทะเบียน */
export interface RegistryColumns {
  seq: number | null;
  name: number | null;
  contractNo: number;
  phone: number | null;
  startDate: number;
  endDate: number;
  value1y: number;
  value3y: number;
  customerType: number;
  isNew: number;
  isRenew: number;
  team: number;
}

export interface RegistryRow {
  /** เลขแถวใน Excel (เริ่ม 1) */
  excelRow: number;
  raw: RawRow;
  /** true = วันเริ่ม/สิ้นสุดอ่านจากข้อความช่วงวันที่ (readDateRangeText) */
  dateFromRangeText?: boolean;
  /** เบอร์โทรเฉพาะตัวเลข — ใช้ตรวจลูกค้าซ้ำในหน่วยความจำเท่านั้น ห้าม log */
  phoneDigits: string;
}

export interface RegistrySheetResult {
  branch: string;
  /** เลขแถว Excel ของหัวตาราง (แถวบน, แถวล่าง) */
  headerRows: [number, number];
  columns: RegistryColumns;
  rows: RegistryRow[];
}

export interface RegistrySheetOptions {
  /** ค่าที่ใส่ในช่อง "ผู้ขาย" (ทะเบียนไม่มีคอลัมน์นี้) · ไม่ระบุ = ว่าง → importContracts แจ้ง "ไม่มีผู้ขาย" */
  sellerPlaceholder?: string;
  /**
   * ⚠ ข้อเสนอ — ปิดไว้จนกว่าเจ้าของตัดสิน (ผล dry-run 21 สาขา OCT.26)
   * แถวที่ช่อง "เริ่ม" และ "สิ้นสุด" ว่างทั้งคู่ แต่คอลัมน์ทางซ้ายของ "เริ่ม" (ใต้หัว "ระยะสัญญา") มีข้อความรูป
   * `วว/ดด/ปปปป-วว/ดด/ปปปป` → อ่านเป็นวันเริ่ม/วันสิ้นสุด (ปี ≥ 2400 = พ.ศ. → ลบ 543) · รูปอื่น = ไม่อ่าน (ว่างเหมือนเดิม)
   */
  readDateRangeText?: boolean;
}

/** ข้อความช่วงวันที่ "วว/ดด/ปปปป-วว/ดด/ปปปป" (ตัวเลขล้วน · ปี 4 หลัก) */
const DATE_RANGE_TEXT = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function rangePartToIso(d: string, m: string, y: string): string {
  const year = +y >= 2400 ? +y - 543 : +y;
  return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * ข้อความช่วงวันที่ → [วันเริ่ม, วันสิ้นสุด] แบบ 'YYYY-MM-DD' · ไม่ตรงรูป = null
 * ไม่ตรวจว่าวันมีจริง (ส่งต่อให้ parseSourceDate ของ importContracts ตรวจเหมือนวันที่อื่น)
 */
export function parseDateRangeText(text: string): [string, string] | null {
  const m = DATE_RANGE_TEXT.exec(text.trim());
  if (!m) return null;
  return [rangePartToIso(m[1]!, m[2]!, m[3]!), rangePartToIso(m[4]!, m[5]!, m[6]!)];
}

/**
 * Excel serial date → 'YYYY-MM-DD' (ระบบวันที่ 1900 · serial 1 = 1900-01-01 · เผื่อบั๊กปี 1900 ของ Excel แล้ว)
 * ตัดเศษเวลาทิ้ง · คืน null ถ้าไม่ใช่ตัวเลขที่สมเหตุสมผล
 */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function label(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** ค่าเซลล์ทั่วไป → string (boolean → TRUE/FALSE ให้ isTruthy ของ importContracts อ่านได้) */
function cellText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v).trim();
}

/** ค่าเซลล์วันที่ → 'YYYY-MM-DD' ถ้าเป็น serial · ข้อความคงเดิม (ให้ parseSourceDate ตัดสิน) */
function dateText(v: CellValue | undefined): string {
  if (typeof v === "number") return excelSerialToIso(v) ?? String(v);
  return cellText(v);
}

const HEADER_SCAN_ROWS = 12;

/** ชื่อหัววันที่ที่รับได้ (เขต 9 ปากช่อง/สระบุรี เขียนเต็ม "เริ่มสัญญา"/"สิ้นสุดสัญญา") */
const START_LABELS = ["เริ่ม", "เริ่มสัญญา"];
const END_LABELS = ["สิ้นสุด", "สิ้นสุดสัญญา"];
/** ป้ายที่บอกว่าแถวนั้นเป็น "หัวย่อย" ไม่ใช่ข้อมูล */
const SUB_HEADER_LABELS = [...START_LABELS, ...END_LABELS, "1 ปี", "3 ปี", "New", "Renew", "ทีม"];

function looksLikeSubHeader(row: CellValue[] | undefined): boolean {
  return (row ?? []).some((c) => SUB_HEADER_LABELS.includes(label(c)));
}

/**
 * หาแถวหัวตาราง (index 0) · คืน [แถวบนสุด, แถวล่างสุด] ของหัว (2 หรือ 3 แถว)
 * - "เลขที่สัญญา" อยู่แถวบน (มีแถวล่างเป็นหัวย่อย) หรือแถวล่าง (มีแถวบนเป็นหัวกลุ่ม)
 * - หัว 3 แถว (สระบุรี): แถวที่ 3 มีหัวย่อย (เริ่มสัญญา/New/Renew/ทีม) → รวมเป็นหัวด้วย ไม่ถือเป็นข้อมูล
 */
function findHeaderRows(grid: CellValue[][]): [number, number] {
  for (let r = 0; r < Math.min(grid.length, HEADER_SCAN_ROWS); r++) {
    if ((grid[r] ?? []).some((c) => label(c) === "เลขที่สัญญา")) {
      const [top, bottom] = looksLikeSubHeader(grid[r + 1]) ? [r, r + 1] : [r - 1, r];
      return looksLikeSubHeader(grid[bottom + 1]) ? [top, bottom + 1] : [top, bottom];
    }
  }
  throw new Error("registrySheet: ไม่พบหัวตาราง (คอลัมน์ \"เลขที่สัญญา\")");
}

/** รวมหัวหลายแถว: ต่อคอลัมน์ใช้ป้ายแถวล่างสุดที่ไม่ว่าง (ข้าม "False"/"True" ที่เป็นช่องติ๊ก) */
function findColumns(headerRows: CellValue[][]): RegistryColumns {
  const width = Math.max(...headerRows.map((r) => r.length));
  const merged: string[] = [];
  for (let i = 0; i < width; i++) {
    merged[i] = "";
    for (let h = headerRows.length - 1; h >= 0; h--) {
      const v = label(headerRows[h]![i]);
      if (v && v !== "False" && v !== "True") {
        merged[i] = v;
        break;
      }
    }
  }
  const first = (pred: (s: string) => boolean): number | null => {
    const i = merged.findIndex(pred);
    return i >= 0 ? i : null;
  };
  const need = (name: string, pred: (s: string) => boolean): number => {
    const i = first(pred);
    if (i === null) throw new Error(`registrySheet: ไม่พบคอลัมน์ "${name}"`);
    return i;
  };

  const customerType = need("ประเภทลูกค้า", (s) => s.startsWith("H =") || s === "ประเภทลูกค้า");
  let isNew = first((s) => s === "New");
  let isRenew = first((s) => s === "Renew");
  if (isNew === null || isRenew === null) {
    // หา "ประเภทสัญญา" ในทุกแถวหัว (ป้ายนี้อาจถูกแถวล่างทับใน merged)
    const group = headerRows
      .map((row) => row.findIndex((c) => label(c) === "ประเภทสัญญา"))
      .find((i) => i >= 0) ?? -1;
    if (group < 0) throw new Error("registrySheet: ไม่พบคอลัมน์ New/Renew");
    isNew = group;
    isRenew = group + 1;
  }

  return {
    seq: first((s) => s === "ลำดับ"),
    name: first((s) => s === "ชื่อลูกค้า"),
    contractNo: need("เลขที่สัญญา", (s) => s === "เลขที่สัญญา"),
    phone: first((s) => s.startsWith("เบอร์โทร")),
    startDate: need("เริ่ม", (s) => START_LABELS.includes(s)),
    endDate: need("สิ้นสุด", (s) => END_LABELS.includes(s)),
    value1y: need("1 ปี", (s) => s === "1 ปี"),
    value3y: need("3 ปี", (s) => s === "3 ปี"),
    customerType,
    isNew,
    isRenew,
    team: need("ทีม", (s) => s === "ทีม"),
  };
}

/**
 * แปลง 1 ชีททะเบียน → แถว RawRow (key = ชื่อหัวคอลัมน์ไทยของ SOURCE_COLUMNS) พร้อมเลขแถว Excel
 * ส่งทุกแถวที่มีข้อมูลในคอลัมน์หลัก — แถวสรุปท้ายชีท importContracts จะจัดเป็น "skipped" เอง
 */
export function parseRegistrySheet(
  grid: CellValue[][],
  branch: string,
  opts: RegistrySheetOptions = {},
): RegistrySheetResult {
  const [top, bottom] = findHeaderRows(grid);
  const cols = findColumns(grid.slice(top, bottom + 1).map((r) => r ?? []));
  const keyCols = [cols.contractNo, cols.startDate, cols.endDate, cols.value1y, cols.value3y];

  const rows: RegistryRow[] = [];
  for (let r = bottom + 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    if (!keyCols.some((c) => cellText(cells[c]) !== "")) continue;

    const raw: Partial<Record<SourceColumn, string>> = {
      ลำดับ: cols.seq !== null ? cellText(cells[cols.seq]) : "",
      เลขที่สัญญา: cellText(cells[cols.contractNo]),
      รายชื่อ: cols.name !== null ? cellText(cells[cols.name]) : "",
      New: cellText(cells[cols.isNew]),
      Renew: cellText(cells[cols.isRenew]),
      ผู้ขาย: opts.sellerPlaceholder ?? "",
      สาขา: branch,
      ทีม: cellText(cells[cols.team]),
      ประเภท: cellText(cells[cols.customerType]),
      เริ่ม: dateText(cells[cols.startDate]),
      สิ้นสุด: dateText(cells[cols.endDate]),
      "1 ปี": cellText(cells[cols.value1y]),
      "3 ปี": cellText(cells[cols.value3y]),
    };
    let dateFromRangeText = false;
    if (opts.readDateRangeText && !raw.เริ่ม && !raw.สิ้นสุด && cols.startDate > 0) {
      const range = parseDateRangeText(cellText(cells[cols.startDate - 1]));
      if (range) {
        [raw.เริ่ม, raw.สิ้นสุด] = range;
        dateFromRangeText = true;
      }
    }
    rows.push({
      excelRow: r + 1,
      raw: raw as Record<string, string>,
      phoneDigits: cols.phone !== null ? cellText(cells[cols.phone]).replace(/\D/g, "") : "",
      ...(dateFromRangeText ? { dateFromRangeText } : {}),
    });
  }

  return { branch, headerRows: [top + 1, bottom + 1], columns: cols, rows };
}

/** ตัวเลขจากบล็อก "สรุปมูลค่าลูกค้า แยกตามขนาดราคาและปี" ท้ายชีททะเบียน (สูตรของ Excel เอง) */
export interface RegistryTierSummary {
  /** เลขแถว Excel ของหัวบล็อก ("Size.(ปี)") */
  excelRow: number;
  counts: Record<"s1" | "s3" | "m1" | "m3" | "l1" | "l3" | "xl1" | "xl3", number>;
  values: Record<"s1" | "s3" | "m1" | "m3" | "l1" | "l3" | "xl1" | "xl3", number>;
  totalCount: number;
  totalValue: number;
}

const SUMMARY_KEYS = ["s1", "s3", "m1", "m3", "l1", "l3", "xl1", "xl3"] as const;

function toNumber(v: CellValue | undefined): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * อ่านบล็อกสรุปท้ายชีท (ป้าย "S1 (<30K)" … "XL3 (>=300K)" + "รวมทั้งสิ้น" · คอลัมน์ถัดไป = จำนวน · ถัดไปอีก = มูลค่า)
 * ใช้เทียบกับ snapshot ที่ระบบคำนวณ — ไม่พบบล็อก = null
 */
export function readRegistryTierSummary(grid: CellValue[][]): RegistryTierSummary | null {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const c = row.findIndex((v) => label(v) === "Size.(ปี)");
    if (c < 0) continue;

    const counts = {} as RegistryTierSummary["counts"];
    const values = {} as RegistryTierSummary["values"];
    SUMMARY_KEYS.forEach((key, i) => {
      const line = grid[r + 1 + i] ?? [];
      const tag = label(line[c]).split(/\s|\(/)[0]?.toLowerCase();
      if (tag !== key) throw new Error(`registrySheet: บล็อกสรุปแถว ${r + 2 + i} ไม่ใช่ ${key.toUpperCase()}`);
      counts[key] = toNumber(line[c + 1]);
      values[key] = toNumber(line[c + 2]);
    });
    const totalLine = grid[r + 1 + SUMMARY_KEYS.length] ?? [];
    return {
      excelRow: r + 1,
      counts,
      values,
      totalCount: toNumber(totalLine[c + 1]),
      totalValue: toNumber(totalLine[c + 2]),
    };
  }
  return null;
}
