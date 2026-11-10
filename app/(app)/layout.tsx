import type { ReactNode } from "react";
import {
  AppShell,
  ThemeScript,
  type MonthOption,
  type Role,
} from "@/components/shell";

/*
 * ⚠ ค่าชั่วคราวทั้งหมดในไฟล์นี้ — รอหมวด BE ต่อของจริง
 *
 * - ยังไม่มีระบบ login: ตำแหน่งด้านล่างเป็นค่าสมมติ ไม่ได้มาจาก session
 *   (BE จะอ่านตำแหน่งจริงฝั่ง server แล้วส่งเข้า <AppShell role={…}>)
 * - `allowRoleSwitch` เปิดตัวสลับบทบาทใน Topbar ให้ลองดูหน้าตาเมนู —
 *   BE ต้องลบบรรทัดนี้ออกตอนต่อ login จริง
 * - การซ่อนเมนูไม่ใช่ระบบความปลอดภัย: ของจริงบังคับที่ฐานข้อมูลด้วย RLS (SPEC §5)
 *   และฝั่ง server ของแต่ละหน้า
 * - รายการเดือนเป็นข้อมูลสมมติ (ยังไม่ได้ดึงจาก month_closures / visits)
 */
const TEMP_ROLE: Role = "host";

const TEMP_MONTHS: readonly MonthOption[] = [
  { value: "2026-10", label: "ตุลาคม 2026" },
  { value: "2026-09", label: "กันยายน 2026" },
  { value: "2026-08", label: "สิงหาคม 2026" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ThemeScript />
      <AppShell
        role={TEMP_ROLE}
        allowRoleSwitch
        months={TEMP_MONTHS}
        logoutHref="/login"
      >
        {children}
      </AppShell>
    </>
  );
}
