/**
 * อ่าน `contracts.term_months` จากฐานข้อมูลให้เป็นตัวเลขที่ใช้ได้ (M30)
 *
 * Logic summary:
 *   * DB บังคับ NOT NULL + CHECK 1–36 อยู่แล้ว → ค่าผิดรูปแบบ = ข้อมูลเสีย/โค้ดอ่านคอลัมน์ผิด
 *   * ห้าม fallback เป็น 12 เงียบๆ (เคยทำแบบ `term_years === 3 ? 3 : 1`) — สัญญา Custom 5 เดือนจะถูกอ่านเป็น 12 เดือน
 *     แล้วบันทึกทับ/คำนวณ Tier ผิด · ให้ throw เพื่อให้เห็นปัญหาทันที
 *   * สูตรทั้งหมดอยู่ใน `lib/rules` — ไฟล์นี้แค่ตรวจค่าที่อ่านมา
 */
import { isValidTermMonths } from "@/lib/rules";

export function termMonthsOf(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !isValidTermMonths(n)) {
    throw new Error(`term_months ไม่ถูกต้อง (ต้องเป็นจำนวนเต็ม 1–36): ${String(raw)}`);
  }
  return n;
}
