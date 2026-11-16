/**
 * เดือน/ทีมของหน้าที่กรอกตามเดือน — ของกลาง ใช้ร่วม /customers/new, /service, /bait
 * (ย้ายจาก components/service/months.ts + รวมกับ components/customers-new/months.ts ที่เหมือนกัน · ฝั่ง customers-new เหลือไฟล์ re-export)
 *
 * Logic summary: รูปแบบ 'YYYY-MM' (ค.ศ.) · ป้ายเป็นเดือนไทย + ปี ค.ศ. ("ตุลาคม 2026") · ช่วงเลือกได้ = เดือนหน้า ถึงย้อนหลัง 24 เดือน
 * · เดือนปัจจุบันอิง Asia/Bangkok (ไม่พึ่งเขตเวลาของเครื่อง/เซิร์ฟเวอร์) · ค่า `?month=` ผิดรูปแบบ/นอกช่วง ใช้เดือนปัจจุบัน
 * · `serviceTeams` = ทีมประเภท service ก่อน install (อ่านจาก `teams.kind` — ฐานข้อมูลรับเฉพาะสองประเภทนี้ SV006 · M22)
 */

import { canRecordService, sortTeamsByKind, type TeamKind } from "./teamKind";

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

export function shiftMonth(month: string, delta: number): string {
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

/**
 * ทีมที่เลือกบันทึกบริการได้ = ประเภท `service` / `install` (เรียงบริการก่อนติดตั้ง แล้วตามรหัส)
 * กรองทีมหัวหน้างาน (`supervisor` เช่น Sup) ออก เพราะฐานข้อมูลปฏิเสธ (SV006 · M22 เช็กจาก teams.kind ไม่ใช่รหัสทีม)
 */
export function serviceTeams<T extends { code: string; kind: TeamKind }>(teams: readonly T[]): T[] {
  return sortTeamsByKind(teams.filter((t) => canRecordService(t.kind)));
}
