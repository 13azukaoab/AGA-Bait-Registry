/**
 * /admin/months — ส่งข้อมูล และสรุปงานประจำเดือน (ปิดเดือน · SPEC §8.2 · mockup FINAL `docs/mockup/month-closure.html`)
 *
 * Logic summary:
 *   * host + recorder (หัวหน้างาน) เข้าได้ — ด่านที่ middleware จากตารางเมนู · ที่นี่ตรวจซ้ำเป็นด่านสำรอง
 *   * ปิดส่วนกลาง = host/recorder · ปิดต่างจังหวัด/คำนวณใหม่/ปิดข้าม = host · ซ่อนปุ่มตามสิทธิ์ แต่ server + DB ตรวจซ้ำทุกครั้ง
 *   * หน้าเว็บไม่ส่งตัวเลขใดๆ — server คำนวณ snapshot เอง (ดู components/months/monthsApi.ts)
 *   * อ่านข้อมูลไม่ได้ = หน้าแจ้งข้อผิดพลาด ไม่แสดงค่าสมมติ
 */
import { redirect } from "next/navigation";

import { MonthsClient } from "@/components/months/MonthsClient";
import { loadMonthsData } from "@/components/months/monthsData";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminMonthsPage() {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/admin/months")) redirect(homeForRole(profile.role));

  const data = await loadMonthsData(await createClient(), profile.role);
  if (!data) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านข้อมูลปิดเดือนไม่ได้">
          โหลดสถานะปิดเดือน / สถานะส่ง Dashboard ไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 max-[640px]:p-3">
      <MonthsClient data={data} />
    </div>
  );
}
