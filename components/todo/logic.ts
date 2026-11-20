/**
 * ตรรกะล้วน (pure function) ของหน้า "สถานะทะเบียนบริการ" (/todo) — แยกจาก UI/DB เพื่อเทสได้
 *
 * Logic summary:
 *   * เดือนของหน้า = เดือนที่ยังไม่ปิดเก่าสุดของ "ส่วนกลาง" (oldest_open_month · เฟส 1 ใช้ central) · ไม่มีแถวส่วนกลาง → ใช้เดือนเก่าสุดของแถวที่มี
 *   * ความคืบหน้า = จำนวนสัญญาที่มีบริการประจำเดือน (routine) ในเดือนนั้น / สัญญาที่ครอบเดือนนั้น (ตัวเลขชุดเดียวกับหน้า /service)
 *   * ตกบริการ: สูตร "ตก/เดือนบริการ/เพดานชดเชย" อยู่ที่ฐานข้อมูล (list_pending_missed_services · past_deadline) — ที่นี่แค่จัดเรียง/ตัดสินว่าปุ่มไหนกดได้
 *       - ปุ่ม "บันทึกบริการชดเชย": เลยเพดาน (past_deadline) หัวหน้างาน (recorder) กดไม่ได้ · Host กดได้ (ป้าย "เกินเพดาน")
 *       - เมื่อเลยเพดาน หัวหน้างานเหลือ "ไม่ชดเชย" เป็นปุ่มหลัก
 *   * หลักฐานของ "ไม่ชดเชย": ไฟล์ PDF/PNG/JPG ไม่เกิน 5 MB · path = `<contract_id>/<uuid>.<นามสกุล>` (ตรงกฎของ bucket missed-service-evidence)
 */
import type { UserRole } from "@/lib/db/types";

import { isContractEnded } from "./contractEnd";
import { describeServiceError, type DbErrorLike, type ServiceError } from "@/components/service/errors";

// ───────────────────────── เดือนของหน้า ─────────────────────────

export type ClosureScope = "central" | "province";

export interface OldestOpenRow {
  scope: ClosureScope;
  /** 'YYYY-MM' */
  month: string;
  isBehind: boolean;
}

/** เลือกแถวที่ใช้แสดง: ส่วนกลางก่อน · ไม่มี → เก่าสุด · ไม่มีเลย → null */
export function pickPageScope(rows: readonly OldestOpenRow[]): OldestOpenRow | null {
  const central = rows.find((r) => r.scope === "central");
  if (central) return central;
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))[0] ?? null;
}

/** 'YYYY-MM-DD' (หรือ 'YYYY-MM') → 'YYYY-MM' */
export function toMonthKey(value: string): string {
  return value.slice(0, 7);
}

// ───────────────────────── ความคืบหน้า ─────────────────────────

export interface ProgressItem {
  routineCountInMonth: number;
}

export interface Progress {
  total: number;
  filled: number;
  remaining: number;
  /** ปัดเป็นจำนวนเต็ม 0–100 (ไม่มีสัญญา = 0) */
  percent: number;
}

export function computeProgress(items: readonly ProgressItem[]): Progress {
  const total = items.length;
  const filled = items.filter((i) => i.routineCountInMonth > 0).length;
  return {
    total,
    filled,
    remaining: total - filled,
    percent: total === 0 ? 0 : Math.round((filled * 100) / total),
  };
}

// ───────────────────────── ตกบริการ ─────────────────────────

export interface PendingMissed {
  contractId: string;
  /** id ลูกค้า — ใช้ทำลิงก์ชื่อไปหน้ารายละเอียดลูกค้า (lib/links/customerLink.ts) · optional เพราะหน้ารายละเอียดลูกค้าใช้ชนิดนี้ด้วยและไม่ต้องมี */
  customerId?: string;
  customerName: string;
  branchName: string;
  /** ใช้ทำลิงก์ไปหน้าลงข้อมูลบริการ (zone/branch เท่านั้น ไม่พาข้อมูลลูกค้า) */
  branchId: string;
  zoneId: string;
  contractNo: string;
  /** 'YYYY-MM' เดือนที่ตก */
  missedMonth: string;
  /** 'YYYY-MM' เดือนบริการสุดท้ายของสัญญา */
  lastServiceMonth: string;
  /** 'YYYY-MM' เดือนสุดท้ายที่หัวหน้างานชดเชยได้ */
  deadlineMonth: string;
  pastDeadline: boolean;
}

export function sortPending<T extends { missedMonth: string; customerName: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    a.missedMonth !== b.missedMonth
      ? a.missedMonth < b.missedMonth
        ? -1
        : 1
      : a.customerName.localeCompare(b.customerName, "th"),
  );
}

export interface MissedActionState {
  /** ปุ่ม "ไม่ชดเชย" กดได้ไหม */
  waiveEnabled: boolean;
  /** ปุ่ม "บันทึกบริการชดเชย" กดได้ไหม */
  recordEnabled: boolean;
  /** ปุ่มหลัก (สีเข้ม) คือปุ่มไหน */
  primary: "record" | "waive";
  /** ต่อท้ายปุ่มชดเชยว่า "(เกินเพดาน)" (Host ทำกรณีพิเศษ) */
  recordOverCapSuffix: boolean;
}

/** สิทธิ์กดปุ่มของ 1 แถวรอตัดสิน — สิทธิ์จริงบังคับที่ฐานข้อมูล (RLS/RPC) · ที่นี่แค่ปิดปุ่มให้ตรง */
export function missedActionState(role: UserRole, pastDeadline: boolean): MissedActionState {
  const canDecide = role === "host" || role === "recorder";
  const isHost = role === "host";
  const recordEnabled = canDecide && (!pastDeadline || isHost);
  return {
    waiveEnabled: canDecide,
    recordEnabled,
    primary: pastDeadline && !isHost ? "waive" : "record",
    recordOverCapSuffix: pastDeadline && isHost,
  };
}

export type ClosedKind = "waived" | "makeup";

export interface ClosedMissed {
  contractId: string;
  customerId?: string;
  customerName: string;
  branchName: string;
  contractNo: string;
  missedMonth: string;
  kind: ClosedKind;
  reason: string | null;
  /** 'YYYY-MM-DD' วันที่ตัดสิน (เวลาไทย) */
  decidedOn: string | null;
}

/** เรื่องที่ปิดแล้ว: เดือนที่ตกใหม่→เก่า · ตามด้วยชื่อ */
export function sortClosed<T extends { missedMonth: string; customerName: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    a.missedMonth !== b.missedMonth
      ? a.missedMonth < b.missedMonth
        ? 1
        : -1
      : a.customerName.localeCompare(b.customerName, "th"),
  );
}

// ───────────────────────── ไม่ชดเชย: เหตุผล + หลักฐาน ─────────────────────────

export const REASON_MAX = 300;
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
const EVIDENCE_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

/** ตรวจเหตุผล → ข้อความผิดพลาด หรือ null ถ้าผ่าน */
export function validateReason(reason: string): string | null {
  const t = reason.trim();
  if (t === "") return "กรุณาพิมพ์เหตุผลที่ไม่ชดเชย";
  if (t.length > REASON_MAX) return `เหตุผลยาวเกิน ${REASON_MAX} ตัวอักษร`;
  return null;
}

export interface EvidenceFileLike {
  type: string;
  size: number;
}

/** ตรวจไฟล์หลักฐาน (ไม่บังคับ) → ข้อความผิดพลาด หรือ null */
export function validateEvidenceFile(file: EvidenceFileLike): string | null {
  if (!(file.type in EVIDENCE_EXT)) return "แนบได้เฉพาะไฟล์ PDF, PNG หรือ JPG";
  if (file.size <= 0) return "ไฟล์ว่างเปล่า";
  if (file.size > EVIDENCE_MAX_BYTES) return "ไฟล์ใหญ่เกิน 5 MB";
  return null;
}

/** path ใน bucket: `<contract_id>/<uuid>.<นามสกุล>` — ไม่ใช้ชื่อไฟล์เดิม (กันอักขระ/ `/` แปลก) */
export function buildEvidencePath(contractId: string, uniqueId: string, mime: string): string | null {
  const ext = EVIDENCE_EXT[mime];
  return ext ? `${contractId}/${uniqueId}.${ext}` : null;
}

// ───────────────────────── แปล error ─────────────────────────

const TODO_ERRORS: Record<string, string> = {
  MS001: "เดือนนี้ไม่อยู่ในรายการเดือนที่ตกบริการของสัญญา (อาจมีคนแก้ไปแล้ว) รีเฟรชหน้า",
  MS002: "เดือนนี้มีบริการประจำเดือนแล้ว ไม่ได้ตกบริการ — รีเฟรชหน้า",
  MS004: "ต้องพิมพ์เหตุผลที่ไม่ชดเชย",
  MS005: "เดือนนี้ชดเชยแล้ว — รีเฟรชหน้า",
  MS007: "ไม่พบไฟล์หลักฐานที่แนบ ลองแนบใหม่ หรือบันทึกโดยไม่แนบไฟล์",
  MS008: "เลยเพดานเวลาชดเชยแล้ว — หัวหน้างานบันทึกชดเชยไม่ได้ ให้ Host ทำ หรือกด “ไม่ชดเชย”",
  MS009: "สัญญานี้ถูกยกเลิกแล้ว ไม่ต้องตัดสินเรื่องตกบริการ — รีเฟรชหน้า",
  MS010: "เดือนนี้ถูกบันทึกเป็น “ไม่ชดเชย” ไปแล้ว — รีเฟรชหน้า",
  MS011: "สัญญานี้ต่อสัญญาแล้ว เรื่องตกบริการที่ค้างเป็นโมฆะโดยอัตโนมัติ — รีเฟรชหน้า",
  MS012: "เรื่องนี้ไม่ได้อยู่ในสถานะ “ไม่ชดเชย” (อาจเปิดกลับไปแล้ว) — รีเฟรชหน้า",
  AG004: "ไม่พบสัญญานี้ (อาจถูกลบไปแล้ว) รีเฟรชหน้า",
  "22001": "ข้อความยาวเกินที่ระบบรับได้",
  "42501": "ไม่มีสิทธิ์ตัดสินเรื่องตกบริการของสัญญานี้ (เฉพาะหัวหน้างานในขอบเขตของตน และ Host)",
};

/** แปล error ของ resolve/reopen เป็นไทย — รหัสไม่รู้จักตกไปใช้ตัวแปลกลางของหน้า /service */
export function describeTodoError(error: DbErrorLike): ServiceError {
  const code = error.code ?? "";
  const known = TODO_ERRORS[code];
  if (known) return { message: known, isBug: false };
  return describeServiceError(error);
}

// ───────────────────────── ลูกค้ารอเก็บสถานี (การ์ดสรุป) ─────────────────────────

export interface CollectContractInput {
  customerId: string;
  /** IG ที่ยังค้างเก็บ (v_contract_ig_collection.remaining) */
  remaining: number;
  status: "active" | "paused" | "expired_pending_collection" | "closed" | "cancelled";
  /** วันจบสัญญา 'YYYY-MM-DD' (จาก lib/rules effectiveEndDate — ห้ามคำนวณเองในที่นี้) */
  endDate: string;
}

// นิยาม "สัญญาจบ" อยู่ที่ไฟล์กลาง contractEnd.ts (ใช้ร่วม /todo · หน้าลูกค้า · /bait) — re-export ให้ผู้เรียกเดิมใช้ต่อได้
export { isContractEnded } from "./contractEnd";

export interface CollectSummary {
  /** จำนวนลูกค้า (ไม่ซ้ำ) ที่ยังมี IG รอเก็บ */
  customers: number;
  /** จำนวน IG ที่ยังค้างเก็บ */
  stations: number;
}

export function summarizeCollect(rows: readonly CollectContractInput[], today: string): CollectSummary {
  const waiting = rows.filter((r) => r.remaining > 0 && isContractEnded(r, today));
  return {
    customers: new Set(waiting.map((r) => r.customerId)).size,
    stations: waiting.reduce((sum, r) => sum + r.remaining, 0),
  };
}
