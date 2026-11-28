/**
 * ตรรกะ pure ของ "เรียงตารางผู้ใช้" + "ไม่ได้เข้าใช้มากี่วัน" (หน้า `/admin/users`)
 * mockup ที่อนุมัติ: `docs/mockup/admin-users-table.html` (DECISIONS 2.114)
 *
 * Logic summary:
 *   * เรียงได้ 6 คอลัมน์: ชื่อ · รหัสพนักงาน · ตำแหน่ง · สถานะ · เข้าใช้ล่าสุด · ไม่ได้เข้าใช้มา (วัน)
 *     - ทิศแรกเมื่อกดหัวคอลัมน์: ข้อความ/ตำแหน่ง/สถานะ = เรียงขึ้นก่อน · วันที่/จำนวนวัน = ล่าสุด/นานสุดก่อน
 *     - ค่าเท่ากัน → เรียงตามชื่อเสมอ (ไม่กลับทิศตามที่เลือก) · ค่าเริ่มต้น = ตำแหน่ง แล้วชื่อ
 *   * ตำแหน่งเรียงตาม "ลำดับงาน" (POSITION_ORDER) ไม่ใช่ตามตัวอักษร · ตำแหน่งที่ไม่รู้จักไปท้ายสุด
 *   * "ยังไม่เคยเข้า" นับเป็นนานสุด: ไม่ได้เข้า = ∞ วัน · เข้าล่าสุด = −∞ (เก่าสุด)
 *   * จำนวนวันนับตาม "วันตามปฏิทิน Asia/Bangkok" ไม่ใช่ (ชั่วโมง ÷ 24)
 *     เช่น เข้า 23:30 เมื่อวาน แล้วตอนนี้ 00:10 วันนี้ = 1 วัน
 *   * ระดับเตือน: ≥ 30 วัน = warn · ≥ 90 วัน = bad · บัญชีปิดใช้งานไม่เตือน · ยังไม่เคยเข้า = ไม่เตือน
 *     (mockup เตือนจาก "วันเปิดบัญชี" แต่ฟิลด์นี้ยังไม่มีใน DB — ทำตอนฐานข้อมูลเพิ่มฟิลด์หลัง go-live)
 */
import { nameOf, type UserRow } from "./userLogic";

/** เกณฑ์เตือน (วัน) — จุดเดียวที่แก้ได้ (ยังไม่ทำเป็นค่าตั้งค่า) */
export const IDLE_WARN_DAYS = 30;
export const IDLE_BAD_DAYS = 90;

/** ลำดับตำแหน่งตอนเรียง: เจ้าของ → PM → OM → แอดมิน → หัวหน้างาน (ใช้ `positions.code` จริงในระบบ) */
export const POSITION_ORDER: readonly string[] = ["owner", "pm", "om", "job_admin", "supervisor"];

export type SortKey = "name" | "username" | "position" | "status" | "lastLogin" | "idleDays";
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir };

export type SortColumn = {
  key: SortKey;
  label: string;
  /** ทิศที่ได้เมื่อกดหัวคอลัมน์ครั้งแรก */
  first: SortDir;
  /** ข้อความบนปุ่มสลับทิศ (มือถือ) */
  ascLabel: string;
  descLabel: string;
};

const DEFAULT_COLUMN: SortColumn = { key: "name", label: "ชื่อ-นามสกุล", first: "asc", ascLabel: "ก → ฮ", descLabel: "ฮ → ก" };

export const SORT_COLUMNS: readonly SortColumn[] = [
  { key: "name", label: "ชื่อ-นามสกุล", first: "asc", ascLabel: "ก → ฮ", descLabel: "ฮ → ก" },
  { key: "username", label: "รหัสพนักงาน", first: "asc", ascLabel: "น้อย → มาก", descLabel: "มาก → น้อย" },
  { key: "position", label: "ตำแหน่ง", first: "asc", ascLabel: "ตามลำดับงาน", descLabel: "ย้อนลำดับงาน" },
  { key: "status", label: "สถานะ", first: "asc", ascLabel: "ใช้งานก่อน", descLabel: "ปิดบัญชีก่อน" },
  { key: "lastLogin", label: "เข้าใช้ล่าสุด", first: "desc", ascLabel: "เก่า → ใหม่", descLabel: "ใหม่ → เก่า" },
  { key: "idleDays", label: "ไม่ได้เข้าใช้มา (วัน)", first: "desc", ascLabel: "น้อย → มาก", descLabel: "มาก → น้อย" },
];

export const DEFAULT_SORT: SortState = { key: "position", dir: "asc" };

export function columnOf(key: SortKey): SortColumn {
  return SORT_COLUMNS.find((c) => c.key === key) ?? DEFAULT_COLUMN;
}

/** กดหัวคอลัมน์: คอลัมน์เดิม = สลับทิศ · คอลัมน์ใหม่ = ทิศแรกของคอลัมน์นั้น */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: columnOf(key).first };
}

/** เลือกคอลัมน์จาก select (มือถือ): เริ่มที่ทิศแรกของคอลัมน์ */
export function selectSortKey(key: SortKey): SortState {
  return { key, dir: columnOf(key).first };
}

export function toggleDir(current: SortState): SortState {
  return { key: current.key, dir: current.dir === "asc" ? "desc" : "asc" };
}

/** ข้อความประกาศให้ screen reader หลังเรียง */
export function sortAnnouncement(s: SortState): string {
  const c = columnOf(s.key);
  return `เรียงตาม ${c.label} · ${s.dir === "asc" ? c.ascLabel : c.descLabel}`;
}

// ---------------------------------------------------------------------------
// วันตามปฏิทินไทย
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const BANGKOK_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** เลขวัน (นับจาก epoch) ของวันตามปฏิทินไทย · ค่าไม่ถูกต้อง = null */
function bangkokDayNumber(date: Date): number | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = BANGKOK_YMD.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/**
 * จำนวนวันตามปฏิทิน (เวลาไทย) ตั้งแต่เข้าใช้ล่าสุด · ยังไม่เคยเข้า/วันที่เสีย = null
 * เวลาในอนาคต (นาฬิกาเครื่องเพี้ยน) ปัดเป็น 0
 */
export function idleDays(lastLogin: string | null, now: Date = new Date()): number | null {
  if (!lastLogin) return null;
  const last = bangkokDayNumber(new Date(lastLogin));
  const today = bangkokDayNumber(now);
  if (last === null || today === null) return null;
  return Math.max(0, today - last);
}

export type IdleLevel = "none" | "warn" | "bad";

/** ระดับเตือน (ดูหัวไฟล์) */
export function idleLevel(u: Pick<UserRow, "isActive" | "lastLogin">, now: Date = new Date()): IdleLevel {
  if (!u.isActive) return "none";
  const days = idleDays(u.lastLogin, now);
  if (days === null) return "none";
  if (days >= IDLE_BAD_DAYS) return "bad";
  if (days >= IDLE_WARN_DAYS) return "warn";
  return "none";
}

// ---------------------------------------------------------------------------
// เรียง
// ---------------------------------------------------------------------------

/** ลำดับตำแหน่ง · ไม่รู้จัก/ไม่มีตำแหน่ง = ท้ายสุด */
export function positionRank(code: string | null): number {
  const i = code === null ? -1 : POSITION_ORDER.indexOf(code);
  return i === -1 ? POSITION_ORDER.length : i;
}

function lastLoginTime(u: UserRow): number {
  if (!u.lastLogin) return Number.NEGATIVE_INFINITY; // ยังไม่เคยเข้า = เก่าสุด
  const t = new Date(u.lastLogin).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function textCompare(a: string, b: string): number {
  return a.localeCompare(b, "th");
}

/** เทียบเลขโดยไม่ใช้การลบ (ให้ Infinity เท่ากับ Infinity ได้) */
function numCompare(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareByKey(a: UserRow, b: UserRow, key: SortKey, now: Date): number {
  switch (key) {
    case "name":
      return textCompare(nameOf(a), nameOf(b));
    case "username":
      return textCompare(a.username, b.username);
    case "position":
      return numCompare(positionRank(a.positionCode), positionRank(b.positionCode));
    case "status":
      return numCompare(a.isActive ? 0 : 1, b.isActive ? 0 : 1);
    case "lastLogin":
      return numCompare(lastLoginTime(a), lastLoginTime(b));
    case "idleDays":
      return numCompare(idleDays(a.lastLogin, now) ?? Infinity, idleDays(b.lastLogin, now) ?? Infinity);
  }
}

/** เรียงสำเนาของรายการ (ไม่แก้ array เดิม) · เท่ากัน → ตามชื่อ (ทิศขึ้นเสมอ) */
export function sortUsers(users: readonly UserRow[], sort: SortState, now: Date = new Date()): UserRow[] {
  const m = sort.dir === "asc" ? 1 : -1;
  return users.slice().sort((a, b) => {
    const c = compareByKey(a, b, sort.key, now) * m;
    if (c !== 0) return c;
    return textCompare(nameOf(a), nameOf(b)) || textCompare(a.username, b.username);
  });
}
