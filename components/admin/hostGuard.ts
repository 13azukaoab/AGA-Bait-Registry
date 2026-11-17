/**
 * ด่านสิทธิ์ฝั่ง server ของ server action หน้า "จัดการผู้ใช้" / "ตั้งค่า" — เรียกต้นทุกคำขอ
 *
 * Logic summary:
 *   * ไม่พึ่งการซ่อนปุ่ม/เมนู: ทุก action ต้องผ่าน `requireHostAction()` ก่อนแตะข้อมูล
 *   * ตรวจ 3 ชั้นด้วย session ของผู้เรียกเอง (ไม่ใช้ service role):
 *       1. ล็อกอินอยู่  2. RPC `is_host()` (ฐานข้อมูลตัดสิน)  3. โปรไฟล์ยังเปิดอยู่และ role = host
 *   * ล้มเหลว = คืน failure (UNAUTHENTICATED / FORBIDDEN / UPSTREAM_ERROR) ไม่โยน error
 *   * ⚠ ใช้ได้เฉพาะฝั่ง server (import `lib/supabase/server` → next/headers)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchProfileByUserId } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

import { failure, type ActionFailure } from "./adminErrors";

export type HostContext = { ok: true; supabase: SupabaseClient; callerId: string };

export async function requireHostAction(): Promise<HostContext | ActionFailure> {
  const supabase = (await createClient()) as SupabaseClient;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failure("UNAUTHENTICATED");

  const { data: isHost, error } = await supabase.rpc("is_host");
  if (error) return failure("UPSTREAM_ERROR");
  if (isHost !== true) return failure("FORBIDDEN");

  const profile = await fetchProfileByUserId(supabase, user.id);
  if (!profile || !profile.isActive) return failure("UNAUTHENTICATED");
  if (profile.role !== "host") return failure("FORBIDDEN");

  return { ok: true, supabase, callerId: user.id };
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
