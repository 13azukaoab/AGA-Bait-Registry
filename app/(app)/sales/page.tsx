/**
 * /sales — Dashboard งานขาย (New/Renew) (DECISIONS 2.91 · mockup FINAL docs/mockup/sales-dashboard.html ?v=b)
 *
 * Logic summary:
 *   * เฉพาะ host + admin — ด่านที่ middleware (สิทธิ์ตามเมนูใน nav-items.ts) + ตรวจซ้ำที่นี่ (recorder/viewer เด้งกลับหน้าแรกของตน)
 *     และขอบเขตข้อมูลจริงบังคับด้วย RLS (host เห็นทุกสาขา · admin เห็นตามสาขาของตน)
 *   * server โหลดสัญญา New/Renew 12 เดือนล่าสุด (ตามวันที่รับ Mail) ด้วย Supabase client ของผู้ใช้จริง (ไม่ใช้ service role)
 *     แล้วส่งให้ SalesDashboardClient กรอง/รวมยอดฝั่ง client · ต่อสัญญาล่าช้าคำนวณด้วย isLateRenewal (lib/rules)
 *   * อ่านพลาด = หน้าแจ้งข้อผิดพลาดเป็นภาษาไทย (แสดงแค่รหัส ไม่แสดงตัวเลขสมมติ)
 *   * ⚠ PDPA: มีชื่อลูกค้า — ห้าม console.log ข้อมูล · error log ได้แค่ code
 */
import { redirect } from "next/navigation";

import { loadSalesRows } from "@/components/sales-dashboard/salesData";
import { windowStartDate } from "@/components/sales-dashboard/salesFormat";
import { SalesDashboardClient } from "@/components/sales-dashboard/SalesDashboardClient";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { isLateRenewal } from "@/lib/rules";
import { currentBangkokMonth } from "@/lib/service/months";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SalesDashboardPage() {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/sales")) redirect(homeForRole(profile.role));

  const currentMonth = currentBangkokMonth();
  const supabase = await createClient();
  const result = await loadSalesRows(supabase, windowStartDate(currentMonth), isLateRenewal);

  if (!result.ok) {
    console.error("[sales] load error code", result.code);
    return (
      <div className="p-4">
        <Alert variant="danger" title="เปิดหน้า Dashboard งานขายไม่ได้">
          โหลดข้อมูลงานขายไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ (รหัส {result.code})
        </Alert>
      </div>
    );
  }

  return <SalesDashboardClient rows={result.rows} truncated={result.truncated} currentMonth={currentMonth} />;
}
