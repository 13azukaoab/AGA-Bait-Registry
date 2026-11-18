/**
 * ตรรกะล้วน (pure) ของหน้า "ส่งข้อมูล และสรุปงานประจำเดือน" (/admin/months · SPEC §7.7, §8.2, §9 · M39)
 *
 * Logic summary:
 *   * หน้าเว็บไม่ส่งตัวเลขใดๆ ให้ server — ส่งแค่ {month, scope, confirmKey, overrideReason?, acknowledgeCarried?}
 *   * สถานะเดือนต่อส่วน (ส่วนกลาง/ต่างจังหวัด): progress (ยังไม่จบเดือน) · open (รอปิด) · closed — ต่อจาก list_month_closures
 *   * สิทธิ์ที่ใช้ซ่อนปุ่ม: ปิดส่วนกลาง/ต่างจังหวัด ตามผล RPC can_close_month_part · คำนวณใหม่/ปิดข้าม = host เท่านั้น
 *     (ซ่อนปุ่มเฉยๆ — server + DB ตรวจซ้ำทุกครั้ง)
 *   * "ส่วนกลางพร้อม" ตัดสินที่ server เท่านั้น (409 branches_not_ready) — ที่นี่ไม่คำนวณซ้ำ
 *   * ข้อความ error แปลงจาก errorCode ของ route เป็นภาษาไทยทุกตัว ไม่แสดงข้อความดิบจาก DB
 */
import type { MonthCloseErrorCode } from "@/lib/dashboard/monthClose";
import { monthKey } from "@/lib/rules/monthKey";
import { shiftMonth } from "@/lib/service/months";

export type Scope = "central" | "province";
export type ScopeStatus = "progress" | "open" | "closed";

export const SCOPE_NAME: Record<Scope, string> = { central: "ส่วนกลาง", province: "ต่างจังหวัด" };
export const SCOPE_BRANCHES: Record<Scope, number> = { central: 24, province: 19 };

export interface ClosureRow {
  month_key: string;
  scope: Scope;
  closed_at: string;
  closed_by_name: string | null;
}

export interface ScopeState {
  status: ScopeStatus;
  closedAt: string | null;
  closedByName: string | null;
}

export interface MonthEntry {
  /** 'YYYY-MM' */
  month: string;
  /** 'OCT.26' */
  key: string;
  central: ScopeState;
  province: ScopeState;
  /** ปิดครบทั้ง 2 ส่วน = "อัพเดทข้อมูลครบทุกสาขา" */
  complete: boolean;
}

/** รายการเดือน (ใหม่ → เก่า) จากเดือน go-live ถึงเดือนปัจจุบัน (เวลาไทย) · ไม่รู้ go-live = ย้อนหลัง 6 เดือน */
export function buildMonthList(input: {
  currentMonth: string;
  goLiveMonth: string | null;
  closures: readonly ClosureRow[];
  maxMonths?: number;
}): MonthEntry[] {
  const max = input.maxMonths ?? 12;
  const floor = input.goLiveMonth ?? shiftMonth(input.currentMonth, -5);
  const out: MonthEntry[] = [];
  for (let m = input.currentMonth, i = 0; m >= floor && i < max; m = shiftMonth(m, -1), i++) {
    const ended = m < input.currentMonth;
    const state = (scope: Scope): ScopeState => {
      const row = input.closures.find((c) => c.month_key === m && c.scope === scope);
      if (row) return { status: "closed", closedAt: row.closed_at, closedByName: row.closed_by_name };
      return { status: ended ? "open" : "progress", closedAt: null, closedByName: null };
    };
    const central = state("central");
    const province = state("province");
    out.push({
      month: m,
      key: monthKey(m),
      central,
      province,
      complete: central.status === "closed" && province.status === "closed",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// สิทธิ์ (ใช้ซ่อนปุ่มเท่านั้น)
// ---------------------------------------------------------------------------

export interface Perms {
  isHost: boolean;
  /** ผล RPC can_close_month_part('central') */
  canCloseCentral: boolean;
  /** ผล RPC can_close_month_part('province') */
  canCloseProvince: boolean;
}

export function canCloseScope(p: Perms, scope: Scope): boolean {
  return scope === "central" ? p.canCloseCentral : p.canCloseProvince;
}
/** คำนวณ snapshot ใหม่ / ปิดข้ามด้วยเหตุผล = host เท่านั้น */
export function canResync(p: Perms): boolean {
  return p.isHost;
}
export function canOverrideReady(p: Perms): boolean {
  return p.isHost;
}

// ---------------------------------------------------------------------------
// ยืนยันปิดเดือน
// ---------------------------------------------------------------------------

/** key ที่ต้องพิมพ์ยืนยัน เช่น 'OCT.26' */
export function confirmKeyFor(month: string): string {
  return monthKey(month);
}
/** พิมพ์ตรงกับ key เดือน (ไม่สนตัวพิมพ์เล็ก/ใหญ่ และช่องว่างหัวท้าย) */
export function isConfirmKeyValid(typed: string, month: string): boolean {
  return typed.trim().toUpperCase() === confirmKeyFor(month);
}
/** เหตุผลปิดข้าม: 5–500 ตัว ไม่นับช่องว่างหัวท้าย (ตรงกับ server) */
export function isValidOverrideReason(reason: string): boolean {
  const n = reason.trim().length;
  return n >= 5 && n <= 500;
}

/** ตรวจก่อนกดปิด — คืนข้อความไทยของข้อที่ยังไม่ผ่าน หรือ null เมื่อพร้อมส่ง */
export function closeFormError(input: {
  month: string;
  typed: string;
  needAck: boolean;
  ack: boolean;
  needReason: boolean;
  reason: string;
}): string | null {
  if (input.needReason && !isValidOverrideReason(input.reason)) return "พิมพ์เหตุผลที่ปิดข้าม (5–500 ตัวอักษร)";
  if (input.needAck && !input.ack) return "ติ๊กรับทราบก่อนปิด";
  if (!isConfirmKeyValid(input.typed, input.month)) return `พิมพ์ ${confirmKeyFor(input.month)} ให้ตรงก่อน จึงจะปิดเดือนได้`;
  return null;
}

// ---------------------------------------------------------------------------
// error / ผลส่ง Dashboard → ข้อความไทย
// ---------------------------------------------------------------------------

export type ApiErrorCode = MonthCloseErrorCode | "bad_origin" | "unauthenticated" | "invalid_body" | "invalid_scope" | "confirm_key_mismatch" | "network";

export const ERROR_TEXT: Record<ApiErrorCode, string> = {
  invalid_month: "เดือนไม่ถูกต้อง",
  month_not_ended: "เดือนนี้ยังไม่จบ (เวลาไทย) ปิดไม่ได้",
  before_go_live: "เดือนนี้อยู่ก่อนเริ่มใช้ระบบ ไม่ต้องปิด",
  already_closed: "ส่วนนี้ของเดือนนี้ปิดไปแล้ว — ใช้ \"คำนวณ snapshot ใหม่\" แทน",
  invalid_rows: "ข้อมูลที่คำนวณได้ไม่ครบหรือไม่ถูกต้อง แจ้งผู้ดูแลระบบ",
  branches_not_ready: "ยังมีสาขาส่วนกลางที่บันทึกบริการเดือนนี้ไม่ครบ",
  invalid_reason: "เหตุผลต้องยาว 5–500 ตัวอักษร",
  non_computed_rows: "เดือนนี้มีตัวเลขแบบนำเข้า/กรอกมือ ระบบไม่เขียนทับ แจ้งผู้ดูแลระบบ",
  carried_not_acknowledged: "ยังมีสาขาต่างจังหวัดที่ใช้ค่ายกมา — ต้องติ๊กรับทราบก่อนปิด",
  not_closed: "ส่วนนี้ของเดือนนี้ยังไม่ปิด",
  invalid_closer: "ผู้ปิดต้องเป็นผู้ใช้ที่มีสิทธิ์ปิดส่วนนี้",
  invalid_closed_at: "เวลาปิดต้องอยู่หลังสิ้นเดือนนั้น และไม่เกินเวลาปัจจุบัน",
  stale_resync: "มีคนเพิ่งคำนวณ snapshot ใหม่ระหว่างรอ — กดอีกครั้ง",
  override_host_only: "ปิดข้ามด้วยเหตุผลได้เฉพาะ OM/PM",
  forbidden: "คุณไม่มีสิทธิ์ทำรายการนี้",
  load_failed: "อ่านข้อมูลจากระบบไม่สำเร็จ ลองใหม่อีกครั้ง",
  unknown: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง",
  bad_origin: "คำขอไม่ได้มาจากหน้าเว็บนี้ — รีเฟรชหน้าแล้วลองใหม่",
  unauthenticated: "หมดเวลาการเข้าสู่ระบบ — กรุณาเข้าสู่ระบบใหม่",
  invalid_body: "ข้อมูลที่ส่งไม่ถูกต้อง รีเฟรชหน้าแล้วลองใหม่",
  invalid_scope: "ส่วนที่เลือกไม่ถูกต้อง รีเฟรชหน้าแล้วลองใหม่",
  confirm_key_mismatch: "key เดือนที่พิมพ์ไม่ตรง",
  network: "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่ (ยังไม่มีการปิดเดือน)",
};

/** แปลง code เป็นข้อความไทย — code แปลกปลอม/ไม่รู้จัก = ข้อความกลาง (ไม่โชว์ข้อความดิบ) */
export function describeError(code: unknown): string {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(ERROR_TEXT, code)
    ? ERROR_TEXT[code as ApiErrorCode]
    : ERROR_TEXT.unknown;
}

export type SyncResult = "success" | "skipped" | "failed" | "busy" | "not_started";
export interface SyncLabel {
  tone: "ok" | "warn" | "danger";
  title: string;
  hint: string;
}

/** ผลส่ง Dashboard หลังปิด/คำนวณใหม่ — เดือนปิดแล้วเสมอ แม้ส่งไม่สำเร็จ */
export function syncLabel(result: unknown): SyncLabel {
  switch (result) {
    case "success":
      return { tone: "ok", title: "ส่ง Dashboard สำเร็จ", hint: "Netlify จะอัปเดตภายในประมาณ 30 วินาที" };
    case "skipped":
      return { tone: "ok", title: "ข้อมูลไม่เปลี่ยน ไม่ต้องส่ง Dashboard", hint: "Dashboard ตรงกับข้อมูลล่าสุดอยู่แล้ว" };
    case "busy":
      return { tone: "warn", title: "ยังไม่ได้ส่ง — มีรอบส่งอื่นกำลังทำงานอยู่", hint: "ระบบจะส่งให้ในรอบอัตโนมัติ 06:00 น. หรือให้ OM/PM กดส่งตอนนี้" };
    case "not_started":
      return { tone: "warn", title: "ปิดเดือนแล้ว แต่ยังไม่ได้ส่ง Dashboard", hint: "ระบบจะส่งให้ในรอบอัตโนมัติ 06:00 น. หรือให้ OM/PM กดส่งตอนนี้" };
    default:
      return { tone: "danger", title: "ส่ง Dashboard ไม่สำเร็จ", hint: "เดือนปิดแล้ว ระบบจะลองส่งใหม่ในรอบอัตโนมัติ 06:00 น. หรือให้ OM/PM กดส่งตอนนี้" };
  }
}

export interface SyncStatusRow {
  source: string;
  started_at: string;
  finished_at: string | null;
  result: string | null;
  error_code: string | null;
}

/** สรุปสถานะส่งล่าสุด: เวลาที่ส่งสำเร็จล่าสุด + รอบล่าสุดล้มเหลวหรือไม่ */
export function summarizeSync(rows: readonly SyncStatusRow[]): { lastSuccessAt: string | null; latestFailed: boolean } {
  let lastSuccessAt: string | null = null;
  let latest: SyncStatusRow | null = null;
  for (const r of rows) {
    if (r.result === "success" && r.finished_at && (!lastSuccessAt || r.finished_at > lastSuccessAt)) lastSuccessAt = r.finished_at;
    if (r.finished_at && (!latest || r.finished_at > (latest.finished_at ?? ""))) latest = r;
  }
  return { lastSuccessAt, latestFailed: latest?.result === "failed" };
}

// ---------------------------------------------------------------------------
// แก้หลังปิด (RPC list_post_close_edits ยังไม่มีบน main — ซ่อนไว้จนกว่า BE ส่ง)
// ---------------------------------------------------------------------------

export const POST_CLOSE_EDITS_AVAILABLE = false;

const TABLE_TH: Record<string, string> = { visits: "ผลบริการ", station_checks: "ผลตรวจสถานี" };
export function tableLabelTh(table: string): string {
  return TABLE_TH[table] ?? "ข้อมูลบริการ";
}

// ---------------------------------------------------------------------------
// ตกบริการรอตัดสิน (รายการทบทวน — ไม่ใช่เกณฑ์ "พร้อมปิด")
// ---------------------------------------------------------------------------

export interface MissedItem {
  contractId: string;
  branchId: string;
  contractNo: string;
  customerName: string;
}

/** นับต่อสาขา เรียงมาก → น้อย แล้วตามชื่อสาขา */
export function groupMissedByBranch(items: readonly MissedItem[], branchNames: ReadonlyMap<string, string>): { branchId: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.branchId, (counts.get(i.branchId) ?? 0) + 1);
  return [...counts.entries()]
    .map(([branchId, count]) => ({ branchId, name: branchNames.get(branchId) ?? "สาขาไม่ทราบชื่อ", count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th"));
}

/** ISO → 'dd/MM/yyyy HH:mm' เวลาไทย (ค่าว่าง/ผิดรูปแบบ = '—') */
export function formatBangkok(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}
