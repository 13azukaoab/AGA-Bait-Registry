import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/dashboard/cronAuth";
import { runStorageCleanup } from "@/lib/storage/cleanup";
import { supabaseCleanupPorts } from "@/lib/storage/supabasePorts";
import { createAdminClient } from "@/lib/supabase/admin";

// ลบไฟล์ใน Storage ตามคิว storage_deletion_queue (migration 20261112110100 · เจ้าของอนุมัติ 12 พ.ย. 2026)
// Vercel Cron เรียกวันละครั้ง — ต้องเพิ่ม entry ใน vercel.json (งานหมวด 3 · ดูรายงาน BE)
//
// ความปลอดภัย:
//   * ด่านเดียวกับ /api/cron/sync — ไม่ได้ตั้ง CRON_SECRET = ปฏิเสธทุกคำขอ (fail closed)
//   * ใช้ service role (ข้าม RLS) เฉพาะในไฟล์ฝั่ง server นี้ · ไม่ส่งค่าคีย์หรือ path ไฟล์กลับในคำตอบ

export const dynamic = "force-dynamic";
// รอบละไม่เกิน 100 ไฟล์ (lib/storage/cleanup.ts) — ให้เวลาพอสำหรับลบ + ตรวจซ้ำทีละไฟล์
export const maxDuration = 60;

export async function GET(request: Request) {
  if (
    !isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runStorageCleanup(supabaseCleanupPorts(createAdminClient()));
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    // อ่านคิวไม่ได้ / ไม่มี env — ตอบ 500 ให้ Vercel บันทึกว่ารอบนี้ล้ม (รอบหน้าทำต่อจากคิวเดิม)
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
