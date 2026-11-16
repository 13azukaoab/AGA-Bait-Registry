import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { checkHealth, type HealthProbe } from "@/lib/health/checkHealth";

// GET /api/health — ให้ตัวเฝ้าดู (GitHub Actions `uptime.yml`) เช็กว่าเว็บ + ฐานข้อมูลยังทำงาน
//
// ความปลอดภัย:
//   * เปิดสาธารณะ ไม่ต้องล็อกอิน → ตอบแค่ { status, db, checkedAt } ไม่มีข้อมูลลูกค้า/เวอร์ชัน/error ดิบ
//   * ใช้ anon key เท่านั้น (**ห้าม service role**) อ่าน view `v_branch_summary` ที่ไม่มี PII — 1 แถว ไม่คืนค่าออกไป
//   * ไม่แคช (no-store) เพื่อให้ได้สถานะจริงทุกครั้ง · timeout 5 วินาทีกันค้าง

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function dbProbe(): HealthProbe {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return (signal) => {
    if (!url || !key) return Promise.resolve({ error: "missing env" });
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return supabase.from("v_branch_summary").select("month_key").limit(1).abortSignal(signal);
  };
}

export async function GET() {
  const { httpStatus, body } = await checkHealth(dbProbe());
  return NextResponse.json(body, { status: httpStatus, headers: NO_STORE });
}
