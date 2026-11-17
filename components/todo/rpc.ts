/**
 * ตัวเรียก RPC ของหน้า /todo (ฝั่ง client · Supabase client ของผู้ใช้จริง · RLS ทำงาน)
 *
 * Logic summary:
 *   * `resolve_missed_service({ contract_id, missed_month, reason, evidence_path?, kind: 'waived' })` — ไม่ชดเชย (M18)
 *   * `reopen_missed_service({ contract_id, missed_month })` — เปิดเรื่อง "ไม่ชดเชย" กลับเป็นรอตัดสิน (2.46)
 *   * หลักฐาน: อัปโหลดเข้า bucket `missed-service-evidence` ที่ `<contract_id>/<uuid>.<นามสกุล>` ก่อนเรียก RPC
 *     RPC ล้มเหลว → ลบไฟล์ที่เพิ่งอัปโหลด (policy ให้ลบไฟล์ตัวเองได้ภายใน 1 ชม. ถ้ายังไม่มีแถวอ้างอิง)
 *   * ทุกฟังก์ชันคืน `{ ok: true } | { ok: false, error }` (แปลเป็นไทยแล้ว · บั๊กหน้าจอ console.error ดิบ)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ServiceError } from "@/components/service/errors";

import { buildEvidencePath, describeTodoError, validateEvidenceFile } from "./logic";

export const EVIDENCE_BUCKET = "missed-service-evidence";

export type TodoRpcResult = { ok: true } | { ok: false; error: ServiceError };

function fail(error: { code?: string | null; message?: string | null; details?: string | null }): TodoRpcResult {
  const described = describeTodoError(error);
  if (described.isBug) console.error("[todo] RPC error", error);
  return { ok: false, error: described };
}

const monthStart = (month: string) => `${month}-01`;

export async function waiveMissedService(
  supabase: SupabaseClient,
  args: { contractId: string; missedMonth: string; reason: string; file: File | null },
): Promise<TodoRpcResult> {
  let evidencePath: string | null = null;

  if (args.file) {
    const invalid = validateEvidenceFile(args.file);
    if (invalid) return { ok: false, error: { message: invalid, isBug: false } };
    evidencePath = buildEvidencePath(args.contractId, crypto.randomUUID(), args.file.type);
    if (!evidencePath) return { ok: false, error: { message: "แนบได้เฉพาะไฟล์ PDF, PNG หรือ JPG", isBug: false } };
    const up = await supabase.storage.from(EVIDENCE_BUCKET).upload(evidencePath, args.file, {
      contentType: args.file.type,
      upsert: false,
    });
    if (up.error) {
      console.error("[todo] upload evidence error", up.error);
      return { ok: false, error: { message: "อัปโหลดไฟล์หลักฐานไม่สำเร็จ ลองอีกครั้ง หรือบันทึกโดยไม่แนบไฟล์", isBug: false } };
    }
  }

  const { error } = await supabase.rpc("resolve_missed_service", {
    p: {
      contract_id: args.contractId,
      missed_month: monthStart(args.missedMonth),
      kind: "waived",
      reason: args.reason.trim(),
      ...(evidencePath ? { evidence_path: evidencePath } : {}),
    },
  });
  if (error) {
    if (evidencePath) {
      // ไฟล์กำพร้า: ลบทิ้งเท่าที่ทำได้ (ล้มเหลวก็ไม่เป็นไร — ระบบมีคิวเก็บกวาดอยู่แล้ว)
      await supabase.storage.from(EVIDENCE_BUCKET).remove([evidencePath]);
    }
    return fail(error);
  }
  return { ok: true };
}

export async function reopenMissedService(
  supabase: SupabaseClient,
  args: { contractId: string; missedMonth: string },
): Promise<TodoRpcResult> {
  const { error } = await supabase.rpc("reopen_missed_service", {
    p: { contract_id: args.contractId, missed_month: monthStart(args.missedMonth) },
  });
  return error ? fail(error) : { ok: true };
}
