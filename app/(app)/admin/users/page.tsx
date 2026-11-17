/**
 * /admin/users — จัดการผู้ใช้ (SPEC §8 จอ 11 · mockup FINAL `docs/mockup/admin-user-management.html`)
 *
 * Logic summary:
 *   * เฉพาะ host (PM / OM / เจ้าของ) — ด่านที่ middleware.ts จากตารางเมนู · ที่นี่ตรวจซ้ำเป็นด่านสำรอง
 *     และ server action ทุกตัวตรวจ host ซ้ำอีกรอบ (components/admin/hostGuard.ts)
 *   * server อ่านบัญชี + ตำแหน่งด้วย client ของผู้ใช้จริง (RLS) แล้วส่งให้ `UsersClient`
 *   * อ่านไม่ได้ = หน้าแจ้งข้อผิดพลาดชัดๆ ไม่แสดงรายการว่าง
 */
import { redirect } from "next/navigation";

import { UsersClient } from "@/components/admin/UsersClient";
import { loadUsersPage } from "@/components/admin/userData";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/admin/users")) redirect(homeForRole(profile.role));

  const { users, positions, error } = await loadUsersPage(await createClient());
  if (error) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านรายชื่อผู้ใช้ไม่ได้">
          โหลดรายชื่อบัญชีหรือตำแหน่งไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลฐานข้อมูล
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 max-[640px]:p-3">
      <UsersClient users={users} positions={positions} currentUserId={profile.userId} />
    </div>
  );
}
