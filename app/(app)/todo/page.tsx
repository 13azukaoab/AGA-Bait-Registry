/**
 * /todo — สถานะทะเบียนบริการ (หน้าแรกหลัง login · SPEC §8 ข้อ 2 · mockup FINAL `#todo`)
 *
 * Logic summary:
 *   * สิทธิ์เข้าหน้า = host, recorder (ด่านที่ middleware จากตารางเมนู · ที่นี่เช็กซ้ำเป็นด่านสำรอง)
 *   * server โหลดข้อมูลทั้งหมดด้วย Supabase client ของผู้ใช้จริง (RLS · ไม่ใช้ service role) ผ่าน components/todo/data.ts
 *   * อ่านพลาด = แสดงข้อความผิดพลาดชัดเจน ไม่แสดงตัวเลขสมมติ
 *   * ส่วนโต้ตอบ (ไม่ชดเชย / เปิดเรื่องกลับ / กล่องเตือนเดือนค้าง) อยู่ใน components/todo/TodoClient.tsx
 */
import { redirect } from "next/navigation";

import { loadTodo } from "@/components/todo/data";
import { TodoClient } from "@/components/todo/TodoClient";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TodoPage() {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/todo")) redirect(homeForRole(profile.role));

  const supabase = await createClient();
  const { data, error } = await loadTodo(supabase);

  if (!data || error) {
    console.error("[todo] load error", error);
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านข้อมูลหน้านี้ไม่ได้">
          โหลดสถานะทะเบียนบริการไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
        </Alert>
      </div>
    );
  }

  return <TodoClient data={data} role={profile.role} />;
}
