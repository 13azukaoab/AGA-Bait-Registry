import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client ฝั่ง server (server component / route handler)
 * ผูกกับ cookie ของ request เพื่อให้ session/สิทธิ์ตาม user ถูกต้อง (RLS ทำงานตาม auth)
 * อ่านค่าจาก env เท่านั้น (CLAUDE.md ข้อ 8)
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) {
          // ใน server component การ set cookie อาจถูกเรียกนอกบริบทที่เขียนได้ — ไม่เป็นไร
          // (middleware จะ refresh session ให้เองในเฟสที่ทำ auth)
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // ข้ามได้: ถูกเรียกจาก server component ที่ set cookie ไม่ได้
          }
        },
      },
    },
  );
}
