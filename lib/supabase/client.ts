import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client ฝั่ง browser (client component)
 * อ่านค่าจาก env เท่านั้น (CLAUDE.md ข้อ 8 — ห้าม hardcode secret)
 * ความปลอดภัยบังคับที่ RLS (SPEC §5) ไม่ใช่ที่ key
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
