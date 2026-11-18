import { NextResponse } from "next/server";

import { closeMonthAsActor } from "@/lib/admin/monthCloseAdmin";
import { monthKey } from "@/lib/rules/monthKey";

import { errorResponse, fail, monthAndScope, readJson, requireUser } from "../_lib/hostGuard";

// M39 — ปิดเดือน 1 ส่วน (SPEC §7.7 · DECISIONS 5.4, 2.72 · เจ้าของ 18 พ.ย. 2026) · POST /api/months/close
//
// ใครกดได้: ส่วนกลาง = host หรือ recorder ที่มีส่วนกลางใน division_scope · ต่างจังหวัด = host
//           (ตรวจที่ DB ด้วย JWT ผู้ใช้: can_close_month_part) · ปิดข้ามด้วยเหตุผล = host เท่านั้น
// body: { month: "YYYY-MM", scope: "central" | "province", confirmKey: "OCT.26",
//         overrideReason?: string (host · 5–500 ตัว · เมื่อมีสาขาส่วนกลางบันทึกบริการไม่ครบ),
//         acknowledgeCarried?: boolean (ต่างจังหวัด · เมื่อมีสาขาใช้ค่ายกมา) }
//   **ไม่รับตัวเลข** — server คำนวณ 24 สาขาเองด้วย lib/rules (service role อ่านทะเบียนครบทุกสัญญา)
// ลำดับ: ด่าน (Origin → ล็อกอิน → สิทธิ์ที่ DB) → lib/admin/monthCloseAdmin (service role ในนามผู้กด)
//        → RPC close_month_part (ตรวจสิทธิ์ผู้กดซ้ำ + เขียน snapshot + แถวปิด ใน transaction เดียว · audit ในนามผู้กด)
//        → ส่ง Dashboard (sync_logs source = 'close' · triggered_by = ผู้กด)
// ปิดสำเร็จแต่ส่งไม่สำเร็จ = ยัง 200 (เดือนปิดแล้ว · sync.result บอกผลการส่ง)
//
// คำตอบ:
//   200 { ok: true, closure: { month, scope, closedAt, overridden, unreadyCount, carriedCount },
//         sync: { result: success|skipped|failed|busy|not_started, logId?, errorCode?, message, monthsSent } }
//   400 invalid_body / invalid_month / invalid_scope / confirm_key_mismatch / invalid_reason
//   401 unauthenticated · 403 bad_origin / forbidden / override_host_only
//   409 month_not_ended / before_go_live / already_closed /
//       branches_not_ready (+branches[{id,name,pending}], canOverride) / non_computed_rows /
//       carried_not_acknowledged (+branches)
//   500 load_failed / invalid_rows / unknown

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const signedIn = await requireUser(request);
  if (signedIn instanceof Response) return signedIn;

  const body = await readJson(request);
  if (!body) return fail(400, "invalid_body", "ต้องส่งข้อมูลแบบ JSON");
  const target = monthAndScope(body);
  if (target instanceof Response) return target;

  // สิทธิ์ตามส่วนที่จะปิด ตรวจที่ฐานข้อมูลก่อนใช้ service role
  const { data: allowed, error: roleError } = await signedIn.supabase.rpc("can_close_month_part", {
    p_scope: target.scope,
  });
  if (roleError || allowed !== true) return fail(403, "forbidden");

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
    const result = await closeMonthAsActor(signedIn.userId, {
      ...target,
      overrideReason: typeof reason === "string" && reason.trim() !== "" ? reason : undefined,
      acknowledgeCarried: ack === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
