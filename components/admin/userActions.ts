"use server";

/**
 * Server action ของหน้า "จัดการผู้ใช้" (`/admin/users`) — M21b (ไฟล์อยู่ใน components/admin เพื่อให้ vitest รันเทสได้)
 *
 * Logic summary:
 *   * **ทุก action เริ่มด้วย `requireHostAction()`** (ตรวจ host ฝั่ง server ทุกคำขอ — ไม่พึ่งการซ่อนปุ่ม)
 *   * งานที่แตะ GoTrue (สร้างบัญชี / รีเซ็ตรหัส / ปิด-เปิด) ผ่าน `@/lib/admin/userAdmin` เท่านั้น
 *     (ห้ามใช้ service-role client ตรงจากไฟล์นี้ — เทส noAdminImportBypass กัน)
 *   * รหัสผ่านชั่วคราวส่งกลับครั้งเดียวใน response ของ action นี้ — ไม่เก็บ ไม่ log ไม่ใส่ URL
 *   * ปิด/เปิดบัญชี: `setBanned` ไม่แตะ `profiles.is_active` → ที่นี่อัปเดต `is_active` ด้วย client ของผู้เรียก
 *     (RLS + trigger กัน host คนสุดท้าย/เจ้าของ) **ก่อน** แล้วค่อยแบน/ปลดแบนที่ GoTrue · ถ้าขั้นหลังล้ม ย้อน `is_active`
 *     → ไม่เกิดสถานะ "ถูกแบนแต่ยังขึ้นใช้งาน" (ถ้าย้อนไม่สำเร็จจะ log เฉพาะรหัส error)
 *   * แก้ชื่อ/ตำแหน่ง: update `profiles` ตรง (role ตามตำแหน่งโดย trigger) · เปลี่ยนตำแหน่งต้องส่งคำยืนยันถูกต้องซ้ำที่ server
 *   * error ทุกตัวแปลเป็นไทยที่ `components/admin/adminErrors.ts` · ห้าม log ข้อความดิบจาก DB
 */
import { revalidatePath } from "next/cache";

import {
  failure,
  failureFromDb,
  type ActionFailure,
  type ActionResult,
} from "@/components/admin/adminErrors";
import { UUID_PATTERN, requireHostAction, type HostContext } from "@/components/admin/hostGuard";
import { CONFIRM_PHRASE, DISPLAY_NAME_MAX } from "@/components/admin/userLogic";
import { createUser, resetPassword, setBanned } from "@/lib/admin/userAdmin";

const USERS_PATH = "/admin/users";

/** P0001 จาก profiles_guard = ปิด/ลดสิทธิ์ host คนสุดท้าย (ปิดตัวเองถูกดักก่อนแล้ว) */
function fromProfileError(error: { code?: string; message?: string; details?: string | null }) {
  if (error.code === "P0001") return failure("LAST_HOST");
  return failureFromDb(error);
}

/** โหลดตำแหน่งของเป้าหมาย + ตำแหน่งต้อง assignable (เจ้าของ = PS003) */
async function loadAssignableTarget(
  supabase: HostContext["supabase"],
  userId: string,
): Promise<{ ok: true; positionCode: string | null; isActive: boolean } | ActionFailure> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("user_id, position_code, is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return failureFromDb(error);
  if (!profile) return failure("NOT_FOUND");
  const row = profile as { position_code: string | null; is_active: boolean };
  if (row.position_code !== null) {
    const { data: pos, error: posError } = await supabase
      .from("positions")
      .select("code, assignable")
      .eq("code", row.position_code)
      .maybeSingle();
    if (posError) return failureFromDb(posError);
    if (!pos) return failure("UPSTREAM_ERROR"); // ตำแหน่งที่โปรไฟล์อ้างหาไม่เจอ = ข้อมูลผิดปกติ → ปฏิเสธ
    if ((pos as { assignable: boolean }).assignable !== true) return failure("PS003");
  }
  return { ok: true, positionCode: row.position_code, isActive: row.is_active };
}

// ---------------------------------------------------------------------------

export async function createUserAction(input: {
  username: string;
  displayName: string;
  positionCode: string;
}): Promise<ActionResult<{ userId: string; username: string; temporaryPassword: string }>> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;

  // ส่งต่อเฉพาะ 3 ช่อง (ไม่ส่ง role / division_scope ที่อาจแอบมา) — userAdmin ตรวจซ้ำแบบ allowlist
  const result = await createUser({
    username: String(input?.username ?? ""),
    displayName: String(input?.displayName ?? ""),
    positionCode: String(input?.positionCode ?? ""),
  });
  if (!result.ok) return failure(result.code);
  revalidatePath(USERS_PATH);
  return {
    ok: true,
    userId: result.userId,
    username: result.username,
    temporaryPassword: result.temporaryPassword,
  };
}

export async function resetPasswordAction(
  userId: string,
): Promise<ActionResult<{ temporaryPassword: string }>> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;

  const result = await resetPassword(userId);
  if (!result.ok) return failure(result.code);
  revalidatePath(USERS_PATH);
  return { ok: true, temporaryPassword: result.temporaryPassword };
}

export async function setActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId) || typeof active !== "boolean") {
    return failure("INVALID_INPUT");
  }
  if (!active && userId.toLowerCase() === guard.callerId.toLowerCase()) return failure("SELF_TARGET");

  const target = await loadAssignableTarget(guard.supabase, userId);
  if (!target.ok) return target;

  // 1) is_active ผ่าน client ของผู้เรียก (RLS + trigger) — ด่านที่ล้มได้บ่อยสุด (host คนสุดท้าย/เจ้าของ) อยู่ก่อน GoTrue
  const { data: updated, error } = await guard.supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("user_id", userId)
    .select("user_id");
  if (error) return fromProfileError(error);
  if (!updated || updated.length === 0) return failure("NOT_FOUND");

  // 2) ตัด/คืนการล็อกอินที่ GoTrue
  const ban = await setBanned(userId, !active);
  if (!ban.ok) {
    const { error: revertError } = await guard.supabase
      .from("profiles")
      .update({ is_active: !active })
      .eq("user_id", userId);
    if (revertError) {
      console.error("[admin/users] revert is_active failed", revertError.code ?? "unknown");
    }
    return failure(ban.code);
  }
  revalidatePath(USERS_PATH);
  return { ok: true };
}

export async function updateUserAction(input: {
  userId: string;
  displayName: string;
  positionCode: string;
  /** คำยืนยันที่ผู้ใช้พิมพ์ — ต้องตรง `CONFIRM_PHRASE` เมื่อเปลี่ยนตำแหน่ง */
  confirm: string;
}): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;

  const userId = input?.userId;
  const displayName = typeof input?.displayName === "string" ? input.displayName.trim() : "";
  const positionCode = typeof input?.positionCode === "string" ? input.positionCode : "";
  if (
    typeof userId !== "string" ||
    !UUID_PATTERN.test(userId) ||
    displayName === "" ||
    displayName.length > DISPLAY_NAME_MAX ||
    positionCode.trim() === ""
  ) {
    return failure("INVALID_INPUT");
  }

  const target = await loadAssignableTarget(guard.supabase, userId);
  if (!target.ok) return target;

  const positionChanged = positionCode !== (target.positionCode ?? "");
  if (positionChanged) {
    if (String(input.confirm ?? "").trim() !== CONFIRM_PHRASE) return failure("BAD_CONFIRM");
    const { data: pos, error: posError } = await guard.supabase
      .from("positions")
      .select("code, assignable")
      .eq("code", positionCode)
      .maybeSingle();
    if (posError) return failureFromDb(posError);
    if (!pos) return failure("NOT_FOUND");
    if ((pos as { assignable: boolean }).assignable !== true) return failure("PS003");
  }

  // role ตามตำแหน่งโดย trigger profiles_guard · division_scope ไม่แตะ
  const values: Record<string, unknown> = { display_name: displayName };
  if (positionChanged) values.position_code = positionCode;
  const { data: updated, error } = await guard.supabase
    .from("profiles")
    .update(values)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return fromProfileError(error);
  if (!updated || updated.length === 0) return failure("NOT_FOUND");

  revalidatePath(USERS_PATH);
  return { ok: true };
}
