/**
 * ตัดสินใจ "โหลดหน้าถัดไปต่อเองไหม" ของหน้าทะเบียนลูกค้า/สัญญา (pure function · ไม่แตะ React/DB)
 *
 * Logic summary:
 *   * ตัวกรองฝั่งหน้า (Tier "ขนาด" · สถานะ — ดู needsPostFilter) ฐานข้อมูลกรองให้ไม่ได้ จึงตรวจทีละหน้า
 *     → ถ้ามีตัวกรองพวกนี้ และยังมีหน้าต่อไป หน้าจะโหลดต่อเองทีละหน้า (ต่อกัน ไม่ยิงพร้อมกัน) จนตรวจครบ
 *   * เพดานกันวน: ตรวจเกิน `limit` แถว (ค่าเริ่ม AUTO_LOAD_CAP) → หยุด · ผู้ใช้กด "โหลดเพิ่ม" เองเพื่อไปต่อ (หน้าเลื่อนเพดานให้อีกรอบ)
 *   * error → หยุด ไม่วนยิงซ้ำ (ผู้ใช้กด "ลองใหม่")
 *   * ไม่มีตัวกรองฝั่งหน้า → ไม่โหลดต่อเอง (แบ่งหน้าแบบเดิม)
 */

/** ตรวจอัตโนมัติสูงสุดกี่แถว (ก่อนหยุดรอผู้ใช้กดต่อเอง) */
export const AUTO_LOAD_CAP = 10000;

export type AutoLoadStop = "done" | "no_post_filter" | "cap" | "error";
export type AutoLoadDecision = { continue: true } | { continue: false; reason: AutoLoadStop };

export interface AutoLoadState {
  /** มีตัวกรองที่ต้องกรองซ้ำฝั่งหน้า */
  post: boolean;
  /** มีหน้าต่อไปไหม */
  hasNext: boolean;
  /** จำนวนสัญญาที่ตรวจแล้ว */
  scanned: number;
  /** เพดานการตรวจอัตโนมัติ */
  limit: number;
  /** โหลดล้มเหลวล่าสุด */
  hasError: boolean;
}

export function decideAutoLoad(s: AutoLoadState): AutoLoadDecision {
  if (!s.post) return { continue: false, reason: "no_post_filter" };
  if (s.hasError) return { continue: false, reason: "error" };
  if (!s.hasNext) return { continue: false, reason: "done" };
  if (s.scanned >= s.limit) return { continue: false, reason: "cap" };
  return { continue: true };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** ข้อความความคืบหน้าระหว่างตรวจ (ภาษาไทย) */
export function progressText(scanned: number, dbTotal: number | null, found: number): string {
  const of = dbTotal !== null ? ` / ${fmt(dbTotal)}` : "";
  return `กำลังตรวจ ${fmt(scanned)}${of}… (พบ ${fmt(found)} รายการ)`;
}

/** ข้อความตอนหยุดเพราะถึงเพดาน */
export function capText(scanned: number, dbTotal: number | null): string {
  const of = dbTotal !== null ? ` จาก ${fmt(dbTotal)}` : "";
  return `หยุดตรวจอัตโนมัติที่ ${fmt(scanned)}${of} สัญญา (ถึงเพดานที่ตั้งไว้) — ยังตรวจไม่ครบ กด “โหลดเพิ่ม” เพื่อตรวจต่อ`;
}
