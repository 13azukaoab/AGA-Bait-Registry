import { NextResponse } from "next/server";

import { setMonthCloser } from "@/lib/dashboard/supabaseMonthClosePorts";

import { errorResponse, fail, monthAndScope, readJson, requireHost } from "../_lib/hostGuard";

// M39 — แก้ชื่อ/เวลาผู้ปิดเดือน (host · DECISIONS 5.8 · ลง audit_log) · POST /api/months/closer
//
// body: { month: "YYYY-MM", scope: "central" | "province", closedBy: uuid, closedAt: ISO 8601 }
// คำตอบ: 200 { ok: true } · 400 invalid_body / invalid_month / invalid_scope / invalid_closer / invalid_closed_at
//        401 / 403 · 409 not_closed · 500 unknown

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const signedIn = await requireHost(request);
  if (signedIn instanceof Response) return signedIn;

  const body = await readJson(request);
  if (!body) return fail(400, "invalid_body", "ต้องส่งข้อมูลแบบ JSON");
  const target = monthAndScope(body);
  if (target instanceof Response) return target;

  const { closedBy, closedAt } = body;
  if (typeof closedBy !== "string" || !UUID.test(closedBy)) {
    return fail(400, "invalid_closer", "ต้องเลือกผู้ปิด");
  }
  if (typeof closedAt !== "string" || Number.isNaN(Date.parse(closedAt))) {
    return fail(400, "invalid_closed_at", "เวลาปิดไม่ถูกต้อง");
  }

  try {
    await setMonthCloser(signedIn.supabase, { ...target, closedBy, closedAt: new Date(closedAt).toISOString() });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
