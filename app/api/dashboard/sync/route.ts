import { NextResponse } from "next/server";

import { runDashboardSync } from "@/lib/dashboard/runSync";
import { supabaseSyncPorts } from "@/lib/dashboard/supabaseSyncPorts";
import { createClient } from "@/lib/supabase/server";

// M27 — ปุ่ม "ส่งตอนนี้" (host เท่านั้น · หน้าจอ 10 Dashboard Sync) · POST /api/dashboard/sync
//
// ลำดับ:
//   1. ตรวจที่มาของคำขอ (Origin ต้องเป็นเว็บนี้ — กัน CSRF เพิ่มจาก cookie SameSite)
//   2. ผู้ใช้ต้องล็อกอิน (auth.getUser ตรวจ token กับ Supabase จริง) → ไม่ใช่ = 401
//   3. ต้องเป็น host ตาม **ฐานข้อมูล** (RPC is_host) — ไม่เชื่อ role ฝั่ง client → ไม่ใช่ = 403
//   4. ส่งด้วย JWT ของผู้ใช้เอง (ไม่ใช้ service role) · DB ตรวจ host ซ้ำใน start_sync_log
//      และตั้ง triggered_by = auth.uid() เอง · มีรอบอื่นกำลังส่ง = 409 (SY001)
//   5. บันทึกผลลง sync_logs ทุกรอบ (source = 'manual')
//
// คำตอบ (JSON):
//   200 { ok: true,  result: "success" | "skipped", logId, monthsSent, monthCount, commitSha?, message }
//   502 { ok: false, result: "failed", logId, errorCode, message, monthsSent: [] }   ← ส่งไม่สำเร็จ (บันทึก log แล้ว)
//   401 unauthenticated · 403 forbidden / bad_origin · 409 busy · 500 start_failed / log_failed

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // fetch แบบ same-origin บางเบราว์เซอร์ไม่ส่ง Origin · cookie SameSite=Lax กันข้ามเว็บอยู่แล้ว
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, errorCode: "bad_origin" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, errorCode: "unauthenticated" }, { status: 401 });
  }

  const { data: isHost, error: roleError } = await supabase.rpc("is_host");
  if (roleError || isHost !== true) {
    return NextResponse.json({ ok: false, errorCode: "forbidden" }, { status: 403 });
  }

  let outcome;
  try {
    outcome = await runDashboardSync("manual", supabaseSyncPorts(supabase));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "SY001") {
      return NextResponse.json(
        { ok: false, errorCode: "busy", message: "มีการส่งข้อมูลเข้า Dashboard กำลังทำงานอยู่ รอสักครู่แล้วลองใหม่" },
        { status: 409 },
      );
    }
    if (code === "42501") {
      return NextResponse.json({ ok: false, errorCode: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ ok: false, errorCode: "start_failed" }, { status: 500 });
  }

  // runDashboardSync("manual") ไม่คืน busy (DB throw SY001 แทน) — กันไว้เผื่อ
  if (outcome.status === "busy") {
    return NextResponse.json({ ok: false, errorCode: "busy" }, { status: 409 });
  }

  const body = {
    ok: outcome.result !== "failed",
    logId: outcome.logId,
    result: outcome.result,
    errorCode: outcome.errorCode,
    message: outcome.message,
    monthsSent: outcome.monthsSent,
    monthCount: outcome.monthCount,
    commitSha: outcome.commitSha,
  };
  if (outcome.logError) {
    return NextResponse.json({ ...body, ok: false, errorCode: body.errorCode ?? "log_failed" }, { status: 500 });
  }
  return NextResponse.json(body, { status: outcome.result === "failed" ? 502 : 200 });
}
