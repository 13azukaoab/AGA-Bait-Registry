"use server";

/**
 * เข้าสู่ระบบด้วย username + รหัสผ่าน (SPEC §8 หน้า 1, §5.1)
 *
 * Logic summary:
 *   * ผู้ใช้พิมพ์แค่ username — **การประกอบอีเมล `<username>@aga.local` เกิดที่ไฟล์นี้
 *     ซึ่งเป็นฝั่ง server เท่านั้น** ฟอร์มฝั่ง browser ไม่รู้เรื่องโดเมนเลย
 *   * ข้อความผิดพลาดกรณี "ไม่มีชื่อผู้ใช้นี้" กับ "รหัสผ่านผิด" ใช้ข้อความเดียวกัน
 *     เพื่อไม่ให้คนนอกไล่เดาว่ามีชื่อผู้ใช้ไหนอยู่ในระบบ (ตามหมายเหตุใน mockup login.html)
 *   * ล็อกอินผ่านแล้วยังต้องผ่านอีก 2 ด่าน: ต้องมีแถวใน `profiles` และ `is_active` ต้องเป็น true
 *     ไม่ผ่าน = ตัด session ทิ้งทันที (`signOut`) ไม่ปล่อยให้ค้างคุกกี้ไว้
 *   * `must_change_password` → ส่งไปหน้าเปลี่ยนรหัสก่อนเข้าหน้าอื่น (เจ้าของตัดสิน 6 พ.ย. 2026)
 *   * ไม่ทำ "ล็อกบัญชีเมื่อกรอกผิดหลายครั้ง" ในเฟส 1 (เจ้าของสั่งพักไว้) — ใช้ rate limit
 *     ของ Supabase Auth ไปก่อน
 */
import { redirect } from "next/navigation";

import { CHANGE_PASSWORD_PATH, homeForRole, safeRedirectPath } from "@/lib/auth/access";
import { emailForUsername, isValidUsername, normalizeUsername } from "@/lib/auth/username";
import { fetchProfileByUserId } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

import type { LoginState } from "../form-state";

/** ข้อความเดียวสำหรับทั้ง "ไม่มีชื่อผู้ใช้นี้" และ "รหัสผ่านผิด" — กันการเดาชื่อผู้ใช้ */
const GENERIC_ERROR = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
const DISABLED_ERROR = "บัญชีนี้ถูกปิดการใช้งาน ติดต่อ Host (QCS ส่วนกลาง Bait)";
const NO_PROFILE_ERROR = "บัญชีนี้ยังไม่ได้ตั้งค่าในระบบ ติดต่อ Host (QCS ส่วนกลาง Bait)";
const NETWORK_ERROR = "เครือข่ายขัดข้อง ลองอีกครั้ง หากยังเข้าไม่ได้ให้ติดต่อ Host";

export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = normalizeUsername(String(formData.get("username") ?? ""));
  const password = String(formData.get("password") ?? "");
  const nextValue = formData.get("next");

  if (!username || !password) {
    return { error: "กรอกชื่อผู้ใช้และรหัสผ่าน" };
  }
  // รูปแบบไม่ถูกต้องก็ตอบข้อความเดียวกัน ไม่บอกว่า "ชื่อผู้ใช้ผิดรูปแบบ"
  if (!isValidUsername(username)) {
    return { error: GENERIC_ERROR };
  }

  const supabase = await createClient();

  let userId: string;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailForUsername(username),
      password,
    });
    if (error || !data.user) {
      return { error: GENERIC_ERROR };
    }
    userId = data.user.id;
  } catch {
    // ยิงไม่ถึง Supabase (เครือข่าย/บริการล่ม) — แยกจากกรณีรหัสผิด
    return { error: NETWORK_ERROR };
  }

  const profile = await fetchProfileByUserId(supabase, userId);
  if (!profile) {
    await supabase.auth.signOut();
    return { error: NO_PROFILE_ERROR };
  }
  if (!profile.isActive) {
    await supabase.auth.signOut();
    return { error: DISABLED_ERROR };
  }

  // บันทึกเวลาเข้าใช้ล่าสุด — ไม่ให้ขัดขวางการเข้าใช้ถ้าเขียนไม่สำเร็จ
  await supabase.rpc("touch_last_login");

  if (profile.mustChangePassword) {
    redirect(CHANGE_PASSWORD_PATH);
  }

  redirect(
    safeRedirectPath(
      typeof nextValue === "string" ? nextValue : null,
      homeForRole(profile.role),
    ),
  );
}
