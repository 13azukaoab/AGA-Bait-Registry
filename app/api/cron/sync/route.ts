import { NextResponse } from "next/server";

// SPEC §9.2 — Auto Sync: Vercel Cron เรียก endpoint นี้ทุกวัน 06:00 ไทย (0 23 * * * UTC)
// หน้าที่จริง (ทำในเฟสถัดไป): สร้าง snapshot → commit dashboard_data.json ไป repo Dashboard ผ่าน GitHub API
// ตอนนี้เป็นโครง: ตรวจ CRON_SECRET แล้วตอบสถานะ ยังไม่ทำงานจริง

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  // Vercel Cron แนบ header Authorization: Bearer <CRON_SECRET> ให้ (กันคนนอกยิง endpoint)
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    synced: false,
    note: "scaffold — ยังไม่เชื่อม Dashboard (จะทำในเฟสถัดไป SPEC §9)",
  });
}
