/**
 * แบบฟอร์ม "แถวที่นำเข้าไม่ได้" (DECISIONS 2.104) — สร้างแบบฟอร์มเติมค่าล่วงหน้า + อ่านแบบฟอร์มที่กรอกแล้วเป็นแผนนำเข้า
 * (pure function ทั้งไฟล์ · อ่าน/เขียนไฟล์อยู่ที่ scripts/build-manual-rows-form.ts และ scripts/import-manual-rows.ts)
 *
 * Logic summary:
 *   1. buildManualFormRows: แถวที่ต้องกรอกมือ = แถวที่ไม่ผ่าน strict + แถวที่กันไว้ ของการนำเข้ารอบแรก
 *      (dryRunRegistrySheet + buildManualEntryItems ตัวเดียวกับที่ทำเอกสาร docs/รายการกรอกมือ-*.md · OCT.26 = 121 แถว)
 *      → 1 แถวแบบฟอร์มต่อ 1 แถวทะเบียน เติมค่าเดิมจากทะเบียนไว้ให้ (แอดมินแก้เฉพาะช่องที่ผิด)
 *      · วันที่ที่ Excel เก็บเป็นวันที่ → แสดง วว/ดด/ปปปป · ข้อความวันที่ที่ผิด → คงตามเดิมให้เห็นว่าผิดตรงไหน
 *      · ผู้ขาย/ตำแหน่ง เติมจากไฟล์เปิดงาน (ตัวจับคู่เดียวกับรอบแรก) · ช่อง "แก้แล้ว" = "ไม่" ทุกแถว
 *   2. readManualRowsForm: หาหัวตารางด้วยชื่อหัว (ไม่ใช้ตำแหน่ง) → รับเฉพาะแถวที่ "แก้แล้ว" = "ใช่" ตรงตัว
 *      → สร้าง RawRow (key = SOURCE_COLUMNS) แล้วตรวจด้วย importContracts ตัวเดียวกับรอบแรก
 *        (allowMissingSeller + flagMalformedContractWithValue · ประเภทว่าง = อื่นๆ (ข3) · ตารางแปลงประเภทเดิม)
 *      · ระยะสัญญา = ช่องมูลค่า 1 ปี / 3 ปี (12 / 36 เดือน) + ช่อง "จำนวนเดือน" สำหรับ Custom (M30 · CLAUDE.md กฎ 5)
 *      · ผู้ขาย = ค่าในแบบฟอร์ม · ช่องว่าง + ส่ง sellerIndex → จับคู่ไฟล์เปิดงานใหม่ด้วยเลขสัญญาในฟอร์ม (ตัวที่แก้แล้ว · เจ้าของเลือก 23 พ.ย.)
 *      · เบอร์: parseThaiPhones (ผิดรูป = ไม่เก็บเบอร์ + เตือน เหมือนรอบแรก 2.84) · ชื่อผู้ติดต่อ = ป้ายของเบอร์แรกที่ยังไม่มีป้าย
 *      · ที่อยู่: cleanAddress (2.102) · มีตัวอักษรควบคุม = แถวไม่ผ่าน
 *      · แถวที่ไม่อยู่ในรายการแถวกรอกมือ (knownRows) / ซ้ำ / ค่าผิด = รายงาน (สาขา + เลขแถว + เหตุผลที่ตัดค่าจริงออกแล้ว) แล้วข้าม
 *   3. planManualRows: แถวที่ผ่าน → RegistryImportPlan (assemblePlannedBranch ตัวเดียวกับรอบแรก) · ตัดเลขสัญญาที่มีใน DB แล้วออก
 *      (skipContractNos) แล้วคิดยอดที่คาดจากแถวที่จะเขียนจริงเท่านั้น
 *   ⚠ PDPA: แถวแบบฟอร์ม / AcceptedFormRow / แผน มีชื่อ เบอร์ ที่อยู่ (หน่วยความจำเท่านั้น) — รายงานใช้ได้แค่ สาขา เลขแถว เลขสัญญา
 *     เหตุผล (ผ่าน kindOf/describeProblem ตัดค่าจริงออกแล้ว) และจำนวน
 */
import { normalizeBranch } from "./branches";
import { REGISTRY_IMPORT_BATCH_OCT26, REGISTRY_IMPORT_OPTIONS, registryTargetBranches } from "./centralRegistrySheets";
import { BLANK_CUSTOMER_TYPE_FALLBACK } from "./customerTypes";
import { cleanAddress, type AddressCellResult } from "./addresses";
import { normalizeContractNo } from "./fields";
import { importContracts } from "./importContracts";
import { assertImportBatch } from "./importRollback";
import { parseThaiPhones, type PhoneCellResult } from "./phones";
import { dryRunRegistrySheet, kindOf, type ExcludeRow, type HoldRow } from "./registryDryRun";
import {
  assemblePlannedBranch,
  assertPlanOptions,
  planTotals,
  type PlannedBranch,
  type PlanOptions,
  type RegistryImportPlan,
} from "./registryImportPlan";
import { buildManualEntryItems, describeProblem } from "./registryReport";
import { excelSerialToIso, type CellValue, type RegistrySheetResult } from "./registrySheet";
import { lookupSeller, type SellerIndex } from "./sellerLookup";
import type { CleanedRow, SourceColumn } from "./types";

// ---------------------------------------------------------------------
// คอลัมน์แบบฟอร์ม
// ---------------------------------------------------------------------

export type FormKey =
  | "seq"
  | "branch"
  | "file"
  | "sheet"
  | "excelRow"
  | "reason"
  | "rangeText"
  | "fixed"
  | "contractNo"
  | "customerName"
  | "customerType"
  | "startDate"
  | "endDate"
  | "value1y"
  | "value3y"
  | "termMonths"
  | "saleType"
  | "seller"
  | "sellerPosition"
  | "team"
  | "phone"
  | "contactLabel"
  | "address"
  | "note";

export interface FormColumn {
  key: FormKey;
  /** ชื่อหัวในแบบฟอร์ม (ตัวอ่านหาคอลัมน์ด้วยชื่อนี้ — ห้ามแก้ชื่อหัวในไฟล์) */
  header: string;
  /** true = ช่องอ้างอิง (ไม่ต้องแก้ · ตัวอ่านใช้แค่ สาขา + แถวใน Excel เป็นตัวระบุแถว) */
  reference: boolean;
  width: number;
  /** ค่าที่เลือกได้ (dropdown ในไฟล์ .xlsx) */
  list?: readonly string[];
}

export const FIXED_YES = "ใช่";
export const FIXED_NO = "ไม่";

export const FORM_COLUMNS: readonly FormColumn[] = [
  { key: "seq", header: "ลำดับ", reference: true, width: 6 },
  { key: "branch", header: "สาขา", reference: true, width: 12 },
  { key: "file", header: "ไฟล์ทะเบียน", reference: true, width: 30 },
  { key: "sheet", header: "ชีท", reference: true, width: 12 },
  { key: "excelRow", header: "แถวใน Excel", reference: true, width: 8 },
  { key: "reason", header: "เหตุที่นำเข้าไม่ได้", reference: true, width: 40 },
  { key: "rangeText", header: "ข้อความช่วงวันที่ในทะเบียน (อ้างอิง)", reference: true, width: 22 },
  { key: "fixed", header: "แก้แล้ว (ใช่/ไม่)", reference: false, width: 10, list: [FIXED_YES, FIXED_NO] },
  { key: "contractNo", header: "เลขที่สัญญา", reference: false, width: 15 },
  { key: "customerName", header: "ชื่อลูกค้า", reference: false, width: 28 },
  { key: "customerType", header: "ประเภทลูกค้า", reference: false, width: 18 },
  { key: "startDate", header: "วันเริ่มสัญญา (วว/ดด/ปปปป ค.ศ.)", reference: false, width: 14 },
  { key: "endDate", header: "วันสิ้นสุดสัญญา (วว/ดด/ปปปป ค.ศ.)", reference: false, width: 14 },
  { key: "value1y", header: "มูลค่าทั้งสัญญา ช่อง 1 ปี / Custom (บาท)", reference: false, width: 14 },
  { key: "value3y", header: "มูลค่าทั้งสัญญา ช่อง 3 ปี (บาท)", reference: false, width: 14 },
  { key: "termMonths", header: "จำนวนเดือน (เฉพาะ Custom)", reference: false, width: 10 },
  { key: "saleType", header: "New/Renew", reference: false, width: 10, list: ["New", "Renew"] },
  { key: "seller", header: "ชื่อผู้ขาย", reference: false, width: 18 },
  { key: "sellerPosition", header: "ตำแหน่งผู้ขาย (Sale/AM)", reference: false, width: 10, list: ["Sale", "AM"] },
  { key: "team", header: "ทีม", reference: false, width: 8 },
  { key: "phone", header: "เบอร์โทร", reference: false, width: 22 },
  { key: "contactLabel", header: "ชื่อผู้ติดต่อ", reference: false, width: 16 },
  { key: "address", header: "ที่อยู่ลูกค้า", reference: false, width: 40 },
  { key: "note", header: "หมายเหตุ (ไม่นำเข้า)", reference: false, width: 24 },
];

export type FormRow = Record<FormKey, string>;

/** หัวตารางเรียงตามคอลัมน์ */
export function formHeaders(): string[] {
  return FORM_COLUMNS.map((c) => c.header);
}

/** แถวแบบฟอร์ม → array ตามลำดับคอลัมน์ */
export function formRowValues(row: FormRow): string[] {
  return FORM_COLUMNS.map((c) => row[c.key]);
}

/** ตัวระบุแถว (สาขา + เลขแถวทะเบียน · 1 ชีท = 1 สาขา จึงไม่ซ้ำข้ามไฟล์) */
export function manualRowKey(branch: string, excelRow: number): string {
  return `${branch}|${excelRow}`;
}

// ---------------------------------------------------------------------
// 1. สร้างแบบฟอร์ม (เติมค่าเดิมจากทะเบียน)
// ---------------------------------------------------------------------

/** ชีททะเบียน 1 สาขา (รูปเดียวกับ CentralSheet ใน centralRegistryFiles.ts) */
export interface ManualFormSheet {
  file: string;
  sheet: string;
  branch: string;
  grid: CellValue[][];
  parsed: RegistrySheetResult;
  holdRows?: HoldRow[];
  excludeRows?: ExcludeRow[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → 'วว/ดด/ปปปป' · ค่าอื่นคงเดิม */
export function isoToFormDate(v: string): string {
  const m = ISO_DATE.exec(v.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v.trim();
}

function cellString(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v).trim();
}

function ticked(v: string | undefined): boolean {
  const s = (v ?? "").trim().toUpperCase();
  return s !== "" && s !== "FALSE" && s !== "0";
}

/**
 * แถวแบบฟอร์มของทุกแถวที่ต้องกรอกมือ เรียงตามสาขา (ลำดับชีท) แล้วตามเลขแถว — ดู Logic summary ข้อ 1
 * ⚠ ผลลัพธ์มีข้อมูลลูกค้า — เขียนลงไฟล์ใน fixtures/ เท่านั้น ห้าม log
 */
export function buildManualFormRows(sheets: readonly ManualFormSheet[], sellerIndex?: SellerIndex): FormRow[] {
  const out: FormRow[] = [];
  for (const s of sheets) {
    const dry = dryRunRegistrySheet(s.sheet, s.grid, {
      rules: [],
      months: [],
      branch: s.branch,
      holdRows: s.holdRows,
      excludeRows: s.excludeRows,
      ...REGISTRY_IMPORT_OPTIONS,
    });
    const items = buildManualEntryItems([dry]);
    const cols = s.parsed.columns;
    for (const item of items) {
      const row = s.parsed.rows.find((r) => r.excelRow === item.excelRow);
      if (!row) throw new Error(`แบบฟอร์ม: ${s.branch} แถว ${item.excelRow} ไม่พบในชีท — หยุด`);
      const raw = row.raw as Partial<Record<SourceColumn, string>>;
      const cells = s.grid[item.excelRow - 1] ?? [];
      const isNew = ticked(raw.New);
      const isRenew = ticked(raw.Renew);
      const ct = normalizeContractNo(raw["เลขที่สัญญา"] ?? "");
      const found = sellerIndex && ct.isContractNo ? lookupSeller(sellerIndex, ct.value) : null;
      const seller = found?.status === "matched" ? found.seller : null;
      const v1 = (raw["1 ปี"] ?? "").trim();
      const v3 = (raw["3 ปี"] ?? "").trim();
      out.push({
        seq: String(out.length + 1),
        branch: s.branch,
        file: s.file,
        sheet: s.sheet,
        excelRow: String(item.excelRow),
        reason: item.reasons.join(" · "),
        rangeText: cols.startDate > 0 ? cellString(cells[cols.startDate - 1]) : "",
        fixed: FIXED_NO,
        contractNo: (raw["เลขที่สัญญา"] ?? "").trim(),
        customerName: (raw["รายชื่อ"] ?? "").trim(),
        customerType: (raw["ประเภท"] ?? "").trim(),
        startDate: isoToFormDate(raw["เริ่ม"] ?? ""),
        endDate: isoToFormDate(raw["สิ้นสุด"] ?? ""),
        value1y: v1,
        value3y: v3,
        termMonths: "",
        saleType: isNew && !isRenew ? "New" : isRenew && !isNew ? "Renew" : "",
        seller: seller?.name ?? "",
        sellerPosition: seller ? (seller.position.trim().toUpperCase() === "AM" ? "AM" : "Sale") : "",
        team: (raw["ทีม"] ?? "").trim(),
        phone: cols.phone !== null ? cellString(cells[cols.phone]) : "",
        contactLabel: "",
        address: cols.address !== null ? cellString(cells[cols.address]) : "",
        note: "",
      });
    }
  }
  return out;
}

/**
 * อ่านตาราง "| สาขา | แถว | เหตุผล |" จากเอกสาร docs/รายการกรอกมือ-*.md (ไม่มีข้อมูลลูกค้า)
 * ใช้เทียบว่าแบบฟอร์มมีแถวครบตรงเอกสารที่เจ้าของเห็น
 */
export function parseManualListMarkdown(md: string): { branch: string; excelRow: number }[] {
  const out: { branch: string; excelRow: number }[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*[^|]+\|\s*$/.exec(line);
    if (m) out.push({ branch: m[1]!, excelRow: Number(m[2]) });
  }
  return out;
}

/** จำนวนแถวที่มีค่าต่อคอลัมน์ (รายงานได้ · ไม่มีค่าจริง) */
export function countFilledByColumn(rows: readonly FormRow[]): Record<string, { filled: number; blank: number }> {
  const out: Record<string, { filled: number; blank: number }> = {};
  for (const c of FORM_COLUMNS) {
    const filled = rows.filter((r) => r[c.key].trim() !== "").length;
    out[c.header] = { filled, blank: rows.length - filled };
  }
  return out;
}

// ---------------------------------------------------------------------
// 2. อ่านแบบฟอร์มที่กรอกแล้ว
// ---------------------------------------------------------------------

/** แถวที่ผ่านการตรวจ · ⚠ มีข้อมูลลูกค้า */
export interface AcceptedFormRow {
  key: string;
  branch: string;
  area: string;
  /** เลขแถวทะเบียนต้นทาง */
  excelRow: number;
  /** เลขแถวในไฟล์แบบฟอร์ม (เริ่ม 1) */
  formRow: number;
  cleaned: CleanedRow;
  phones: PhoneCellResult;
  address: AddressCellResult;
  /** คำเตือน (ตัดค่าจริงออกแล้ว) */
  warnings: string[];
}

/** แถวที่ไม่ผ่าน — ไม่มีข้อมูลลูกค้า */
export interface FormProblem {
  formRow: number;
  /** ว่าง = อ่านสาขาไม่ได้ */
  branch: string;
  /** 0 = อ่านเลขแถวไม่ได้ */
  excelRow: number;
  reasons: string[];
}

export interface FormReadResult {
  accepted: AcceptedFormRow[];
  invalid: FormProblem[];
  counts: {
    /** แถวที่มีข้อมูล (มีสาขาหรือเลขแถว) */
    rows: number;
    fixedYes: number;
    fixedNo: number;
    fixedBlank: number;
    fixedOther: number;
    accepted: number;
    invalid: number;
    /** แถว "ใช่" ที่ช่องผู้ขายว่างแล้วจับคู่จากไฟล์เปิดงานได้ (นับก่อนตรวจแถว) */
    sellerMatched: number;
  };
}

export interface FormReadOptions {
  /** ตัวระบุแถวที่อยู่ในรายการกรอกมือ (manualRowKey) · ไม่ส่ง = ไม่ตรวจ (เทสเท่านั้น — สคริปต์ต้องส่งเสมอ) */
  knownRows?: ReadonlySet<string>;
  /** รหัสทีมที่มีจริง (ImportOptions.teamCodes) · ไม่ส่ง = ชุดตั้งต้น */
  teamCodes?: readonly string[];
  /**
   * ดัชนีผู้ขายจากไฟล์เปิดงาน (2569 ก่อน 2568 · เจ้าของเลือก 23 พ.ย. 2026):
   * ช่องผู้ขายในฟอร์มว่าง → จับคู่ด้วยเลขสัญญาในฟอร์ม (ตัวที่แก้แล้ว) · ช่องผู้ขายมีค่า = ใช้ค่าฟอร์ม · ไม่ส่ง = ไม่จับคู่
   */
  sellerIndex?: SellerIndex;
}

const HEADER_SCAN_ROWS = 10;
const BE_YEAR_DATE = /^\d{1,2}\/\d{1,2}\/(\d{4})$/;
const POSITIONS = new Map([
  ["", ""],
  ["SALE", "Sale"],
  ["AM", "AM"],
]);

function text(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v).replace(/ /g, " ").trim();
}

/** หาแถวหัว + index ของทุกคอลัมน์ (ชื่อหัวต้องตรงตัว · ขาด = throw) */
function findFormHeader(grid: CellValue[][]): { headerRow: number; col: Record<FormKey, number> } {
  for (let r = 0; r < Math.min(grid.length, HEADER_SCAN_ROWS); r++) {
    const labels = (grid[r] ?? []).map(text);
    if (!labels.includes(FORM_COLUMNS[0]!.header) || !labels.includes("แก้แล้ว (ใช่/ไม่)")) continue;
    const col = {} as Record<FormKey, number>;
    const missing: string[] = [];
    for (const c of FORM_COLUMNS) {
      const i = labels.indexOf(c.header);
      if (i < 0) missing.push(c.header);
      col[c.key] = i;
    }
    if (missing.length) throw new Error(`แบบฟอร์ม: ไม่พบหัวคอลัมน์ ${missing.map((m) => `"${m}"`).join(", ")} — ห้ามแก้ชื่อหัว`);
    return { headerRow: r, col };
  }
  throw new Error("แบบฟอร์ม: ไม่พบแถวหัวตาราง (ต้องมีหัว \"ลำดับ\" และ \"แก้แล้ว (ใช่/ไม่)\")");
}

/** ค่าช่องวันที่ในแบบฟอร์ม → ข้อความที่ importContracts อ่าน (serial ของ Excel → ISO) · ปี พ.ศ. = error */
function formDate(v: CellValue | undefined, label: string): { value: string; error?: string } {
  if (typeof v === "number") {
    const iso = excelSerialToIso(v);
    return iso ? { value: iso } : { value: "", error: `${label}: อ่านวันที่ไม่ออก` };
  }
  const s = text(v);
  const be = BE_YEAR_DATE.exec(s);
  if (be && Number(be[1]) >= 2400) return { value: "", error: `${label}: ใช้ปี พ.ศ. — ต้องเป็นปี ค.ศ. (เช่น 2026)` };
  return { value: s };
}

/** ช่องตัวเลข (มูลค่า / จำนวนเดือน) → ข้อความ */
function formNumber(v: CellValue | undefined): string {
  return typeof v === "number" ? String(v) : text(v);
}

/** อ่านแบบฟอร์ม (grid จาก readXlsx หรือ parseCsv) — ดู Logic summary ข้อ 2 */
export function readManualRowsForm(grid: CellValue[][], opts: FormReadOptions = {}): FormReadResult {
  const { headerRow, col } = findFormHeader(grid);
  const targets = new Set(registryTargetBranches());
  const invalid: FormProblem[] = [];
  const counts = { rows: 0, fixedYes: 0, fixedNo: 0, fixedBlank: 0, fixedOther: 0, accepted: 0, invalid: 0, sellerMatched: 0 };
  const seenKeys = new Set<string>();

  interface Pending {
    formRow: number;
    branch: string;
    area: string;
    excelRow: number;
    raw: Partial<Record<SourceColumn, string>>;
    phoneCell: CellValue;
    contactLabel: string;
    addressCell: CellValue;
    warnings: string[];
  }
  const pending: Pending[] = [];

  for (let r = headerRow + 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    const get = (k: FormKey) => cells[col[k]];
    const branchText = text(get("branch"));
    const rowText = formNumber(get("excelRow"));
    if (!branchText && !rowText) continue; // แถวว่าง
    counts.rows++;
    const formRow = r + 1;
    const excelRow = /^\d+$/.test(rowText) ? Number(rowText) : 0;
    const fail = (reasons: string[]) => invalid.push({ formRow, branch: targets.has(branchText) ? branchText : "", excelRow, reasons });

    const fixed = text(get("fixed"));
    if (fixed === FIXED_YES) counts.fixedYes++;
    else if (fixed === FIXED_NO) counts.fixedNo++;
    else if (fixed === "") counts.fixedBlank++;
    else counts.fixedOther++;

    // ตัวระบุแถวต้องถูกก่อนเสมอ (แม้ยังไม่แก้) — กันแถวแปลกปลอม/ซ้ำ
    const idErrors: string[] = [];
    if (!targets.has(branchText)) idErrors.push("ช่องสาขาไม่ใช่สาขาในรายการนำเข้า (ห้ามแก้ช่องอ้างอิง)");
    if (excelRow === 0) idErrors.push("ช่องแถวใน Excel ไม่ใช่ตัวเลข (ห้ามแก้ช่องอ้างอิง)");
    const key = manualRowKey(branchText, excelRow);
    if (!idErrors.length) {
      if (seenKeys.has(key)) idErrors.push("แถวซ้ำ (สาขา + แถวใน Excel เดียวกันมีมากกว่า 1 แถว)");
      else if (opts.knownRows && !opts.knownRows.has(key)) idErrors.push("ไม่อยู่ในรายการแถวที่นำเข้าไม่ได้ (ห้ามเพิ่มแถวใหม่ในแบบฟอร์มนี้)");
      seenKeys.add(key);
    }
    if (idErrors.length) {
      fail(idErrors);
      continue;
    }
    if (fixed === FIXED_NO || fixed === "") continue; // ยังไม่แก้ = ไม่นำเข้า (ไม่ใช่ข้อผิดพลาด)
    if (fixed !== FIXED_YES) {
      fail([`ช่อง "แก้แล้ว" ต้องเป็น ${FIXED_YES} หรือ ${FIXED_NO}`]);
      continue;
    }

    const errors: string[] = [];
    const start = formDate(get("startDate"), "วันเริ่มสัญญา");
    const end = formDate(get("endDate"), "วันสิ้นสุด");
    if (start.error) errors.push(start.error);
    if (end.error) errors.push(end.error);

    const saleType = text(get("saleType"));
    const st = saleType.toUpperCase();
    if (st !== "" && st !== "NEW" && st !== "RENEW") errors.push("ช่อง New/Renew ต้องเป็น New หรือ Renew หรือเว้นว่าง");
    const position = POSITIONS.get(text(get("sellerPosition")).toUpperCase());
    if (position === undefined) errors.push("ช่องตำแหน่งผู้ขายต้องเป็น Sale หรือ AM หรือเว้นว่าง");

    if (errors.length) {
      fail(errors);
      continue;
    }

    const type = text(get("customerType"));
    let seller = text(get("seller"));
    let sellerPos = position ?? "";
    if (seller === "" && opts.sellerIndex) {
      const ct = normalizeContractNo(text(get("contractNo")));
      const found = ct.isContractNo ? lookupSeller(opts.sellerIndex, ct.value) : null;
      if (found?.status === "matched") {
        seller = found.seller.name;
        sellerPos = found.seller.position; // AM → am_name · อื่น → sale_name (sellerColumns · 2.73 ต1)
        counts.sellerMatched++;
      }
    }
    pending.push({
      formRow,
      branch: branchText,
      area: normalizeBranch(branchText).zone ?? "",
      excelRow,
      raw: {
        เลขที่สัญญา: text(get("contractNo")),
        รายชื่อ: text(get("customerName")),
        New: st === "NEW" ? "TRUE" : "",
        Renew: st === "RENEW" ? "TRUE" : "",
        ผู้ขาย: seller,
        ตำแหน่ง: sellerPos,
        สาขา: branchText,
        ทีม: text(get("team")),
        // ข3: ประเภทว่าง = อื่นๆ (ระบุในหมายเหตุ) เหมือนรอบแรก
        ประเภท: type === "" && REGISTRY_IMPORT_OPTIONS.blankCustomerTypeAsOther ? BLANK_CUSTOMER_TYPE_FALLBACK : type,
        เริ่ม: start.value,
        สิ้นสุด: end.value,
        "1 ปี": formNumber(get("value1y")),
        "3 ปี": formNumber(get("value3y")),
        จำนวนเดือน: formNumber(get("termMonths")),
      },
      phoneCell: get("phone") ?? null,
      contactLabel: text(get("contactLabel")),
      addressCell: get("address") ?? null,
      warnings: [],
    });
  }

  // ตรวจทุกแถวรวดเดียว → importContracts จับเลขสัญญาซ้ำในแบบฟอร์มด้วย
  const result = importContracts(
    pending.map((p) => p.raw as Record<string, string>),
    {
      allowMissingSeller: true,
      flagMalformedContractWithValue: REGISTRY_IMPORT_OPTIONS.flagMalformedContractWithValue,
      teamCodes: opts.teamCodes,
    },
  );
  const reason = (msg: string) => describeProblem(kindOf(msg));
  const accepted: AcceptedFormRow[] = [];
  for (const m of result.mustFix) {
    const p = pending[m.rowIndex - 1]!;
    invalid.push({ formRow: p.formRow, branch: p.branch, excelRow: p.excelRow, reasons: m.errors.map(reason) });
  }
  for (const s of result.skipped) {
    const p = pending[s.rowIndex - 1]!;
    invalid.push({ formRow: p.formRow, branch: p.branch, excelRow: p.excelRow, reasons: ["เลขที่สัญญาผิดรูปหรือว่าง"] });
  }
  for (const c of result.ready) {
    const p = pending[c.rowIndex - 1]!;
    const errors: string[] = [];
    const warnings = c.warnings.map(reason);

    const cents = c.valueTotal * 100;
    if (Math.abs(cents - Math.round(cents)) > 1e-6) errors.push("มูลค่ามีทศนิยมเกิน 2 ตำแหน่ง");

    const address = cleanAddress(p.addressCell);
    if (address.status === "controlChar") errors.push("ที่อยู่มีตัวอักษรพิเศษที่บันทึกไม่ได้ (ลบแล้วพิมพ์ใหม่)");

    let phones = parseThaiPhones(p.phoneCell);
    if (typeof p.phoneCell === "number") warnings.push("เบอร์โทรเป็นตัวเลข (เลข 0 หน้าอาจหาย) — ไม่นำเข้าเบอร์");
    else if (phones.status === "invalid") warnings.push("เบอร์โทรรูปแบบไม่ถูก — ไม่นำเข้าเบอร์");
    if (p.contactLabel) {
      const first = phones.phones[0];
      if (!first) warnings.push("มีชื่อผู้ติดต่อแต่ไม่มีเบอร์ที่ใช้ได้ — ไม่นำเข้าชื่อผู้ติดต่อ");
      else if (first.label) warnings.push("เบอร์แรกมีชื่อผู้ติดต่ออยู่แล้วในช่องเบอร์ — ใช้ชื่อในช่องเบอร์");
      else if (p.contactLabel.length > 40) warnings.push("ชื่อผู้ติดต่อยาวเกิน 40 ตัว — ไม่นำเข้าชื่อผู้ติดต่อ");
      else phones = { ...phones, phones: [{ ...first, label: p.contactLabel }, ...phones.phones.slice(1)] };
    }
    if (phones.labelTooLong) warnings.push("ชื่อผู้ติดต่อในช่องเบอร์ยาวเกิน 40 ตัว — ไม่นำเข้าชื่อนั้น");

    if (errors.length) {
      invalid.push({ formRow: p.formRow, branch: p.branch, excelRow: p.excelRow, reasons: errors });
      continue;
    }
    accepted.push({
      key: manualRowKey(p.branch, p.excelRow),
      branch: p.branch,
      area: p.area,
      excelRow: p.excelRow,
      formRow: p.formRow,
      cleaned: c,
      phones,
      address,
      warnings: [...new Set(warnings)],
    });
  }

  invalid.sort((a, b) => a.formRow - b.formRow);
  accepted.sort((a, b) => a.formRow - b.formRow);
  counts.accepted = accepted.length;
  counts.invalid = invalid.length;
  return { accepted, invalid, counts };
}

// ---------------------------------------------------------------------
// CSV (ทางเลือก — แนะนำ .xlsx เพราะ Excel แปลงเบอร์/วันที่ใน CSV เอง)
// ---------------------------------------------------------------------

/** CSV (RFC 4180 · คั่นด้วย , · ตัด BOM) → grid ของข้อความ */
export function parseCsv(input: string): CellValue[][] {
  const s = input.replace(/^﻿/, "");
  const rows: CellValue[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** grid → CSV (ใส่ " รอบค่าที่มี , " หรือขึ้นบรรทัด) · ไม่ใส่ BOM (ผู้เรียกใส่เอง) */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------
// 3. แผนนำเข้า (append)
// ---------------------------------------------------------------------

const FIX_BATCH_RE = new RegExp(`^${REGISTRY_IMPORT_BATCH_OCT26}-fix\\d+$`);

/**
 * ชื่อรอบนำเข้า (contracts.import_batch) ของแบบฟอร์ม: ต้องมี · รูป `registry-OCT26-fix<เลขรอบ>` เท่านั้น
 * (ห้ามใช้ registry-OCT26 ของรอบแรก — ถอยรอบแก้จะลบรอบแรกไปด้วย)
 */
export function assertFixBatch(batch: string | undefined): string {
  const b = assertImportBatch(batch);
  if (!FIX_BATCH_RE.test(b)) {
    throw new Error(`หยุด: --batch ของแบบฟอร์มต้องเป็นรูป ${REGISTRY_IMPORT_BATCH_OCT26}-fix<เลขรอบ> เช่น ${REGISTRY_IMPORT_BATCH_OCT26}-fix1`);
  }
  return b;
}

/** แถวที่ข้ามเพราะเลขสัญญามีใน DB แล้ว (ไม่มีข้อมูลลูกค้า) */
export interface SkippedExisting {
  formRow: number;
  branch: string;
  excelRow: number;
  contractNo: string;
}

export interface ManualPlanResult {
  plan: RegistryImportPlan;
  skippedExisting: SkippedExisting[];
}

/** แถวที่ผ่าน → แผนนำเข้า (ตัดเลขสัญญาใน skipContractNos ออกก่อนคิดยอด) — ดู Logic summary ข้อ 3 */
export function planManualRows(
  accepted: readonly AcceptedFormRow[],
  opts: Pick<PlanOptions, "rules" | "month" | "importBatch"> & { skipContractNos?: ReadonlySet<string> },
): ManualPlanResult {
  assertPlanOptions(opts);
  assertFixBatch(opts.importBatch);
  const skip = opts.skipContractNos ?? new Set<string>();
  const skippedExisting: SkippedExisting[] = [];
  const byBranch = new Map<string, AcceptedFormRow[]>();
  for (const a of accepted) {
    if (skip.has(a.cleaned.contractNo)) {
      skippedExisting.push({ formRow: a.formRow, branch: a.branch, excelRow: a.excelRow, contractNo: a.cleaned.contractNo });
      continue;
    }
    byBranch.set(a.branch, [...(byBranch.get(a.branch) ?? []), a]);
  }
  const seenContract = new Set<string>();
  // เรียงสาขาตามตารางไฟล์ → ชีท (ลำดับเดียวกับรอบแรก)
  const branches: PlannedBranch[] = registryTargetBranches()
    .filter((b) => byBranch.has(b))
    .map((branch) => {
      const rows = byBranch.get(branch)!;
      return assemblePlannedBranch(
        {
          sheet: "แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้",
          ref: { branch, area: rows[0]!.area },
          rows: rows.map((r) => ({ excelRow: r.excelRow, cleaned: r.cleaned, phones: r.phones, address: r.address })),
          heldRows: [],
          mustFixRows: [],
          excludedRows: [],
          hasPhoneColumn: true,
          hasAddressColumn: true,
          addressHeaderVariants: [],
        },
        opts,
        seenContract,
      );
    });
  return {
    plan: { month: opts.month, importBatch: opts.importBatch, branches, totals: planTotals(branches) },
    skippedExisting,
  };
}
