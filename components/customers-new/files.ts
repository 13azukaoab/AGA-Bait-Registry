/**
 * งานไฟล์แนบสัญญาบน Supabase Storage + ตาราง contract_files (ฝั่ง client · ใช้ session ผู้ใช้จริง)
 *
 * Logic summary (กฎครบอยู่ที่หัว migration 20261111090300_contract_files.sql):
 *   * bucket `contract-files` เป็น private — เปิดไฟล์ด้วย signed URL อายุสั้นเท่านั้น
 *   * path = `<contract_id>/<โทเคน>-<ชื่อปลอดภัย>` (ดู `buildStoragePath`) · ชื่อเดิมเก็บใน file_name
 *   * contract_pdf: 1 แถวต่อสัญญา — แนบใหม่ = UPDATE แถวเดิม (object เก่า DB ลงคิวลบเอง ไม่ต้องลบฝั่ง client)
 *   * site_plan: เพิ่มเป็นเวอร์ชันใหม่ ต้องมีเหตุผล · version/is_current ฐานข้อมูลนับให้เอง (trigger)
 *   * ฐานข้อมูลเป็นตัวตั้งเรื่องลบ object (migration 20261112110100): ลบแถว/เปลี่ยน path/ลบสัญญา → trigger ลง
 *     `storage_deletion_queue` แล้ว cron ลบจริง · ฝั่ง client ลบเฉพาะ **ไฟล์ที่เพิ่งอัปโหลดแล้วเขียนแถวไม่สำเร็จ**
 *     (policy ของ bucket ยอมให้ผู้อัปโหลดเห็น/ลบไฟล์ตัวเองที่อัปโหลดไม่เกิน 1 ชั่วโมง) — ลบไม่ได้ = แจ้งผู้ใช้ ไม่กลืนเงียบ
 *   * ลำดับ: อัปโหลด object ก่อน → เขียนแถว · แถวเขียนไม่สำเร็จ = ลบ object ที่เพิ่งอัปโหลด
 *   * รูปภาพ 5–10 MB บีบก่อน (`compress.ts`) · PDF > 5 MB ปฏิเสธ (ไม่มีตัวบีบ PDF) · > 10 MB ปฏิเสธ ·
 *     บีบแล้วยังเกิน 5 MB ไม่รับ
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { compressFile } from "./compress";
import { describeShortfall, removalShortfall } from "./deleteRules";
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

/** `warning` = งานหลักสำเร็จ แต่มีเรื่องที่ผู้ใช้ต้องรู้ */
export type OpResult = { ok: true; warning?: string } | { ok: false; error: string };

/** ตรวจชนิด/ขนาดไฟล์ + บีบถ้า 5–10 MB · error = ข้อความไทย */
export async function prepareFile(
  kind: ContractFileKind,
  file: File,
): Promise<{ ok: true; pending: PendingFile } | { ok: false; error: string }> {
  const check = checkFile(kind, file);
  if (!check.ok) return { ok: false, error: check.error ?? "ไฟล์ไม่ผ่านเงื่อนไข" };
  if (check.verdict === "ok") return { ok: true, pending: { file, wasCompressed: false } };

  // ถึงตรงนี้เฉพาะรูปภาพ 5–10 MB (PDF ถูกปฏิเสธที่ checkFile แล้ว)
  const compressed = await compressFile(file);
  if (!compressed) {
    return { ok: false, error: "บีบแล้วไฟล์ยังเกิน 5 MB กรุณาสแกนใหม่ให้เล็กลง" };
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

/**
 * ลบ object ใน Storage แล้วตรวจผลจริง — ห้ามกลืน error
 * (Storage ที่ถูก RLS ปฏิเสธจะไม่ error แต่คืนรายการว่าง/ไม่ครบ จึงเทียบจำนวนกับที่ขอลบ)
 */
export async function removeObjects(
  supabase: SupabaseClient,
  paths: string[],
): Promise<{ ok: true } | { ok: false; error: string; removed: number }> {
  if (paths.length === 0) return { ok: true };
  const { data, error } = await supabase.storage.from(CONTRACT_FILES_BUCKET).remove(paths);
  if (error) return { ok: false, error: describeDbError(error as never, "file"), removed: 0 };
  const removed = data?.length ?? 0;
  if (removalShortfall(paths.length, removed) > 0) {
    return { ok: false, error: describeShortfall(paths.length, removed), removed };
  }
  return { ok: true };
}

/** ลบ object เดี่ยวที่เพิ่งอัปโหลด (ใช้เฉพาะตอนเขียนแถวไม่สำเร็จ) · คืนข้อความเตือน (null = ลบสำเร็จ) */
async function removeObject(supabase: SupabaseClient, path: string): Promise<string | null> {
  const res = await removeObjects(supabase, [path]);
  return res.ok ? null : res.error;
}

/** ต่อข้อความเตือนไฟล์ค้างท้าย error เดิม (ไฟล์ที่เพิ่งอัปโหลดแล้วต้องย้อน) */
function withOrphanNote(error: string, orphan: string | null): string {
  return orphan ? `${error} · ไฟล์ที่อัปโหลดไว้ลบคืนไม่สำเร็จ (${orphan})` : error;
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
      const orphan = await removeObject(supabase, up.path);
      return { ok: false, error: withOrphanNote(describeDbError(error, "file"), orphan) };
    }
    return { ok: true };
  }

  const { error } = await supabase
    .from("contract_files")
    .update({ storage_path: up.path, ...FILE_META(pending) })
    .eq("id", existing.id);
  if (error) {
    const orphan = await removeObject(supabase, up.path);
    return { ok: false, error: withOrphanNote(describeDbError(error, "file"), orphan) };
  }
  // object เก่าไม่ต้องลบเอง — trigger ของ DB ลง storage_deletion_queue ตอน storage_path เปลี่ยน แล้ว cron ลบให้
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
    const orphan = await removeObject(supabase, up.path);
    return { ok: false, error: withOrphanNote(describeDbError(error, "file"), orphan) };
  }
  return { ok: true };
}

/**
 * ลบไฟล์แนบ 1 แถว — ลบแค่แถว `contract_files` · object ใน Storage ถูกลงคิวโดย trigger ของ DB แล้ว cron ลบให้
 * (`.select("id")` เพื่อรู้ว่าลบได้จริง — RLS ปฏิเสธแบบไม่ error จะได้ 0 แถว ห้ามบอกว่าลบแล้วทั้งที่ยังอยู่)
 */
export async function deleteContractFile(
  supabase: SupabaseClient,
  file: { id: string },
): Promise<OpResult> {
  const { data, error } = await supabase.from("contract_files").delete().eq("id", file.id).select("id");
  if (error) return { ok: false, error: describeDbError(error, "file") };
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      error: "ลบไฟล์ไม่สำเร็จ (ไม่มีสิทธิ์ หรือสัญญาถูกปิดแล้ว หรือไฟล์ถูกลบไปแล้ว) รีเฟรชหน้า",
    };
  }
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
