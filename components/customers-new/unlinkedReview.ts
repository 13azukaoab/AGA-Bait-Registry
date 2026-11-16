/**
 * ตรวจ Renew ที่ยังไม่ผูกสัญญาเก่า (M28b · mockup FINAL `docs/mockup/admin-add-customer.html` กล่อง "เชื่อมสัญญาเก่า")
 *
 * Logic summary:
 *   * แถวที่บันทึกแล้วเป็น Renew + ไม่ผูกสัญญาเก่า → host / admin เปิดกล่องตรวจได้ (`canReviewUnlinked`)
 *     ซ่อน/แสดงปุ่มตาม role เท่านั้น — สิทธิ์จริง (admin ในขอบเขตสาขา) DB ตัดสินด้วย 42501
 *   * เชื่อมสัญญาเก่า → RPC `link_renewal_contract(p_contract_id, p_renewed_from_contract_id)`
 *   * ปิดรายการ "ไม่มีสัญญาเก่าในระบบ" → RPC `close_unlinked_renewal(p_contract_id, p_note)` (หมายเหตุไม่บังคับ)
 *     ปิดแล้วยังเชื่อมสัญญาเก่าทีหลังได้ (DB ล้างสถานะปิดให้เอง)
 *   * หมายเหตุอาจถูกหัวหน้างานอ่านได้ → หน้าจอเตือนห้ามใส่ข้อมูลส่วนตัวลูกค้า · ห้าม log หมายเหตุ (ไฟล์นี้ไม่ log อะไรเลย)
 *   * ฟังก์ชัน pure (`canReviewUnlinked`, `buildCloseParams`, `buildLinkParams`) เทสได้ ไม่แตะ DB
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { UserRole } from "@/lib/db/types";

import type { SavedContract } from "./types";

/** ข้อความเตือนใต้ช่องหมายเหตุ (mockup FINAL — หัวหน้างานอ่านได้) */
export const CLOSE_NOTE_WARNING =
  "ห้ามใส่ข้อมูลส่วนตัวลูกค้า (เบอร์โทร / ที่อยู่) — หัวหน้างานอ่านหมายเหตุนี้ได้";

/** ขอบบนความยาวหมายเหตุ (กันข้อความยาวผิดปกติ · DB ไม่จำกัด) */
export const CLOSE_NOTE_MAX = 500;

/** สถานะรายการของแถว Renew ที่บันทึกแล้ว */
export type UnlinkedState = "linked" | "open" | "closed" | "not-renew";

export function unlinkedStateOf(s: Pick<SavedContract, "saleType" | "renewedFrom" | "unlinkedClosedAt">): UnlinkedState {
  if (s.saleType !== "renew") return "not-renew";
  if (s.renewedFrom) return "linked";
  return s.unlinkedClosedAt ? "closed" : "open";
}

/** host / admin เท่านั้นที่เปิดกล่องตรวจได้ · เฉพาะ Renew ที่ยังไม่ผูก (ทั้งที่ยังเปิดและที่ปิดแล้ว) */
export function canReviewUnlinked(
  role: UserRole,
  s: Pick<SavedContract, "saleType" | "renewedFrom" | "unlinkedClosedAt">,
): boolean {
  if (role !== "host" && role !== "admin") return false;
  const state = unlinkedStateOf(s);
  return state === "open" || state === "closed";
}

/** ตัดช่องว่าง + จำกัดความยาว · ว่าง = null (ไม่ส่งหมายเหตุ) */
export function normalizeCloseNote(raw: string): string | null {
  const t = raw.trim().slice(0, CLOSE_NOTE_MAX);
  return t === "" ? null : t;
}

export function buildCloseParams(contractId: string, note: string) {
  return { p_contract_id: contractId, p_note: normalizeCloseNote(note) };
}

export function buildLinkParams(contractId: string, oldContractId: string) {
  return { p_contract_id: contractId, p_renewed_from_contract_id: oldContractId };
}

export type ReviewResult = { ok: true } | { ok: false; error: { code?: string | null; message?: string | null; details?: string | null } };

/** ปิดรายการ "ไม่มีสัญญาเก่าในระบบ" */
export async function closeUnlinkedRenewal(
  supabase: SupabaseClient,
  contractId: string,
  note: string,
): Promise<ReviewResult> {
  const { error } = await supabase.rpc("close_unlinked_renewal", buildCloseParams(contractId, note));
  return error ? { ok: false, error } : { ok: true };
}

/** เชื่อมสัญญาเก่าย้อนหลัง */
export async function linkRenewalContract(
  supabase: SupabaseClient,
  contractId: string,
  oldContractId: string,
): Promise<ReviewResult> {
  const { error } = await supabase.rpc("link_renewal_contract", buildLinkParams(contractId, oldContractId));
  return error ? { ok: false, error } : { ok: true };
}
