/**
 * ล้างค่าช่อง "ที่อยู่ลูกค้า" ของทะเบียน → customers.address (DECISIONS 2.102 · SPEC §10) — pure function
 *
 * Logic summary (ล้างรูปแบบเท่านั้น **ไม่แก้/ไม่เดาเนื้อหา**):
 *   1. ข้อความ: ตัดช่องว่างหัวท้าย · ช่องว่างที่ติดกัน (รวมแท็บ / NBSP / ขึ้นบรรทัดใหม่ในเซลล์) → ช่องว่าง 1 ตัว
 *      (ที่อยู่ที่พิมพ์หลายบรรทัดในเซลล์เดียวจึงกลายเป็นบรรทัดเดียว) · ตัวสะกด เครื่องหมาย และ "-" คงเดิม
 *   2. ว่าง / มีแต่ช่องว่าง = NULL
 *   3. ตัวเลขของ Excel = เก็บเป็นข้อความตามค่า (นับ numeric แยกไว้รายงาน) · true/false = ไม่ใช่ที่อยู่ → NULL (นับ nonText)
 *   4. มีตัวอักษรควบคุม (เช่น \u0000 ที่ PostgreSQL text รับไม่ได้) = ไม่เก็บ (NULL) นับ controlChar ไว้รายงาน · ไม่ลบตัวอักษรเอง
 *   ⚠ ผลลัพธ์มีที่อยู่จริง (PDPA) — ห้าม log · รายงานใช้ summarizeAddresses (จำนวนเท่านั้น)
 */
import type { CellValue } from "./registrySheet";

export interface AddressCellResult {
  status: "empty" | "ok" | "numeric" | "nonText" | "controlChar";
  /** ค่าที่จะเขียนลง customers.address · null = ไม่มี */
  address: string | null;
}

export interface AddressSummary {
  rows: number;
  /** แถวที่จะมีที่อยู่ (ok + numeric) */
  withAddress: number;
  emptyRows: number;
  numericRows: number;
  nonTextRows: number;
  controlCharRows: number;
}

/** ตัวอักษรควบคุมที่เหลือหลังรวมช่องว่าง (แท็บ/ขึ้นบรรทัดถูกรวมเป็นช่องว่างไปแล้ว) */
const CONTROL_CHAR = /[\u0000-\u001F\u007F]/;

export function cleanAddress(v: CellValue | undefined): AddressCellResult {
  if (v === null || v === undefined) return { status: "empty", address: null };
  if (typeof v === "boolean") return { status: "nonText", address: null };
  const text = String(v).replace(/\s+/g, " ").trim();
  if (text === "") return { status: "empty", address: null };
  if (CONTROL_CHAR.test(text)) return { status: "controlChar", address: null };
  return { status: typeof v === "number" ? "numeric" : "ok", address: text };
}

export function summarizeAddresses(results: readonly AddressCellResult[]): AddressSummary {
  const count = (s: AddressCellResult["status"]) => results.filter((r) => r.status === s).length;
  return {
    rows: results.length,
    withAddress: results.filter((r) => r.address !== null).length,
    emptyRows: count("empty"),
    numericRows: count("numeric"),
    nonTextRows: count("nonText"),
    controlCharRows: count("controlChar"),
  };
}
