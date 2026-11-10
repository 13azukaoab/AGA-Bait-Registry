import type { TermYears } from "../rules/types";

/**
 * ชนิดข้อมูลสำหรับ "นำเข้าจาก Excel" (SPEC หน้าจอ 7 / §10, §11)
 * ไฟล์ต้นทาง = ชีท "เปิดงาน" ของ Admin ซึ่งรวมข้อมูลสัญญา + การเข้าบริการครั้งแรกไว้แถวเดียว
 */

/** ลำดับคอลัมน์ต้นฉบับ (ตรงกับ mockup IMPCOL) — ใช้ทั้งตอนรับ string[][] และ map header ของ object */
export const SOURCE_COLUMNS = [
  "ลำดับ",
  "เลขที่สัญญา",
  "รายชื่อ",
  "เบิกด่วน",
  "New",
  "Renew",
  "ผู้ขาย",
  "ตำแหน่ง",
  "สาขา",
  "เขต",
  "วันที่รับ Mail",
  "วันที่บริการ",
  "เวลาบริการ",
  "ทีม",
  "ประเภท",
  "เริ่ม",
  "สิ้นสุด",
  "1 ปี",
  "3 ปี",
  "หมายเหตุ",
] as const;

export type SourceColumn = (typeof SOURCE_COLUMNS)[number];

/** index ของคอลัมน์สำคัญใน SOURCE_COLUMNS (ให้โค้ดอ่านง่าย ไม่ใช้ตัวเลขดิบ) */
export const COL = {
  seq: 0,
  contractNo: 1,
  name: 2,
  urgent: 3,
  isNew: 4,
  isRenew: 5,
  seller: 6,
  position: 7,
  branch: 8,
  zone: 9,
  mailDate: 10,
  serviceDate: 11,
  serviceTime: 12,
  team: 13,
  customerType: 14,
  startDate: 15,
  endDate: 16,
  value1y: 17,
  value3y: 18,
  note: 19,
} as const;

/** input 1 แถว: array ตามลำดับ SOURCE_COLUMNS หรือ object ที่ key เป็นชื่อหัวคอลัมน์ไทย */
export type RawRow = string[] | Record<string, string>;

export type Division = "central" | "province";
export type SaleType = "new" | "renew";

/** แถวที่ล้าง+ตรวจแล้ว พร้อมบันทึกเข้าทะเบียน */
export interface CleanedRow {
  /** ลำดับแถวในชุดข้อมูลที่วางมา (เริ่มที่ 1) */
  rowIndex: number;
  contractNo: string;
  customerName: string;
  seller: string;
  saleType: SaleType | null;
  urgent: boolean;
  branch: string;
  zone: string | null;
  division: Division | null;
  customerType: string;
  teams: string[];
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD'
  termYears: TermYears;
  valueTotal: number;
  serviceDate: string | null; // 'YYYY-MM-DD' (null = ยังไม่นัด)
  serviceTime: string | null; // 'HH:mm'
  note: string;
  /** สิ่งที่ระบบแก้ให้อัตโนมัติ — บอกทุกครั้งว่าแก้อะไร ห้ามแก้เงียบ */
  fixes: string[];
  /** เตือน (นำเข้าได้ แต่ควรดู เช่น วันบริการก่อนวันเริ่ม) */
  warnings: string[];
}

/** แถวที่ต้องแก้เอง — ไม่นำเข้า */
export interface MustFixRow {
  rowIndex: number;
  contractNo: string | null;
  customerName: string;
  errors: string[];
  fixes: string[];
  warnings: string[];
}

/** แถวที่ไม่ใช่สัญญา — ข้าม */
export interface SkippedRow {
  rowIndex: number;
  reason: string;
}

export interface ImportResult {
  ready: CleanedRow[];
  mustFix: MustFixRow[];
  skipped: SkippedRow[];
  summary: {
    total: number;
    ready: number;
    mustFix: number;
    skipped: number;
    /** จำนวนแถว (ในกลุ่มพร้อมนำเข้า) ที่มีการแก้ให้อัตโนมัติอย่างน้อย 1 รายการ */
    autoFixedRows: number;
  };
}

export interface ImportOptions {
  /** เดือนที่กำลังกรอก ('YYYY-MM') — ถ้าระบุ จะเตือนเมื่อวันบริการอยู่นอกเดือนนี้ */
  entryMonth?: string;
}
