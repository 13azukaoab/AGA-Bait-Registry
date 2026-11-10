/**
 * ด่านสิทธิ์ฝั่ง server ของทุกคำขอ (SPEC §5) + ต่ออายุ session ของ Supabase
 *
 * Logic summary (ลำดับการตรวจ):
 *   1. ต่ออายุ session และอ่านผู้ใช้จากคุกกี้ (`auth.getUser()` ตรวจ token กับ Supabase จริง
 *      ไม่ใช่เชื่อค่าในคุกกี้)
 *   2. **ยังไม่ล็อกอิน** + ขอหน้าในกลุ่ม `app/(app)` → เด้งไป `/login?next=<path ที่ขอ>`
 *   3. **ล็อกอินแล้ว** → อ่านโปรไฟล์ของตัวเอง (RLS ให้อ่านแถวตัวเอง)
 *        - ไม่มีโปรไฟล์ หรือ `is_active = false` → ออกจากระบบทันทีแล้วเด้งไปหน้าเข้าสู่ระบบ
 *          (บัญชีถูกปิดระหว่างที่ token ยังไม่หมดอายุ ก็ใช้ต่อไม่ได้)
 *        - `must_change_password = true` → บังคับไปหน้าเปลี่ยนรหัสก่อนเข้าหน้าอื่นทุกหน้า
 *          (SPEC §6 `profiles` · เจ้าของตัดสิน 6 พ.ย. 2026)
 *        - อยู่หน้าเข้าสู่ระบบแล้วแต่ล็อกอินอยู่ → ส่งเข้าหน้าแรกของตำแหน่งนั้น
 *        - ขอหน้าที่ตำแหน่งนั้นไม่มีสิทธิ์ → ส่งกลับหน้าแรกของตำแหน่ง (ไม่โชว์หน้าเปล่า)
 *
 * ⚠ ด่านนี้ไม่ใช่ด่านสุดท้าย — ด่านจริงคือ RLS ในฐานข้อมูล การซ่อนเมนู/เด้งหน้า
 *   เป็นเพียงประสบการณ์ใช้งาน (CLAUDE.md ข้อ 1)
 */
import { NextResponse, type NextRequest } from "next/server";

import {
  CHANGE_PASSWORD_PATH,
  LOGIN_PATH,
  LOGOUT_PATH,
  canAccessPath,
  homeForRole,
  isAppPath,
  safeRedirectPath,
} from "@/lib/auth/access";
import { fetchProfileByUserId } from "@/lib/db";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { supabase, applyCookies } = createMiddlewareClient(request);

  const redirectTo = (path: string) =>
    applyCookies(NextResponse.redirect(new URL(path, request.url)));
  const carryOn = () => applyCookies(NextResponse.next({ request }));

  const onApp = isAppPath(pathname);
  const onLogin = pathname === LOGIN_PATH;
  const onChangePassword = pathname === CHANGE_PASSWORD_PATH;
  const onLogout = pathname === LOGOUT_PATH;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ---------- ยังไม่ล็อกอิน ----------
  if (!user) {
    if (onApp) {
      const next = encodeURIComponent(`${pathname}${search}`);
      return redirectTo(`${LOGIN_PATH}?next=${next}`);
    }
    // หน้าเปลี่ยนรหัส/ออกจากระบบไม่มีความหมายถ้าไม่ได้ล็อกอิน
    if (onChangePassword || onLogout) return redirectTo(LOGIN_PATH);
    return carryOn();
  }

  // ---------- ล็อกอินแล้ว ----------
  const profile = await fetchProfileByUserId(supabase, user.id);

  if (!profile || !profile.isActive) {
    // บัญชีถูกปิด หรือ host ยังไม่ได้ตั้งโปรไฟล์ให้ — ตัด session ทิ้งทันที
    await supabase.auth.signOut();
    const reason = profile ? "disabled" : "no-profile";
    return onLogin ? carryOn() : redirectTo(`${LOGIN_PATH}?reason=${reason}`);
  }

  if (profile.mustChangePassword && !onChangePassword && !onLogout) {
    return redirectTo(CHANGE_PASSWORD_PATH);
  }

  const home = homeForRole(profile.role);

  if (onLogin) {
    return redirectTo(safeRedirectPath(request.nextUrl.searchParams.get("next"), home));
  }

  if (onApp && !canAccessPath(profile.role, pathname)) {
    return redirectTo(home);
  }

  return carryOn();
}

/**
 * ไม่ต้องวิ่งผ่าน middleware: ไฟล์ static, รูป, service worker, manifest
 * และ `/api/cron/*` ที่มีด่านของตัวเอง (`CRON_SECRET` · SPEC §9.2)
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/cron|favicon.ico|manifest.webmanifest|sw.js|icons/).*)",
  ],
};
