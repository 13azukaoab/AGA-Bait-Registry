/**
 * เดือนของหน้ากรอกข้อมูลทำบริการ — คัดลอกจาก components/customers-new/months.ts (ไม่ import ข้าม เพราะ
 * หน้าเปิดงานมีคนแก้อยู่) · ผู้ดูแล: ถ้าจะใช้ร่วมกันถาวร ควรย้ายไป lib/ (แจ้ง FE)
 *
 * Logic summary: รูปแบบ 'YYYY-MM' (ค.ศ.) · ป้ายเป็นเดือนไทย + ปี ค.ศ. · ช่วงเลือกได้ = เดือนหน้า ถึงย้อนหลัง 24 เดือน
 * · เดือนปัจจุบันอิง Asia/Bangkok · ค่า `?month=` ผิดรูปแบบ/นอกช่วง ใช้เดือนปัจจุบัน
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

export function monthLabel(month: string): string {
  const name = THAI_MONTHS[Number(month.slice(5, 7)) - 1];
  return `${name ?? month} ${month.slice(0, 4)}`;
}

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

/** วันที่วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
export function todayBangkok(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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

export function resolveMonth(raw: string | undefined, current: string): string {
  if (!raw || !isMonthKey(raw)) return current;
  return monthChoices(current).includes(raw) ? raw : current;
}

/** ช่วงวันของเดือน: เริ่ม (รวม) และเริ่มของเดือนถัดไป (ไม่รวม) */
export function monthRange(month: string): { from: string; toExclusive: string } {
  return { from: `${month}-01`, toExclusive: `${shiftMonth(month, 1)}-01` };
}

/** ทีม A–O ก่อน แล้ว Z — กรองทีมอื่น (เช่น Sup) ออก เพราะฐานข้อมูลรับเฉพาะ A–O, Z (SV006) */
export function serviceTeams<T extends { code: string }>(teams: readonly T[]): T[] {
  const rank = (code: string) => (/^[A-O]$/.test(code) ? 0 : code === "Z" ? 1 : -1);
  return teams
    .filter((t) => rank(t.code) >= 0)
    .sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}
