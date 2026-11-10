import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/dashboard/cronAuth";

// SPEC §9.2 — Auto Sync: Vercel Cron เรียก endpoint นี้ทุกวัน 06:00 ไทย (0 23 * * * UTC)
// หน้าที่จริง (ทำในเฟสถัดไป): สร้าง snapshot → ส่งขึ้น repo Dashboard ด้วย lib/dashboard/sync.ts
// ตอนนี้เป็นโครง: ตรวจสิทธิ์แล้วตอบสถานะ ยังไม่เชื่อมฐานข้อมูลและยังไม่ส่งจริง
//
// ความปลอดภัย: ไม่ได้ตั้ง CRON_SECRET = ปฏิเสธทุกคำขอ (fail closed)
// เหตุผล: ถ้าปล่อยผ่านตอนไม่มี secret ใครก็ยิง endpoint นี้ให้ระบบ commit ขึ้น repo Dashboard ได้

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (
    !isAuthorizedCronRequest(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    synced: false,
    note: "scaffold — ยังไม่เชื่อม Dashboard (จะทำในเฟสถัดไป SPEC §9)",
  });
}
