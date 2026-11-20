/**
 * ยกเลิกสัญญา / เปิดสัญญากลับ (DECISIONS 2.97 · M44) — ตรรกะฝั่งหน้าจอ (pure) + ตัวเรียก RPC
 *
 * Logic summary:
 *   * RPC `cancel_contract(p_contract_id, p_reason_code, p_reason)` / `reopen_contract(p_contract_id, p_reason)` ·
 *     เหตุผลบังคับ ≤ 500 ตัวอักษร · ประเภทเหตุผล: entry_error (ลงข้อมูลผิด) / customer_cancelled (ลูกค้ายกเลิกจริง) / other (อื่นๆ)
 *   * สิทธิ์: host + admin เท่านั้นเห็นปุ่ม (admin ในขอบเขต · ฐานข้อมูลตัดสินจริงและตรวจซ้ำทุกเงื่อนไข)
 *   * ปุ่ม "ยกเลิกสัญญา" แสดงเมื่อสัญญายัง "ใช้งาน/พัก" และยังไม่เลยวันสิ้นสุด (สถานะที่ใช้ตัดสินบนหน้าจอ — ดู toContractRow)
 *     และไม่มีสัญญา Renew ที่ยังไม่ยกเลิกต่อจากสัญญานี้ (ให้ยกเลิกสัญญาใหม่แทน)
 *   * ปุ่ม "เปิดสัญญากลับ" แสดงเมื่อสัญญายกเลิกอยู่ (ฐานข้อมูลปฏิเสธถ้ามี IG เก็บแล้ว/สัญญาเก่ามี Renew อื่น ฯลฯ → แปลเป็นข้อความไทย)
 *   * error: CC001–CC009 + AG004/AG010/AG012/AG013 + 42501 แปลเป็นไทย · log ได้แค่รหัส (PDPA)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { UserRole } from "@/lib/db/types";

import type { ContractRow } from "./types";

export const CANCEL_REASON_MAX = 500;

export type CancelReasonCode = "entry_error" | "customer_cancelled" | "other";

export const CANCEL_REASON_OPTIONS: ReadonlyArray<{ code: CancelReasonCode; label: string; hint: string }> = [
  { code: "entry_error", label: "ลงข้อมูลผิด", hint: "ไม่นับในยอดขายของ Dashboard งานขาย" },
  { code: "customer_cancelled", label: "ลูกค้ายกเลิกจริง", hint: "ยังนับในยอดขาย" },
  { code: "other", label: "อื่นๆ", hint: "ยังนับในยอดขาย — อธิบายในช่องเหตุผล" },
];

export const CANCEL_REASON_LABEL: Record<CancelReasonCode, string> = {
  entry_error: "ลงข้อมูลผิด",
  customer_cancelled: "ลูกค้ายกเลิกจริง",
  other: "อื่นๆ",
};

export function isCancelReasonCode(v: string | null | undefined): v is CancelReasonCode {
  return v === "entry_error" || v === "customer_cancelled" || v === "other";
}

const canManage = (role: UserRole) => role === "host" || role === "admin";

/**
 * ปุ่ม "ยกเลิกสัญญา" แสดงไหม — `status` = สถานะที่ใช้ตัดสินบนหน้าจอของสัญญานั้น (ContractRow.status)
 * `contracts` = สัญญาทั้งหมดของลูกค้า (ไว้หา Renew ที่ต่อจากสัญญานี้)
 */
export function canShowCancel(role: UserRole, k: Pick<ContractRow, "id" | "status">, contracts: readonly Pick<ContractRow, "renewedFromId" | "status">[]): boolean {
  if (!canManage(role)) return false;
  if (k.status !== "active" && k.status !== "paused") return false;
  // สัญญาเก่าที่ถูก Renew ต่อแล้ว (มีสัญญาใหม่ที่ไม่ยกเลิก) ยกเลิกไม่ได้ — ให้ยกเลิกสัญญาใหม่แทน (CC005)
  const renewed = contracts.some((c) => c.renewedFromId === k.id && c.status !== "cancelled");
  return !renewed;
}

/** ปุ่ม "เปิดสัญญากลับ" แสดงไหม */
export function canShowReopen(role: UserRole, k: Pick<ContractRow, "status">): boolean {
  return canManage(role) && k.status === "cancelled";
}

export interface CancelForm {
  code: CancelReasonCode | "";
  reason: string;
}

/** ตรวจฟอร์มยกเลิก · คืนข้อความที่ต้องแก้ (null = ผ่าน) */
export function validateCancelForm(f: CancelForm): string | null {
  if (!f.code) return "กรุณาเลือกประเภทเหตุผล (ลงข้อมูลผิด / ลูกค้ายกเลิกจริง / อื่นๆ)";
  return validateReasonText(f.reason, "ที่ยกเลิกสัญญา");
}

/** ตรวจเหตุผลที่พิมพ์ (บังคับ · ไม่เกิน 500 ตัวอักษร) */
export function validateReasonText(reason: string, what = ""): string | null {
  const t = reason.trim();
  if (t === "") return `กรุณาพิมพ์เหตุผล${what}`;
  if (t.length > CANCEL_REASON_MAX) return `เหตุผลยาวเกิน ${CANCEL_REASON_MAX} ตัวอักษร (ตอนนี้ ${t.length})`;
  return null;
}

// ───────────────────────── error → ข้อความไทย ─────────────────────────

const ERRORS: Record<string, string> = {
  CC001: "กรุณาพิมพ์เหตุผล (ไม่เกิน 500 ตัวอักษร)",
  CC002: "กรุณาเลือกประเภทเหตุผล (ลงข้อมูลผิด / ลูกค้ายกเลิกจริง / อื่นๆ)",
  CC003: "สัญญานี้ยกเลิกไปแล้ว — รีเฟรชหน้า",
  CC004: "สัญญานี้จบแล้ว (ปิดสัญญา / หมดอายุ) ยกเลิกไม่ได้ — ใช้ “ปิดสัญญา” แทน",
  CC005: "สัญญานี้ต่อสัญญา (Renew) ไปแล้ว — ถ้าจะยกเลิก ให้ยกเลิกสัญญาใหม่แทน",
  CC006: "สัญญานี้ไม่ได้ยกเลิกอยู่ — เปิดกลับไม่ได้ (รีเฟรชหน้า)",
  CC007: "สัญญานี้มีสถานี IG ที่บันทึกเก็บคืน / ไม่เก็บ ไปแล้ว — เปิดกลับไม่ได้ ให้ผู้ดูแลระบบ (host) แก้สถานีก่อน",
  CC008: "สัญญาเก่าของสัญญานี้มีสัญญาต่อ (Renew) ตัวอื่นแล้ว — เปิดกลับไม่ได้",
  CC009: "ยกเลิก / เปิดสัญญากลับ ต้องกดจากปุ่มในหน้านี้เท่านั้น (แก้สถานะหรือวันยกเลิกตรงไม่ได้)",
  AG004: "ไม่พบสัญญานี้ (อาจถูกลบไปแล้ว หรืออยู่นอกสิทธิ์ของบัญชี) รีเฟรชหน้า",
  AG010: "เปิดกลับไม่ได้ — สัญญา Renew นี้เริ่มห่างจากสัญญาเก่าเกิน 2 เดือนหลังสัญญาเก่าจบ (ต้องเปิดเป็นลูกค้าใหม่ New)",
  AG012: "เปิดกลับไม่ได้ — Renew ที่ไม่ผูกสัญญาเก่าต้องมีเหตุผล (เช่น สัญญาเก่าไม่อยู่ในระบบ) ให้ผู้ดูแลระบบ (host) แก้ข้อมูลก่อน",
  AG013: "เปิดกลับไม่ได้ — เลยช่วงที่เปิด Renew แบบไม่ผูกสัญญาเก่าได้แล้ว (ผูกสัญญาเก่า หรือเปิดเป็นลูกค้าใหม่ New)",
  "42501": "ไม่มีสิทธิ์ทำรายการนี้ (เฉพาะ host และ admin ในขอบเขตของสัญญา)",
  "22004": "ข้อมูลที่ส่งไม่ครบ — รีเฟรชหน้าแล้วลองอีกครั้ง",
};

export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

/** แปล error ของ cancel_contract / reopen_contract เป็นไทย · isBug = true → ผู้เรียก log รหัส error */
export function describeCancelError(error: RpcErrorLike): { message: string; isBug: boolean } {
  const code = error.code ?? "";
  const known = ERRORS[code];
  if (known) return { message: known, isBug: false };
  const msg = (error.message ?? "").toLowerCase();
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) {
    return { message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง", isBug: false };
  }
  return { message: "ทำรายการไม่สำเร็จ ลองอีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ", isBug: true };
}

// ───────────────────────── ตัวเรียก RPC ─────────────────────────

export type CancelRpcResult = { ok: true } | { ok: false; message: string };

function fail(error: RpcErrorLike): CancelRpcResult {
  const d = describeCancelError(error);
  // PDPA: log เฉพาะรหัส error (ไม่ log ข้อความดิบ/เหตุผลที่ผู้ใช้พิมพ์)
  if (d.isBug) console.error("[customer-detail] cancel/reopen RPC error code", error.code ?? "unknown");
  return { ok: false, message: d.message };
}

export async function cancelContract(
  supabase: SupabaseClient,
  args: { contractId: string; reasonCode: CancelReasonCode; reason: string },
): Promise<CancelRpcResult> {
  const { error } = await supabase.rpc("cancel_contract", {
    p_contract_id: args.contractId,
    p_reason_code: args.reasonCode,
    p_reason: args.reason.trim(),
  });
  return error ? fail(error) : { ok: true };
}

export async function reopenContract(supabase: SupabaseClient, args: { contractId: string; reason: string }): Promise<CancelRpcResult> {
  const { error } = await supabase.rpc("reopen_contract", { p_contract_id: args.contractId, p_reason: args.reason.trim() });
  return error ? fail(error) : { ok: true };
}
