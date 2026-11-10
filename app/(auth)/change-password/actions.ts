"use server";

/**
 * เปลี่ยนรหัสผ่านของตัวเอง (SPEC §6 `profiles.must_change_password`)
 *
 * Logic summary:
 *   * ใช้ทั้งกรณี "บังคับเปลี่ยนครั้งแรก" (บัญชีใหม่ / host รีเซ็ตให้) และกรณีผู้ใช้
 *     อยากเปลี่ยนเอง — ขั้นตอนเดียวกัน
 *   * เปลี่ยนรหัสใน Supabase Auth สำเร็จแล้วจึงปิดธง `must_change_password`
 *     ด้วย `complete_password_change()` (function SECURITY DEFINER · 20261110110000)
 *     เพราะ RLS ให้เฉพาะ host เขียนตาราง `profiles` ได้
 *   * รีเซ็ตรหัสผ่านทางอีเมลไม่มีในระบบ — ลืมรหัสต้องให้ host รีเซ็ตให้ (เจ้าของตัดสิน 10 พ.ย. 2026)
 */
import { redirect } from "next/navigation";

import { LOGIN_PATH, homeForRole } from "@/lib/auth/access";
import { fetchProfileByUserId } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

import { PASSWORD_MIN_LENGTH, type ChangePasswordState } from "../form-state";

export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (password.length < PASSWORD_MIN_LENGTH) {
    return { error: `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` };
  }
  if (password !== confirmation) {
    return { error: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(LOGIN_PATH);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // ข้อความจาก Supabase เป็นภาษาอังกฤษ — แปลงเป็นข้อความที่ผู้ใช้เข้าใจ
    const samePassword = error.message.toLowerCase().includes("should be different");
    return {
      error: samePassword
        ? "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม"
        : "เปลี่ยนรหัสผ่านไม่สำเร็จ ลองอีกครั้ง หากยังไม่ได้ให้ติดต่อ Host",
    };
  }

  // ปิดธง "ต้องเปลี่ยนรหัสผ่าน" — ถ้าขั้นนี้พลาด ผู้ใช้จะถูกพามาหน้านี้อีกครั้ง (ไม่หลุดสิทธิ์)
  await supabase.rpc("complete_password_change");

  const profile = await fetchProfileByUserId(supabase, user.id);
  redirect(profile ? homeForRole(profile.role) : LOGIN_PATH);
}
