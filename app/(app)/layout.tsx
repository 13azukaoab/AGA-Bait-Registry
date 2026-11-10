/*
 * โครงหน้าของทุกหน้าที่ต้องล็อกอิน (กลุ่ม app)
 *
 * - **ตำแหน่งมาจาก session จริง**: อ่านโปรไฟล์ฝั่ง server แล้วส่งเข้า <AppShell role={…}>
 *   (`requireProfile` เด้งไปหน้าเข้าสู่ระบบถ้าไม่ได้ล็อกอิน — เป็นด่านสำรองของ middleware.ts)
 * - การซ่อนเมนูไม่ใช่ระบบความปลอดภัย: ด่านจริงคือ RLS ในฐานข้อมูล (SPEC §5)
 *   และการตรวจเส้นทางใน `middleware.ts`
 * - ⚠ รายการเดือนยังเป็นข้อมูลสมมติ (ยังไม่ได้ดึงจาก month_closures / visits) — งานของหมวดอื่น
 */
import type { ReactNode } from "react";

import { AppShell, ThemeScript, type MonthOption } from "@/components/shell";
import { LOGOUT_PATH } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";

const TEMP_MONTHS: readonly MonthOption[] = [
  { value: "2026-10", label: "ตุลาคม 2026" },
  { value: "2026-09", label: "กันยายน 2026" },
  { value: "2026-08", label: "สิงหาคม 2026" },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireProfile();

  return (
    <>
      <ThemeScript />
      <AppShell role={profile.role} months={TEMP_MONTHS} logoutHref={LOGOUT_PATH}>
        {children}
      </AppShell>
    </>
  );
}
