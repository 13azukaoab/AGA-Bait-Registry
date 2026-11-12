/**
 * Supabase client แบบ service role — **ใช้ฝั่ง server เท่านั้น** (route handler ของ cron)
 *
 * ⚠ service role ข้าม RLS ทั้งหมด:
 *   * import ได้เฉพาะไฟล์ใต้ `app/api/**` หรือโค้ดที่รันฝั่ง server · ห้าม import จาก client component
 *   * ค่าคีย์อยู่ใน env ของ Vercel / `.env.local` เท่านั้น (CLAUDE.md ข้อ 8) · ไม่มีค่า = โยน error
 *   * ใช้กับงานเบื้องหลังที่ผู้ใช้ทำเองไม่ได้ เช่น ลบไฟล์ตามคิว (`lib/storage/cleanup.ts`)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient must not run in the browser");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
