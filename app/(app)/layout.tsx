/*
 * โครงหน้าของทุกหน้าที่ต้องล็อกอิน (กลุ่ม app)
 *
 * - **ตำแหน่งมาจาก session จริง**: อ่านโปรไฟล์ฝั่ง server แล้วส่งให้ <AppShellFrame>
 *   (ตัวประกอบ AppShell ที่ใช้ร่วมกับหน้า /summary — ดู components/shell/AppShellFrame.tsx)
 *   (`requireProfile` เด้งไปหน้าเข้าสู่ระบบถ้าไม่ได้ล็อกอิน — เป็นด่านสำรองของ middleware.ts)
 * - การซ่อนเมนูไม่ใช่ระบบความปลอดภัย: ด่านจริงคือ RLS ในฐานข้อมูล (SPEC §5)
 *   และการตรวจเส้นทางใน `middleware.ts`
 */
import type { ReactNode } from "react";

import { AppShellFrame } from "@/components/shell/AppShellFrame";
import { requireProfile } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireProfile();
  return <AppShellFrame profile={profile}>{children}</AppShellFrame>;
}
