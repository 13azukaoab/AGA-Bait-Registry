/**
 * จับคู่ "ผู้ขาย" ให้สัญญาที่นำเข้าจากทะเบียนรายสาขา โดยใช้เลขที่สัญญาค้นในไฟล์เปิดงาน (DECISIONS 2.70)
 * pure function — รับ grid ของแต่ละชีท (อ่านไฟล์ด้วย lib/import/xlsx/readXlsx.ts ฝั่งผู้เรียก)
 *
 * Logic summary:
 *   1. ไฟล์เปิดงาน 1 ชีท = 1 เดือน · หัวตารางอยู่ราวแถว 2–3 และบางเดือนกิน 2 แถว (ป้าย "ผู้ขาย"/"ตำแหน่ง" อยู่แถวล่าง)
 *      → หาแถวที่มี "เลขที่สัญญา" ในช่วงต้นชีท · หาคอลัมน์ผู้ขาย/ตำแหน่งจากแถวนั้น ถ้าไม่เจอดูแถวถัดไป
 *      → ชีทที่ไม่มีคอลัมน์ "เลขที่สัญญา" (Reference, รายชื่อเซลล์, ฟอร์มเปล่า) = ข้าม (sheetsSkipped)
 *      → ชีทที่มีเลขที่สัญญาแต่ไม่มีคอลัมน์ "ผู้ขาย" (เช่น ไฟล์เปิดงาน 2568) = sheetsWithoutSeller
 *        เลขสัญญาในชีทนั้นได้สถานะ "noSellerColumn" (เจอสัญญา แต่ไฟล์ไม่มีข้อมูลผู้ขาย) — ไม่เดาคอลัมน์อื่นแทน
 *   2. เลขที่สัญญาล้างด้วย normalizeContractNo ตัวเดียวกับ importContracts (ทั้งฝั่งไฟล์เปิดงานและฝั่งทะเบียน)
 *   3. เลขเดียวกันเจอหลายครั้งในไฟล์เดียว: ชื่อผู้ขายเหมือนกัน (เทียบแบบตัดช่องว่าง) = ใช้ได้ · ชื่อต่างกัน = "conflict"
 *      ไม่ใส่ผู้ขาย (ไม่เดาว่าอันไหนถูก — ปล่อยว่าง)
 *   4. หลายไฟล์ (mergeSellerIndexes · ส่งปีล่าสุดมาก่อน): ใช้ไฟล์แรกที่ "จับคู่ได้" (matched)
 *      · ปีล่าสุดกับปีเก่าได้ชื่อต่างกัน → ใช้ปีล่าสุด และจดเลขสัญญาไว้ใน crossSourceConflicts (เจ้าของสั่ง 17 พ.ย. 2026)
 *      · ไม่มีไฟล์ไหน matched → ใช้สถานะของไฟล์แรกที่เจอเลขสัญญา (blank / conflict / noSellerColumn) · ไม่เจอเลย = notFound
 *   5. ผลลัพธ์ที่ไม่ใช่ matched = ปล่อยว่าง (sale_name / am_name NULL) และไม่ต้องตามแก้
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
  /** ไฟล์ที่ให้ชื่อนี้ (ป้ายที่ส่งเข้า mergeSellerIndexes เช่น "2569") · ไม่มี = ดัชนีไฟล์เดียว */
  source?: string;
}

export type SellerLookupResult =
  | { status: "matched"; seller: SellerInfo }
  | { status: "blank" }
  | { status: "conflict" }
  | { status: "noSellerColumn" }
  | { status: "notFound" };

interface Entry {
  seller: SellerInfo | null;
  conflict: boolean;
  /** ชีทที่เจอเลขนี้ไม่มีคอลัมน์ผู้ขาย */
  noSellerColumn: boolean;
}

export interface SellerIndex {
  /** key = เลขที่สัญญาที่ล้างแล้ว */
  readonly entries: ReadonlyMap<string, Entry>;
  /** จำนวนเลขที่สัญญา (ไม่ซ้ำ) ที่อ่านได้ */
  readonly contracts: number;
  /** ชีทที่มีทั้งเลขที่สัญญาและผู้ขาย */
  readonly sheetsRead: string[];
  /** ชีทที่มีเลขที่สัญญาแต่ไม่มีคอลัมน์ผู้ขาย */
  readonly sheetsWithoutSeller: string[];
  /** ชีทที่ไม่ใช่ข้อมูลงาน (ไม่มีคอลัมน์เลขที่สัญญา) */
  readonly sheetsSkipped: string[];
  /** เลขสัญญาที่หลายไฟล์ให้ชื่อผู้ขายต่างกัน (ใช้ไฟล์ล่าสุด) · ดัชนีไฟล์เดียว = ว่าง */
  readonly crossSourceConflicts: ReadonlySet<string>;
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
  /** null = ชีทนี้ไม่มีคอลัมน์ผู้ขาย */
  seller: number | null;
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
    return { headerRow: r, contractNo, seller: null, position: null };
  }
  return null;
}

/** สร้างดัชนี เลขที่สัญญา → ผู้ขาย จากชีททั้งหมดของไฟล์เปิดงาน 1 ไฟล์ */
export function buildSellerIndex(sheets: { name: string; rows: CellValue[][] }[]): SellerIndex {
  const entries = new Map<string, Entry>();
  const sheetsRead: string[] = [];
  const sheetsWithoutSeller: string[] = [];
  const sheetsSkipped: string[] = [];

  for (const sheet of sheets) {
    const cols = findColumns(sheet.rows);
    if (!cols) {
      sheetsSkipped.push(sheet.name);
      continue;
    }
    (cols.seller === null ? sheetsWithoutSeller : sheetsRead).push(sheet.name);

    for (let r = cols.headerRow + 1; r < sheet.rows.length; r++) {
      const cells = sheet.rows[r];
      if (!cells) continue;
      const ct = normalizeContractNo(label(cells[cols.contractNo]));
      if (!ct.isContractNo) continue;

      const prev = entries.get(ct.value);
      if (cols.seller === null) {
        if (!prev) entries.set(ct.value, { seller: null, conflict: false, noSellerColumn: true });
        continue;
      }

      const name = label(cells[cols.seller]);
      const seller: SellerInfo | null = name
        ? { name, position: cols.position !== null ? label(cells[cols.position]) : "" }
        : null;

      if (!prev) {
        entries.set(ct.value, { seller, conflict: false, noSellerColumn: false });
      } else if (!prev.seller) {
        // ครั้งก่อนช่องว่าง/ไม่มีคอลัมน์ → ใช้ครั้งนี้แทน (ถ้ามี)
        prev.seller = seller;
        prev.noSellerColumn = prev.noSellerColumn && !seller;
      } else if (seller && sellerKey(seller.name) !== sellerKey(prev.seller.name)) {
        prev.conflict = true;
      }
    }
  }

  return {
    entries,
    contracts: entries.size,
    sheetsRead,
    sheetsWithoutSeller,
    sheetsSkipped,
    crossSourceConflicts: new Set(),
  };
}

function resultOf(entry: Entry | undefined): SellerLookupResult {
  if (!entry) return { status: "notFound" };
  if (entry.conflict) return { status: "conflict" };
  if (entry.seller) return { status: "matched", seller: entry.seller };
  if (entry.noSellerColumn) return { status: "noSellerColumn" };
  return { status: "blank" };
}

/**
 * รวมดัชนีหลายไฟล์ — ส่ง **ปีล่าสุดมาก่อน** (เช่น [2569, 2568])
 * ใช้ไฟล์แรกที่ matched · ปีต่างกันให้ชื่อต่างกัน → ใช้ปีล่าสุด + จดใน crossSourceConflicts
 */
export function mergeSellerIndexes(newestFirst: { label: string; index: SellerIndex }[]): SellerIndex {
  const keys = new Set<string>();
  for (const s of newestFirst) for (const k of s.index.entries.keys()) keys.add(k);

  const entries = new Map<string, Entry>();
  const crossSourceConflicts = new Set<string>();
  for (const key of keys) {
    let chosen: Entry | null = null;
    let fallback: Entry | null = null;
    for (const s of newestFirst) {
      const e = s.index.entries.get(key);
      if (!e) continue;
      const r = resultOf(e);
      if (r.status !== "matched") {
        fallback ??= e;
        continue;
      }
      if (!chosen) {
        chosen = { seller: { ...r.seller, source: s.label }, conflict: false, noSellerColumn: false };
      } else if (sellerKey(r.seller.name) !== sellerKey(chosen.seller!.name)) {
        crossSourceConflicts.add(key);
      }
    }
    entries.set(key, chosen ?? fallback!);
  }

  const prefixed = (pick: (i: SellerIndex) => string[]) =>
    newestFirst.flatMap((s) => pick(s.index).map((n) => `${s.label}:${n}`));
  return {
    entries,
    contracts: entries.size,
    sheetsRead: prefixed((i) => i.sheetsRead),
    sheetsWithoutSeller: prefixed((i) => i.sheetsWithoutSeller),
    sheetsSkipped: prefixed((i) => i.sheetsSkipped),
    crossSourceConflicts,
  };
}

/** ค้นผู้ขายของเลขที่สัญญา (ล้างเลขก่อนค้น) */
export function lookupSeller(index: SellerIndex, contractNo: string): SellerLookupResult {
  return resultOf(index.entries.get(normalizeContractNo(contractNo ?? "").value));
}
