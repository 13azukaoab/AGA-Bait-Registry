/**
 * โหมดบันทึกบริการชดเชย ของหน้า /service (DECISIONS 2.96) — pure function ล้วน (ทดสอบได้ตรงๆ)
 *
 * Logic summary:
 *   * ลิงก์จาก /todo และแท็บการเข้าในหน้าลูกค้า: `/service?contract=<uuid>&makeup=<YYYY-MM>` — มีแต่ id กับเดือน (PDPA: ไม่ใส่ชื่อ)
 *   * `parseMakeupParams` รับเฉพาะ "ทั้งสองค่าถูกรูปแบบ" · ค่าเดียว/ผิดรูปแบบ = ไม่ใช่โหมดชดเชย (หน้าทำงานแบบปกติ)
 *   * โหมดชดเชยบันทึกการเข้าเป็น routine ใหม่ในเดือนปัจจุบัน แล้วเรียก RPC `save_makeup_service_visit`
 *     (= payload ของ save_service_visit + `makeup_for_month` 'YYYY-MM-01' เดือนที่ตก) แทน `save_service_visit`
 *   * สิทธิ์: host ทำได้เสมอ (เลยเพดานเป็นกรณีพิเศษ) · recorder ทำได้เมื่อยังไม่เลยเพดาน (ตรงกับ missedActionState ใน todo/logic.ts)
 *     — ด่านจริงอยู่ที่ฐานข้อมูล (MS008) ที่นี่แค่กันก่อนเปิดฟอร์ม
 */
import type { UserRole } from "@/lib/db/types";

import type { SavePayload } from "./buildPayload";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface MakeupTarget {
  contractId: string;
  /** 'YYYY-MM' เดือนที่ตกบริการ */
  missedMonth: string;
}

/** อ่านค่าจาก query string · ต้องถูกรูปแบบทั้งคู่ถึงถือเป็นโหมดชดเชย */
export function parseMakeupParams(contract: string | null | undefined, makeup: string | null | undefined): MakeupTarget | null {
  if (!contract || !makeup) return null;
  if (!UUID_RE.test(contract) || !MONTH_RE.test(makeup)) return null;
  return { contractId: contract.toLowerCase(), missedMonth: makeup };
}

/** URL ไปโหมดชดเชย · id ไม่ใช่ uuid / เดือนผิดรูปแบบ → null (ผู้เรียกแสดงเป็นข้อความธรรมดา) */
export function makeupHref(contractId: string | null | undefined, missedMonth: string | null | undefined): string | null {
  const t = parseMakeupParams(contractId, missedMonth);
  if (!t) return null;
  const qs = new URLSearchParams({ contract: t.contractId, makeup: t.missedMonth });
  return `/service?${qs.toString()}`;
}

/** 'YYYY-MM' → 'YYYY-MM-01' (รูปแบบที่ RPC รับ) */
export function makeupMonthDate(missedMonth: string): string {
  return `${missedMonth}-01`;
}

/** payload ของ save_makeup_service_visit = payload เดิม + makeup_for_month (key บังคับ) */
export function buildMakeupPayload(payload: SavePayload, missedMonth: string): SavePayload & { makeup_for_month: string } {
  return { ...payload, makeup_for_month: makeupMonthDate(missedMonth) };
}

/** ผู้ใช้ตำแหน่งนี้บันทึกชดเชยได้ไหม (กันก่อนเปิดฟอร์ม · ของจริงบังคับที่ DB) */
export function canRecordMakeup(role: UserRole, pastDeadline: boolean): boolean {
  if (role === "host") return true;
  if (role === "recorder") return !pastDeadline;
  return false;
}

/** เหตุที่เปิดโหมดชดเชยไม่ได้ (ใช้เลือกข้อความบนหน้า) */
export type MakeupBlockReason = "not_found" | "not_pending" | "past_deadline" | "forbidden" | "load_error";

export const MAKEUP_BLOCK_MESSAGE: Record<MakeupBlockReason, { title: string; body: string }> = {
  not_found: { title: "ไม่พบสัญญานี้", body: "ลิงก์อาจผิด หรือสัญญาถูกลบ/ไม่อยู่ในสิทธิ์ของบัญชีนี้ — กลับไปเลือกจากหน้า “สถานะทะเบียนบริการ”" },
  not_pending: {
    title: "เดือนนี้ไม่อยู่ในรายการตกบริการค้างแล้ว",
    body: "อาจชดเชยไปแล้ว ถูกบันทึกเป็น “ไม่ชดเชย” สัญญายกเลิก หรือต่อสัญญาแล้ว — กลับไปดูรายการล่าสุดที่หน้า “สถานะทะเบียนบริการ”",
  },
  past_deadline: {
    title: "เลยเพดานเวลาชดเชยแล้ว",
    body: "หัวหน้างานบันทึกบริการชดเชยไม่ได้ ให้ Host บันทึก หรือกด “ไม่ชดเชย” เพื่อปิดเรื่องที่หน้า “สถานะทะเบียนบริการ”",
  },
  forbidden: { title: "ไม่มีสิทธิ์บันทึกบริการชดเชย", body: "เฉพาะ Host และหัวหน้างานเท่านั้น" },
  load_error: { title: "อ่านข้อมูลไม่สำเร็จ", body: "ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ" },
};
