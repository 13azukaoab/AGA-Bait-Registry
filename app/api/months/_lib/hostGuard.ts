import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { mapMonthCloseError, MONTH_PATTERN, type ClosureScope } from "@/lib/dashboard/monthClose";
import { createClient } from "@/lib/supabase/server";

// M39 — ด่านร่วมของ /api/months/* (แบบเดียวกับ /api/dashboard/sync):
//   1. Origin ต้องเป็นเว็บนี้ (กัน CSRF เพิ่มจาก cookie SameSite) → 403 bad_origin
//   2. ต้องล็อกอิน (auth.getUser ตรวจ token กับ Supabase จริง) → 401 unauthenticated
//      user id ที่ได้ตรงนี้คือ "ผู้กด" ที่ส่งต่อให้ service role (ห้ามรับ id จาก body)
//   3. สิทธิ์ตรวจที่ **ฐานข้อมูล** ด้วย JWT ของผู้ใช้ (is_host / can_close_month_part) → 403 forbidden
//      RPC ปลายทางตรวจสิทธิ์ของผู้กดซ้ำเอง

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // ไม่มี Origin: ยอมเฉพาะเมื่อเบราว์เซอร์ยืนยันว่ามาจากเว็บเดียวกัน (Sec-Fetch-Site)
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function fail(status: number, errorCode: string, message?: string, extra: object = {}) {
  return NextResponse.json({ ok: false, errorCode, ...(message ? { message } : {}), ...extra }, { status });
}

export interface SignedIn {
  supabase: SupabaseClient;
  userId: string;
}

/** Origin + ล็อกอิน → client ของผู้ใช้ + user id (ตรวจกับ Supabase แล้ว) หรือ Response ที่ปฏิเสธ */
export async function requireUser(request: Request): Promise<SignedIn | Response> {
  if (!sameOrigin(request)) return fail(403, "bad_origin");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "unauthenticated");
  return { supabase, userId: user.id };
}

/** requireUser + ต้องเป็น host ตามฐานข้อมูล */
export async function requireHost(request: Request): Promise<SignedIn | Response> {
  const signedIn = await requireUser(request);
  if (signedIn instanceof Response) return signedIn;
  const { data: isHost, error } = await signedIn.supabase.rpc("is_host");
  if (error || isHost !== true) return fail(403, "forbidden");
  return signedIn;
}

/** อ่าน body JSON (ไม่ใช่ object = null) */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** ตรวจ month + scope จาก body → ค่า หรือ Response 400 */
export function monthAndScope(
  body: Record<string, unknown>,
): { month: string; scope: ClosureScope } | Response {
  const { month, scope } = body;
  if (typeof month !== "string" || !MONTH_PATTERN.test(month)) {
    return fail(400, "invalid_month", "เดือนไม่ถูกต้อง (ต้องเป็น YYYY-MM)");
  }
  if (scope !== "central" && scope !== "province") {
    return fail(400, "invalid_scope", "ส่วนต้องเป็น central หรือ province");
  }
  return { month, scope };
}

/** error จาก RPC/การโหลด → Response (ข้อความภายในของ DB ไม่ส่งถึงหน้าจอ) */
export function errorResponse(error: unknown) {
  const { status, errorCode, message, ...extra } = mapMonthCloseError(error);
  return fail(status, errorCode, message, extra);
}
