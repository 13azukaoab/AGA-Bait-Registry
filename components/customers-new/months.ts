/**
 * เดือนเปิดงาน (ตัวเลือกเดือนของหน้าเปิดงาน)
 *
 * Logic summary:
 *   * รูปแบบภายใน 'YYYY-MM' (ค.ศ.) · ป้ายแสดงเป็นเดือนไทย + ปี ค.ศ. ตาม mockup ("ตุลาคม 2026")
 *   * ช่วงที่เลือกได้ = ย้อนหลัง 24 เดือนถึงเดือนหน้า นับจากเดือนปัจจุบันเขตเวลา Asia/Bangkok
 *   * ค่า `?month=` ที่ไม่ใช่รูปแบบ/อยู่นอกช่วง ใช้เดือนปัจจุบันแทน (กันค่าแปลกจาก URL)
 */

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

/** 'YYYY-MM' → "ตุลาคม 2026" */
export function monthLabel(month: string): string {
  const name = THAI_MONTHS[Number(month.slice(5, 7)) - 1];
  return `${name ?? month} ${month.slice(0, 4)}`;
}

/** เดือนปัจจุบันของประเทศไทย 'YYYY-MM' (ไม่พึ่งเขตเวลาของเครื่อง/เซิร์ฟเวอร์) */
export function currentBangkokMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

function shiftMonth(month: string, delta: number): string {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** ตัวเลือกเดือน ใหม่→เก่า: เดือนหน้า, เดือนนี้, ย้อนหลัง 24 เดือน */
export function monthChoices(current: string): string[] {
  const out: string[] = [];
  for (let d = 1; d >= -24; d--) out.push(shiftMonth(current, d));
  return out;
}

/** ตรวจค่า month จาก URL — ไม่ถูกต้อง/นอกช่วง = เดือนปัจจุบัน */
export function resolveMonth(raw: string | undefined, current: string): string {
  if (!raw || !isMonthKey(raw)) return current;
  return monthChoices(current).includes(raw) ? raw : current;
}

/** ช่วงวันของเดือน: เริ่ม (รวม) และเริ่มของเดือนถัดไป (ไม่รวม) เป็น 'YYYY-MM-DD' */
export function monthRange(month: string): { from: string; toExclusive: string } {
  return { from: `${month}-01`, toExclusive: `${shiftMonth(month, 1)}-01` };
}
