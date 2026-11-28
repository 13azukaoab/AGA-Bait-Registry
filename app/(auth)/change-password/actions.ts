"use server";

/**
 * เปลี่ยนรหัสผ่านของตัวเอง (SPEC §6 `profiles.must_change_password` · SEC-04)
 *
 * Logic summary:
 *   * ใช้ทั้งกรณี "บังคับเปลี่ยนครั้งแรก" (บัญชีใหม่ / host รีเซ็ตให้) และกรณีผู้ใช้อยากเปลี่ยนเอง
 *   * กรณีเปลี่ยนเอง ต้องกรอกรหัสผ่านเดิมและตรวจกับ Supabase Auth ก่อน (SEC-04 · DECISIONS 2.109)
 *     กรณีบังคับเปลี่ยนครั้งแรกไม่ต้องกรอก — ตัดสินจากโปรไฟล์ฝั่ง server ไม่ใช่ค่าจากฟอร์ม
 *   * ขั้นตอนทั้งหมดอยู่ใน `lib/auth/changePassword.ts` (เทสได้) · ไฟล์นี้แค่ต่อ Supabase + redirect
 *   * เปลี่ยนรหัสใน Supabase Auth สำเร็จแล้วจึงปิดธง `must_change_password`
 *     ด้วย `complete_password_change()` (function SECURITY DEFINER · 20261110110000)
 *     เพราะ RLS ให้เฉพาะ host เขียนตาราง `profiles` ได้
 *   * สำเร็จแล้วออกจากระบบอุปกรณ์อื่นทั้งหมด (`signOut({ scope: "others" })` · คง session ปัจจุบัน)
 *   * รีเซ็ตรหัสผ่านทางอีเมลไม่มีในระบบ — ลืมรหัสต้องให้ host รีเซ็ตให้ (เจ้าของตัดสิน 10 พ.ย. 2026)
 */
import { redirect } from "next/navigation";

import { LOGIN_PATH, homeForRole } from "@/lib/auth/access";
import { changeOwnPassword } from "@/lib/auth/changePassword";
import { verifyCurrentPasswordWithSupabase } from "@/lib/auth/currentPasswordCheck";
import { fetchProfileByUserId } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

import type { ChangePasswordState } from "../form-state";

export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const supabase = await createClient();

  const outcome = await changeOwnPassword(
    {
      currentPassword: String(formData.get("current_password") ?? ""),
      password: String(formData.get("password") ?? ""),
      confirmation: String(formData.get("confirmation") ?? ""),
    },
    {
      async getUser() {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        return user ? { id: user.id, email: user.email ?? null } : null;
      },
      async loadProfile(userId) {
        const profile = await fetchProfileByUserId(supabase, userId);
        return profile ? { mustChangePassword: profile.mustChangePassword, role: profile.role } : null;
      },
      verifyCurrentPassword: verifyCurrentPasswordWithSupabase,
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (!error) return null;
        // ส่งเฉพาะ code/message/reasons ไม่ส่งรหัสผ่าน และไม่ log
        const reasons = (error as { reasons?: readonly string[] }).reasons;
        return { code: error.code, message: error.message, reasons };
      },
      async completePasswordChange() {
        await supabase.rpc("complete_password_change");
      },
      async signOutOtherSessions() {
        await supabase.auth.signOut({ scope: "others" });
      },
    },
  );

  if (outcome.kind === "unauthenticated") {
    redirect(LOGIN_PATH);
  }
  if (outcome.kind === "error") {
    return { error: outcome.error };
  }
  redirect(outcome.role ? homeForRole(outcome.role) : LOGIN_PATH);
}
