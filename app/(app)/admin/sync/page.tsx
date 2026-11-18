/**
 * /admin/dashboard-sync — Dashboard Sync (SPEC §9.2 จอ 10 · mockup FINAL `docs/mockup/dashboard-sync.html`)
 *
 * Logic summary:
 *   * เฉพาะ host — ด่าน middleware (กลุ่ม /admin) + ตรวจซ้ำที่นี่ · ปุ่ม "ส่งตอนนี้" เรียก POST /api/dashboard/sync
 *     ซึ่งตรวจ host ซ้ำที่เซิร์ฟเวอร์และ DB (start_sync_log) · อ่านประวัติจาก `sync_logs` ผ่าน RLS (host เท่านั้น)
 *   * ส่งให้ client แค่ true/false ว่าตั้ง DASHBOARD_GITHUB_TOKEN แล้วหรือยัง — ไม่ส่งค่า token
 *   * อ่านประวัติไม่ได้ = หน้าแจ้งข้อผิดพลาด (ไม่แสดงเหมือนยังไม่เคยส่ง)
 */
import { redirect } from "next/navigation";

import { DashboardSyncClient } from "@/components/dashboard-sync/DashboardSyncClient";
import { destinationFromEnv, isTokenConfigured, loadSyncLogs } from "@/components/dashboard-sync/syncData";
import { canTriggerSync } from "@/components/dashboard-sync/syncLogic";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardSyncPage() {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/admin/dashboard-sync")) redirect(homeForRole(profile.role));

  const { data } = await loadSyncLogs(await createClient());
  if (!data) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านประวัติการส่งไม่ได้">
          โหลดประวัติการส่งข้อมูลเข้า Dashboard ไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลฐานข้อมูล (ตรวจตาราง sync_logs)
        </Alert>
      </div>
    );
  }

  const dest = destinationFromEnv();
  return (
    <div className="p-4 max-[640px]:p-3">
      <DashboardSyncClient
        logs={data}
        tokenConfigured={isTokenConfigured()}
        nowIso={new Date().toISOString()}
        canTrigger={canTriggerSync(profile.role)}
        repo={dest.repo}
        branch={dest.branch}
      />
    </div>
  );
}
