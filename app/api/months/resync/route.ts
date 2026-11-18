import { NextResponse } from "next/server";

import { resyncMonth } from "@/lib/dashboard/monthClose";
import { supabaseMonthClosePorts } from "@/lib/dashboard/supabaseMonthClosePorts";

import { errorResponse, fail, monthAndScope, readJson, requireHost } from "../_lib/hostGuard";

// M39 — "คำนวณ snapshot ใหม่ + ส่ง Dashboard" (host · SPEC §7.7 · CLAUDE.md กฎ 7) · POST /api/months/resync
//
// body: { month: "YYYY-MM", scope: "central" | "province" }
// - เฉพาะส่วนที่ปิดแล้ว (ยังไม่ปิด = 409 not_closed) · คำนวณ/เขียนทับเฉพาะเมื่อกดคำสั่งนี้ (cron ไม่ทำเอง)
// - central: คำนวณ 24 สาขาใหม่ด้วย lib/rules → RPC resync_month_part เขียนทับแถว computed
//            (แถวที่ค่าเปลี่ยนลง audit_log ค่าเก่า/ใหม่) · province: ไม่มีสูตร → บันทึกเวลาแล้วส่งใหม่
// - แล้วส่ง Dashboard (sync_logs source = 'resync')
//
// คำตอบ:
//   200 { ok: true, resync: { month, scope, changedBranches }, sync: { ...เหมือน /api/months/close } }
//   400 invalid_body / invalid_month / invalid_scope · 401 / 403 เหมือน close
//   409 not_closed / non_computed_rows · 500 load_failed / invalid_rows / unknown

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await requireHost(request);
  if (guard instanceof Response) return guard;

  const body = await readJson(request);
  if (!body) return fail(400, "invalid_body", "ต้องส่งข้อมูลแบบ JSON");
  const target = monthAndScope(body);
  if (target instanceof Response) return target;

  try {
    const result = await resyncMonth(supabaseMonthClosePorts(guard), target);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
