/*
 * โครงหน้าของทุกหน้าที่ต้องล็อกอิน (กลุ่ม app)
 *
 * - **ตำแหน่งมาจาก session จริง**: อ่านโปรไฟล์ฝั่ง server แล้วส่งเข้า <AppShell role={…}>
 *   (`requireProfile` เด้งไปหน้าเข้าสู่ระบบถ้าไม่ได้ล็อกอิน — เป็นด่านสำรองของ middleware.ts)
 * - การซ่อนเมนูไม่ใช่ระบบความปลอดภัย: ด่านจริงคือ RLS ในฐานข้อมูล (SPEC §5)
 *   และการตรวจเส้นทางใน `middleware.ts`
 * - รายการเดือนใน dropdown: เดือนปัจจุบัน ย้อนถึง `go_live_month()` (M25) — อ่านไม่ได้ = เดือนปัจจุบันเดือนเดียว
 */
import type { ReactNode } from "react";

import { AppShell, ThemeScript } from "@/components/shell";
import { LOGOUT_PATH } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { loadShellMonths } from "@/lib/service/shellMonths";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireProfile();
  const months = await loadShellMonths(await createClient());

  return (
    <>
      <ThemeScript />
      <AppShell role={profile.role} months={months} logoutHref={LOGOUT_PATH}>
        {children}
      </AppShell>
    </>
  );
}
