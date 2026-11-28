/**
 * AppShellFrame — ตัวประกอบกรอบระบบ (AppShell) ฝั่ง server ที่ใช้ร่วมกัน
 *
 * Logic summary:
 *   * รับโปรไฟล์ที่ตรวจแล้วจากผู้เรียก → อ่านรายการเดือนของ dropdown (`go_live_month()`)
 *     → ประกอบ <ThemeScript> + <AppShell role months userLabel logoutHref>
 *   * ผู้ใช้ 2 ที่: `app/(app)/layout.tsx` (ทุกหน้าที่ต้องล็อกอิน) และ `app/(public)/summary/page.tsx`
 *     (ล็อกอินอยู่ = แสดงในกรอบ · ไม่ล็อกอิน = หน้าสาธารณะ) — ห้ามคัดลอกโค้ดนี้ไปไว้ที่อื่น
 *   * ส่งเฉพาะข้อความ (ชื่อ/ตำแหน่งสั้น) ไปฝั่ง client ไม่ส่งทั้งโปรไฟล์
 *   * การซ่อนเมนูไม่ใช่ระบบความปลอดภัย: ด่านจริงคือ RLS (SPEC §5) และ middleware.ts
 */
import type { ReactNode } from "react";

import { LOGOUT_PATH } from "@/lib/auth/access";
import type { AppProfile } from "@/lib/db";
import { loadShellMonths } from "@/lib/service/shellMonths";
import { createClient } from "@/lib/supabase/server";

import { AppShell } from "./AppShell";
import { ThemeScript } from "./ThemeScript";
import { userLabel } from "./userLabel";

export async function AppShellFrame({ profile, children }: { profile: AppProfile; children: ReactNode }) {
  const months = await loadShellMonths(await createClient());

  return (
    <>
      <ThemeScript />
      <AppShell
        role={profile.role}
        months={months}
        logoutHref={LOGOUT_PATH}
        userLabel={userLabel({
          displayName: profile.displayName,
          positionShortName: profile.positionShortName,
          username: profile.username,
        })}
      >
        {children}
      </AppShell>
    </>
  );
}
