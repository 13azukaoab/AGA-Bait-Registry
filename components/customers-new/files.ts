/**
 * งานไฟล์แนบสัญญาบน Supabase Storage + ตาราง contract_files (ฝั่ง client · ใช้ session ผู้ใช้จริง)
 *
 * Logic summary (กฎครบอยู่ที่หัว migration 20261111090300_contract_files.sql):
 *   * bucket `contract-files` เป็น private — เปิดไฟล์ด้วย signed URL อายุสั้นเท่านั้น
 *   * path = `<contract_id>/<โทเคน>-<ชื่อปลอดภัย>` (ดู `buildStoragePath`) · ชื่อเดิมเก็บใน file_name
 *   * contract_pdf: 1 แถวต่อสัญญา — แนบใหม่ = UPDATE แถวเดิมแล้วลบ object เก่า
 *   * site_plan: เพิ่มเป็นเวอร์ชันใหม่ ต้องมีเหตุผล · version/is_current ฐานข้อมูลนับให้เอง (trigger)
 *   * ลำดับกันข้อมูลค้าง: อัปโหลด object ก่อน → เขียนแถว · แถวเขียนไม่สำเร็จ = ลบ object ที่เพิ่งอัปโหลด
 *     · ลบ = ลบแถวก่อน → ลบ object (แถวลบไม่ผ่านเช่นสัญญาปิดแล้ว = object ยังอยู่ ไม่เหลือแถวลอย)
 *   * ไฟล์ 5–10 MB บีบก่อน (`compress.ts`) · > 10 MB ปฏิเสธ · บีบแล้วยังเกิน 5 MB ไม่รับ
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { compressFile } from "./compress";
import { describeDbError } from "./errors";
import {
  buildStoragePath,
  checkCompressed,
  checkFile,
  isValidReason,
  type ContractFileKind,
} from "./fileRules";
import type { PendingFile } from "./types";

export const CONTRACT_FILES_BUCKET = "contract-files";
/** อายุ signed URL (วินาที) — เปิดดูทันที ไม่เก็บลิงก์ไว้ */
const SIGNED_URL_SECONDS = 60;

export type OpResult = { ok: true } | { ok: false; error: string };

/** ตรวจชนิด/ขนาดไฟล์ + บีบถ้า 5–10 MB · error = ข้อความไทย */
export async function prepareFile(
  kind: ContractFileKind,
  file: File,
): Promise<{ ok: true; pending: PendingFile } | { ok: false; error: string }> {
  const check = checkFile(kind, file);
  if (!check.ok) return { ok: false, error: check.error ?? "ไฟล์ไม่ผ่านเงื่อนไข" };
  if (check.verdict === "ok") return { ok: true, pending: { file, wasCompressed: false } };

  const compressed = await compressFile(file);
  if (!compressed) {
    return {
      ok: false,
      error:
        file.type === "application/pdf"
          ? "ไฟล์ PDF ใหญ่กว่า 5 MB และระบบยังบีบ PDF ในเครื่องไม่ได้ กรุณาสแกนใหม่ให้เล็กกว่า 5 MB"
          : "บีบแล้วไฟล์ยังเกิน 5 MB กรุณาสแกนใหม่ให้เล็กลง",
    };
  }
  const after = checkCompressed(compressed.file.size);
  if (!after.ok) return { ok: false, error: after.error ?? "บีบแล้วไฟล์ยังใหญ่เกินไป" };
  return { ok: true, pending: { file: compressed.file, wasCompressed: true } };
}

function newToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function uploadObject(
  supabase: SupabaseClient,
  contractId: string,
  pending: PendingFile,
): Promise<{ path: string } | { error: string }> {
  const path = buildStoragePath(contractId, pending.file.name, newToken());
  const { error } = await supabase.storage
    .from(CONTRACT_FILES_BUCKET)
    .upload(path, pending.file, { contentType: pending.file.type, upsert: false });
  if (error) return { error: describeDbError(error as never, "file") };
  return { path };
}

async function removeObject(supabase: SupabaseClient, path: string): Promise<void> {
  // ลบ object ไม่สำเร็จไม่ทำให้ข้อมูลหลักผิด — ปล่อยผ่าน (ไฟล์ค้างไม่มีแถวอ้างอิง ไม่เปิดให้ใครเห็น)
  await supabase.storage.from(CONTRACT_FILES_BUCKET).remove([path]);
}

const FILE_META = (pending: PendingFile) => ({
  file_name: pending.file.name,
  mime_type: pending.file.type,
  size_bytes: pending.file.size,
  was_compressed: pending.wasCompressed,
});

/** แนบ/เปลี่ยน PDF สัญญา (`existing` = แถว contract_pdf เดิมถ้ามี) */
export async function putContractPdf(
  supabase: SupabaseClient,
  contractId: string,
  pending: PendingFile,
  existing: { id: string; storagePath: string } | null,
): Promise<OpResult> {
  const up = await uploadObject(supabase, contractId, pending);
  if ("error" in up) return { ok: false, error: up.error };

  if (!existing) {
    const { error } = await supabase
      .from("contract_files")
      .insert({ contract_id: contractId, kind: "contract_pdf", storage_path: up.path, ...FILE_META(pending) });
    if (error) {
      await removeObject(supabase, up.path);
      return { ok: false, error: describeDbError(error, "file") };
    }
    return { ok: true };
  }

  const { error } = await supabase
    .from("contract_files")
    .update({ storage_path: up.path, ...FILE_META(pending) })
    .eq("id", existing.id);
  if (error) {
    await removeObject(supabase, up.path);
    return { ok: false, error: describeDbError(error, "file") };
  }
  await removeObject(supabase, existing.storagePath);
  return { ok: true };
}

/** เพิ่ม Site plan เวอร์ชันใหม่ (ต้องมีเหตุผล · ต้องมี PDF สัญญาแล้ว — trigger ตรวจ) */
export async function addSitePlan(
  supabase: SupabaseClient,
  contractId: string,
  reason: string,
  pending: PendingFile,
): Promise<OpResult> {
  if (!isValidReason(reason)) return { ok: false, error: "ใส่เหตุผลที่แก้ Site plan ก่อน" };
  const up = await uploadObject(supabase, contractId, pending);
  if ("error" in up) return { ok: false, error: up.error };
  const { error } = await supabase.from("contract_files").insert({
    contract_id: contractId,
    kind: "site_plan",
    storage_path: up.path,
    reason: reason.trim(),
    ...FILE_META(pending),
  });
  if (error) {
    await removeObject(supabase, up.path);
    return { ok: false, error: describeDbError(error, "file") };
  }
  return { ok: true };
}

/** ลบไฟล์แนบ 1 แถว + object ใน Storage */
export async function deleteContractFile(
  supabase: SupabaseClient,
  file: { id: string; storagePath: string },
): Promise<OpResult> {
  const { error } = await supabase.from("contract_files").delete().eq("id", file.id);
  if (error) return { ok: false, error: describeDbError(error, "file") };
  await removeObject(supabase, file.storagePath);
  return { ok: true };
}

/** เปิดไฟล์ด้วย signed URL (แท็บใหม่) */
export async function openFile(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<OpResult> {
  // เปิดแท็บก่อน await เพื่อไม่ให้ถูกบล็อกป๊อปอัป
  const win = window.open("", "_blank");
  const { data, error } = await supabase.storage
    .from(CONTRACT_FILES_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    win?.close();
    return { ok: false, error: "เปิดไฟล์ไม่ได้ (ไฟล์อาจถูกลบ หรือไม่มีสิทธิ์ดู)" };
  }
  if (win) win.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
  return { ok: true };
}
