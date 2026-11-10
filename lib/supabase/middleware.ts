/**
 * Supabase client สำหรับ `middleware.ts` (Edge runtime)
 *
 * Logic summary:
 *   * middleware เป็นที่เดียวที่ต่ออายุ session ได้ทุกคำขอ (`@supabase/ssr` จะสั่งเขียน
 *     คุกกี้ชุดใหม่เมื่อ access token ใกล้หมดอายุ)
 *   * คุกกี้ที่ Supabase สั่งเขียนถูกเก็บไว้ใน `pending` ก่อน แล้วค่อยแปะด้วย
 *     `applyCookies(response)` — ทำแบบนี้เพราะ middleware อาจตอบกลับเป็น
 *     `NextResponse.next()` หรือ `NextResponse.redirect()` ก็ได้ ถ้าลืมแปะคุกกี้ลงบน
 *     response ที่ redirect ผู้ใช้จะถูกเด้งออกจากระบบเป็นช่วงๆ ตอน token ถูกต่ออายุ
 *   * ใช้ anon key เท่านั้น — **ห้ามใช้ `SUPABASE_SERVICE_ROLE_KEY` ที่นี่** เพราะ
 *     middleware ต้องเห็นสิทธิ์เท่าที่ผู้ใช้มีจริง (RLS ยังเป็นด่านจริง · SPEC §5)
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

type PendingCookie = { name: string; value: string; options?: CookieOptions };

export function createMiddlewareClient(request: NextRequest) {
  const pending: PendingCookie[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: PendingCookie[]) {
          cookiesToSet.forEach(({ name, value }) => {
            // อัปเดตใน request ด้วย เพื่อให้คำสั่งถัดไปในรอบเดียวกันอ่านค่าใหม่
            request.cookies.set(name, value);
          });
          pending.push(...cookiesToSet);
        },
      },
    },
  );

  /** แปะคุกกี้ที่ Supabase สั่งเขียนลงบน response ที่จะตอบกลับ (ทั้ง next และ redirect) */
  function applyCookies<T extends NextResponse>(response: T): T {
    pending.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    return response;
  }

  return { supabase, applyCookies };
}
