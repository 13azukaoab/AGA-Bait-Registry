/**
 * /admin/settings — ตั้งค่า (SPEC §8 จอ 12 · mockup FINAL `docs/mockup/settings.html`)
 *
 * Logic summary:
 *   * เฉพาะ host (PM / OM / เจ้าของ) — ด่านที่ middleware.ts จากตารางเมนู · ที่นี่ตรวจซ้ำเป็นด่านสำรอง
 *     และ server action ทุกตัวตรวจ host ซ้ำ (components/admin/hostGuard.ts) + DB บังคับ (RLS / RPC)
 *   * 3 แท็บ: เกณฑ์ Tier (+ Workload อยู่แท็บทีม) · ประเภทลูกค้า · ทีม — อ่านจากตารางจริงทั้งหมด
 *   * อ่านไม่ได้ = หน้าแจ้งข้อผิดพลาด ไม่แสดงค่าสมมติ
 */
import { redirect } from "next/navigation";

import { SettingsClient } from "@/components/settings/SettingsClient";
import { loadSettingsData } from "@/components/settings/settingsData";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/admin/settings")) redirect(homeForRole(profile.role));

  const { data } = await loadSettingsData(await createClient());
  if (!data || data.ruleSets.length === 0) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านข้อมูลตั้งค่าไม่ได้">
          โหลดเกณฑ์ Tier / ทีม / ประเภทลูกค้า / ค่าตั้งระบบไม่สำเร็จ ลองรีเฟรชหน้า
          หากยังไม่ได้ให้แจ้งผู้ดูแลฐานข้อมูล (ตรวจตาราง tier_rules, app_settings)
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 max-[640px]:p-3">
      <SettingsClient data={data} />
    </div>
  );
}
