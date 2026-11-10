/**
 * อ่าน session + โปรไฟล์ของผู้ใช้ฝั่ง server (server component / server action / route handler)
 *
 * ⚠ ไฟล์นี้ใช้ `next/headers` → **import ได้เฉพาะโค้ดฝั่ง server** ห้าม import จาก client component
 *   (ฝั่ง client ให้รับค่าที่ต้องใช้มาเป็น prop)
 *
 * Logic summary:
 *   * `auth.getUser()` ตรวจ token กับ Supabase จริงทุกครั้ง ไม่เชื่อค่าในคุกกี้
 *   * บัญชีที่ `is_active = false` ถือว่า "ไม่มี session" — คืน null เหมือนไม่ได้ล็อกอิน
 *     (ตรงกับ helper ในฐานข้อมูลที่มองข้ามบัญชีปิด · 20261110090300)
 */
import { redirect } from "next/navigation";

import { fetchProfileByUserId, type AppProfile } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

import { LOGIN_PATH } from "./access";

/** โปรไฟล์ของผู้ใช้ที่ล็อกอินอยู่ · null = ไม่ได้ล็อกอิน / ไม่มีโปรไฟล์ / บัญชีถูกปิด */
export async function getCurrentProfile(): Promise<AppProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const profile = await fetchProfileByUserId(supabase, user.id);
  return profile && profile.isActive ? profile : null;
}

/**
 * บังคับว่าต้องล็อกอิน — ไม่ล็อกอินให้เด้งไปหน้าเข้าสู่ระบบ
 * (ปกติ `middleware.ts` เด้งก่อนถึงตรงนี้แล้ว นี่คือด่านสำรองของหน้า server)
 */
export async function requireProfile(): Promise<AppProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect(LOGIN_PATH);
  return profile;
}
