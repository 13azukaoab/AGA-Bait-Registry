import { NextResponse } from "next/server";

import { closeMonth } from "@/lib/dashboard/monthClose";
import { supabaseMonthClosePorts } from "@/lib/dashboard/supabaseMonthClosePorts";
import { monthKey } from "@/lib/rules/monthKey";

import { errorResponse, fail, monthAndScope, readJson, requireHost } from "../_lib/hostGuard";

// M39 — ปิดเดือน 1 ส่วน (host · SPEC §7.7 · DECISIONS 5.4, 2.72) · POST /api/months/close
//
// body: { month: "YYYY-MM", scope: "central" | "province", confirmKey: "OCT.26",
//         overrideReason?: string (5–500 · ส่วนกลางเมื่อมีสาขายังไม่ยืนยัน),
//         acknowledgeCarried?: boolean (ต่างจังหวัดเมื่อมีสาขาใช้ค่ายกมา) }
// ลำดับ: ด่าน host (DB) → ส่วนกลางคำนวณ 24 สาขาด้วย lib/rules → RPC close_month_part (ตรวจ host ซ้ำ +
//        เขียน snapshot + แถวปิด ใน transaction เดียว) → ส่ง Dashboard (sync_logs source = 'close')
// ปิดสำเร็จแต่ส่งไม่สำเร็จ = ยัง 200 (เดือนปิดแล้ว · sync.result บอกผลการส่ง)
//
// คำตอบ:
//   200 { ok: true, closure: { month, scope, closedAt, overridden, unconfirmedCount, carriedCount },
//         sync: { result: success|skipped|failed|busy|not_started, logId?, errorCode?, message, monthsSent } }
//   400 invalid_body / invalid_month / invalid_scope / confirm_key_mismatch / invalid_reason
//   401 unauthenticated · 403 bad_origin / forbidden
//   409 month_not_ended / before_go_live / already_closed / unconfirmed_branches (+branches) /
//       non_computed_rows / carried_not_acknowledged (+branches)
//   500 load_failed / invalid_rows / unknown

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await requireHost(request);
  if (guard instanceof Response) return guard;

  const body = await readJson(request);
  if (!body) return fail(400, "invalid_body", "ต้องส่งข้อมูลแบบ JSON");
  const target = monthAndScope(body);
  if (target instanceof Response) return target;

  const key = monthKey(target.month);
  if (body.confirmKey !== key) {
    return fail(400, "confirm_key_mismatch", `พิมพ์ ${key} เพื่อยืนยันการปิดเดือน`);
  }
  const reason = body.overrideReason;
  if (reason !== undefined && reason !== null && (typeof reason !== "string" || reason.length > 500)) {
    return fail(400, "invalid_reason", "เหตุผลต้องเป็นข้อความไม่เกิน 500 ตัวอักษร");
  }
  const ack = body.acknowledgeCarried;
  if (ack !== undefined && typeof ack !== "boolean") {
    return fail(400, "invalid_body", "acknowledgeCarried ต้องเป็น true/false");
  }

  try {
    const result = await closeMonth(supabaseMonthClosePorts(guard), {
      ...target,
      overrideReason: typeof reason === "string" ? reason : undefined,
      acknowledgeCarried: ack === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
