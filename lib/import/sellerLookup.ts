/**
 * จับคู่ "ผู้ขาย" ให้สัญญาที่นำเข้าจากทะเบียนรายสาขา โดยใช้เลขที่สัญญาค้นในไฟล์เปิดงาน (DECISIONS 2.70 ฉ · แก้ทับโดยเจ้าของ 17 พ.ย. 2026)
 * pure function — รับ grid ของแต่ละชีท (อ่านไฟล์ด้วย lib/import/xlsx/readXlsx.ts ฝั่งผู้เรียก)
 *
 * Logic summary:
 *   1. ไฟล์เปิดงาน 1 ชีท = 1 เดือน · หัวตารางอยู่ราวแถว 2–3 และบางเดือนกิน 2 แถว (ป้าย "ผู้ขาย"/"ตำแหน่ง" อยู่แถวล่าง)
 *      → หาแถวที่มี "เลขที่สัญญา" ในช่วงต้นชีท · หาคอลัมน์ผู้ขาย/ตำแหน่งจากแถวนั้น ถ้าไม่เจอดูแถวถัดไป
 *      → ชีทที่ไม่มีคอลัมน์ "เลขที่สัญญา" + "ผู้ขาย" (Reference, รายชื่อเซลล์, ฟอร์มเปล่า) = ข้าม และบันทึกชื่อชีทไว้
 *   2. เลขที่สัญญาล้างด้วย normalizeContractNo ตัวเดียวกับ importContracts (ทั้งฝั่งไฟล์เปิดงานและฝั่งทะเบียน)
 *   3. เลขเดียวกันเจอหลายครั้ง: ชื่อผู้ขายเหมือนกัน (เทียบแบบตัดช่องว่าง) = ใช้ได้ · ชื่อต่างกัน = "conflict" ไม่ใส่ผู้ขาย
 *      (ไม่เดาว่าอันไหนถูก — ปล่อยว่างแล้วให้ Admin เติม)
 *   4. ผลลัพธ์: matched (มีชื่อ + ตำแหน่ง) · blank (เจอเลขแต่ช่องผู้ขายว่าง) · conflict · notFound
 *      → ที่ไม่ใช่ matched = ปล่อยว่าง (sale_name NULL)
 *
 * ⚠ PDPA: ชื่อผู้ขายอยู่ในหน่วยความจำเท่านั้น — ห้ามใส่ลง fix/warning/รายงาน (รายงานเป็น "จำนวน" อย่างเดียว)
 * ⚠ ชีทเดือนล่าสุดอาจมีแถวว่างเป็นล้านแถว → ใช้ loop ธรรมดา ห้าม spread ทั้งชีท (stack overflow)
 */
import { normalizeContractNo } from "./fields";
import type { CellValue } from "./registrySheet";

export interface SellerInfo {
  name: string;
  /** ตำแหน่งตามไฟล์เปิดงาน (เช่น Sale / AM) · "" = ไม่ระบุ */
  position: string;
}

export type SellerLookupResult =
  | { status: "matched"; seller: SellerInfo }
  | { status: "blank" }
  | { status: "conflict" }
  | { status: "notFound" };

interface Entry {
  seller: SellerInfo | null;
  conflict: boolean;
}

export interface SellerIndex {
  /** key = เลขที่สัญญาที่ล้างแล้ว */
  readonly entries: ReadonlyMap<string, Entry>;
  /** จำนวนเลขที่สัญญา (ไม่ซ้ำ) ที่อ่านได้ */
  readonly contracts: number;
  readonly sheetsRead: string[];
  readonly sheetsSkipped: string[];
}

const HEADER_SCAN_ROWS = 10;

function label(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** ชื่อผู้ขายสำหรับเทียบ (ตัดช่องว่างทั้งหมด) */
function sellerKey(name: string): string {
  return name.replace(/\s+/g, "");
}

interface SheetColumns {
  headerRow: number;
  contractNo: number;
  seller: number;
  position: number | null;
}

function findColumns(rows: CellValue[][]): SheetColumns | null {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    const contractNo = row.findIndex((c) => label(c) === "เลขที่สัญญา");
    if (contractNo < 0) continue;
    // ผู้ขาย/ตำแหน่ง: แถวเดียวกันก่อน ไม่เจอค่อยดูแถวล่าง (หัว 2 แถว)
    for (const hr of [r, r + 1]) {
      const cells = rows[hr] ?? [];
      const seller = cells.findIndex((c) => label(c) === "ผู้ขาย");
      if (seller < 0) continue;
      const pos = cells.findIndex((c) => label(c) === "ตำแหน่ง");
      return { headerRow: hr, contractNo, seller, position: pos >= 0 ? pos : null };
    }
    return null;
  }
  return null;
}

/** สร้างดัชนี เลขที่สัญญา → ผู้ขาย จากชีททั้งหมดของไฟล์เปิดงาน */
export function buildSellerIndex(sheets: { name: string; rows: CellValue[][] }[]): SellerIndex {
  const entries = new Map<string, Entry>();
  const sheetsRead: string[] = [];
  const sheetsSkipped: string[] = [];

  for (const sheet of sheets) {
    const cols = findColumns(sheet.rows);
    if (!cols) {
      sheetsSkipped.push(sheet.name);
      continue;
    }
    sheetsRead.push(sheet.name);

    for (let r = cols.headerRow + 1; r < sheet.rows.length; r++) {
      const cells = sheet.rows[r];
      if (!cells) continue;
      const ct = normalizeContractNo(label(cells[cols.contractNo]));
      if (!ct.isContractNo) continue;

      const name = label(cells[cols.seller]);
      const seller: SellerInfo | null = name
        ? { name, position: cols.position !== null ? label(cells[cols.position]) : "" }
        : null;

      const prev = entries.get(ct.value);
      if (!prev) {
        entries.set(ct.value, { seller, conflict: false });
      } else if (!prev.seller) {
        // ครั้งก่อนช่องว่าง → ใช้ครั้งนี้แทน (ถ้ามี)
        prev.seller = seller;
      } else if (seller && sellerKey(seller.name) !== sellerKey(prev.seller.name)) {
        prev.conflict = true;
      }
    }
  }

  return { entries, contracts: entries.size, sheetsRead, sheetsSkipped };
}

/** ค้นผู้ขายของเลขที่สัญญา (ล้างเลขก่อนค้น) */
export function lookupSeller(index: SellerIndex, contractNo: string): SellerLookupResult {
  const entry = index.entries.get(normalizeContractNo(contractNo ?? "").value);
  if (!entry) return { status: "notFound" };
  if (entry.conflict) return { status: "conflict" };
  if (!entry.seller) return { status: "blank" };
  return { status: "matched", seller: entry.seller };
}
