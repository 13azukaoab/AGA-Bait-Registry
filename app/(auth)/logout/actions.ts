"use server";

/**
 * ออกจากระบบ
 *
 * ทำเป็น server action ที่ยิงด้วยฟอร์ม (POST) ไม่ใช่ลิงก์ GET เพราะ Next
 * โหลดลิงก์ล่วงหน้า (prefetch) ได้ — ถ้าออกจากระบบด้วย GET ผู้ใช้อาจหลุดออกจากระบบเอง
 * ตอนเมาส์ผ่านปุ่ม · แถบบน (`components/shell/Topbar`) ชี้มาที่หน้า `/logout` ที่มีปุ่มยืนยัน
 */
import { redirect } from "next/navigation";

import { LOGIN_PATH } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`${LOGIN_PATH}?reason=signed-out`);
}
