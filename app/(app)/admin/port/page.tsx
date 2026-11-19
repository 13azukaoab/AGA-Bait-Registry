/**
 * /admin/port — ลงข้อมูล Port ต่างจังหวัด (SPEC §8 หน้า 9 · mockup FINAL `docs/mockup/provincial-port-update.html` · M40)
 *
 * Logic summary:
 *   * เฉพาะ host — ด่าน middleware (กลุ่ม /admin) + ตรวจซ้ำที่นี่ · การเขียนทำที่ browser ด้วย JWT ของผู้ใช้
 *     (trigger `snapshots_manual_guard` + RLS ตรวจสิทธิ์/ตัวเลขที่ฐานข้อมูลซ้ำทุกครั้ง)
 *   * เดือนมาจาก `?month=YYYY-MM` (ผิดรูปแบบ/นอกรายการ = เดือนล่าสุด) · รายการเดือนเริ่มที่ go_live_month
 *   * อ่านข้อมูลไม่ได้ = หน้าแจ้งข้อผิดพลาด (ไม่แสดงเหมือนยังไม่มีข้อมูล)
 */
import { redirect } from "next/navigation";

import { PortClient } from "@/components/port/PortClient";
import { loadPortData } from "@/components/port/portData";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PortPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/admin/port")) redirect(homeForRole(profile.role));

  const { month } = await searchParams;
  const data = await loadPortData(await createClient(), typeof month === "string" ? month : undefined);
  if (!data) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="โหลดข้อมูล Port ต่างจังหวัดไม่สำเร็จ">
          อ่านข้อมูลสาขาหรือ snapshot ไม่ได้ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลฐานข้อมูล
        </Alert>
      </div>
    );
  }
  return <PortClient data={data} />;
}
