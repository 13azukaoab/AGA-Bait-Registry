import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/dashboard/cronAuth";
import { runDashboardSync } from "@/lib/dashboard/runSync";
import { supabaseSyncPorts } from "@/lib/dashboard/supabaseSyncPorts";
import { createAdminClient } from "@/lib/supabase/admin";

// SPEC §9.2 — Auto Sync: Vercel Cron เรียก endpoint นี้ทุกวัน 06:00 ไทย (0 23 * * * UTC · vercel.json)
// M27: อ่านทะเบียน → ประกอบ dashboard_data.json → commit dashboard_data.json + index.html ใน commit เดียว
//      (ข้อมูลเหมือนเดิม = ข้าม) → บันทึก sync_logs ทุกรอบ (source = 'auto') รวมรอบที่ล้มเหลว
//
// ความปลอดภัย:
//   * ไม่ได้ตั้ง CRON_SECRET = ปฏิเสธทุกคำขอ (fail closed) · ตรวจก่อนแตะฐานข้อมูล (คำขอที่ไม่ผ่านไม่ลง log)
//   * ใช้ service role (ข้าม RLS) เฉพาะในไฟล์นี้ ต่อผ่าน PostgREST (ไม่ใช่ role postgres)
//   * เดือนส่วนกลางที่ปิดแล้วใช้ snapshot เดิม ไม่คำนวณใหม่ (CLAUDE.md กฎ 7 · lib/dashboard/sources.ts)
//   * คำตอบไม่มี token / ข้อความ error ภายในแบบเต็ม — รายละเอียดอยู่ใน sync_logs (host อ่าน)

export const dynamic = "force-dynamic";
// อ่านทะเบียนทั้งหมด + GitHub ~5 คำขอ — DB ปิดรอบที่ค้างเกิน 10 นาทีให้เอง (start_sync_log)
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await runDashboardSync("auto", supabaseSyncPorts(createAdminClient()));
    if (outcome.status === "busy") {
      return NextResponse.json({ ok: true, result: "skipped", errorCode: "busy" });
    }
    const failed = outcome.result === "failed" || outcome.logError !== undefined;
    return NextResponse.json(
      {
        ok: !failed,
        logId: outcome.logId,
        result: outcome.result,
        errorCode: outcome.errorCode ?? (outcome.logError ? "log_failed" : undefined),
        monthsSent: outcome.monthsSent,
        commitSha: outcome.commitSha,
      },
      // ล้มเหลว = 500 ให้ Vercel บันทึกว่ารอบนี้ล้ม (รอบหน้าลองใหม่เอง)
      { status: failed ? 500 : 200 },
    );
  } catch {
    // เริ่มรอบไม่ได้ (ไม่มี env ของ Supabase / DB ล่ม) — ไม่มีแถว log ให้บันทึก
    return NextResponse.json({ ok: false, errorCode: "start_failed" }, { status: 500 });
  }
}
