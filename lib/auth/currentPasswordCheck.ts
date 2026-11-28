/**
 * ตรวจรหัสผ่านเดิมก่อนเปลี่ยนรหัส (SEC-04) — ใช้ฝั่ง server เท่านั้น (server action)
 *
 * ทำไมไม่ใช้ client ตัวที่ผูก cookie (`lib/supabase/server.ts`):
 *   signInWithPassword บน client นั้นจะเขียน session ใหม่ทับ cookie ของผู้ใช้
 *   จึงสร้าง client ชั่วคราวด้วย anon key ที่ **ไม่เก็บ session** (persistSession: false)
 *   แล้วปิด session ชั่วคราวนั้นทันทีด้วย signOut แบบ scope "local"
 *   (ห้ามใช้ signOut() ค่าเริ่มต้น = global จะเตะ session จริงของผู้ใช้ออกด้วย)
 *
 * ผล: "valid" เมื่อเข้าได้และเป็นผู้ใช้คนเดียวกัน · "invalid" เมื่อรหัสผิด · "unavailable" เมื่อตรวจไม่ได้
 * (ติด rate limit / เครือข่าย / ไม่มี env) — ไม่ log รหัสผ่าน และไม่ส่งข้อความ error ดิบกลับ
 */
import { createClient } from "@supabase/supabase-js";

import type { CurrentPasswordCheck } from "./changePassword";

export async function verifyCurrentPasswordWithSupabase(
  userId: string,
  email: string,
  password: string,
): Promise<CurrentPasswordCheck> {
  if (typeof window !== "undefined") {
    throw new Error("verifyCurrentPasswordWithSupabase must not run in the browser");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return "unavailable";
  }

  const probe = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { data, error } = await probe.auth.signInWithPassword({ email, password });
    if (error) {
      // 400 invalid_credentials = รหัสผิด · อย่างอื่น (429 rate limit / 5xx) = ตรวจไม่ได้ตอนนี้
      return error.code === "invalid_credentials" || error.status === 400 ? "invalid" : "unavailable";
    }
    if (!data.session) {
      return "unavailable";
    }
    // ปิด session ชั่วคราว (เฉพาะตัวมันเอง) — ไม่ให้ค้างในรายการ session ของผู้ใช้
    await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
    return data.user?.id === userId ? "valid" : "invalid";
  } catch {
    return "unavailable";
  }
}
