/**
 * ตัวช่วยเวลาเข้า–ออก (24 ชม.) ของฟอร์มทำบริการ — pure function (SPEC v1.8 §8.1)
 *
 * Logic summary:
 *   * พิมพ์เลขล้วนได้: "1445" → "14:45" (เก็บสูงสุด 4 หลัก · ไม่มี AM/PM)
 *   * รูปแบบถูกต้อง = HH:MM ชั่วโมง 00–23 นาที 00–59
 *   * เวลาออกต้อง "หลัง" เวลาเข้า (ยังไม่รองรับข้ามเที่ยงคืน — ฐานข้อมูลมี CHECK end_time > start_time)
 *   * เวลาจากฐานข้อมูลเป็น "HH:MM:SS" → ตัดเหลือ HH:MM
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** จัดรูปแบบตอนพิมพ์ ("1445" → "14:45", "9" → "9", "093" → "09:3") */
export function formatTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** "HH:MM" → นาทีนับจากเที่ยงคืน · รูปแบบผิด = null */
export function toMinutes(value: string): number | null {
  if (!isValidTime(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export type WorkTime =
  | { status: "empty" }
  | { status: "badFormat" }
  | { status: "notAfter" }
  | { status: "ok"; minutes: number };

/** เวลาทำงานจริง = ออก − เข้า */
export function workTime(timeIn: string, timeOut: string): WorkTime {
  if (!timeIn || !timeOut) return { status: "empty" };
  const a = toMinutes(timeIn);
  const b = toMinutes(timeOut);
  if (a === null || b === null) return { status: "badFormat" };
  if (b <= a) return { status: "notAfter" };
  return { status: "ok", minutes: b - a };
}

/** 125 → "2 ชม. 5 นาที" */
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}

/** "14:45:00" → "14:45" (ค่าจากคอลัมน์ time ของฐานข้อมูล) */
export function trimDbTime(value: string | null | undefined): string {
  return (value ?? "").slice(0, 5);
}
