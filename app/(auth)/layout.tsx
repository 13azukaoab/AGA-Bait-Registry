/**
 * โครงหน้าของกลุ่ม auth — การ์ดกลางจอ มีโลโก้ AGA และปุ่มสลับธีมมุมขวาบน
 * (ยึดหน้าตาตาม docs/mockup/login.html · ไม่มีเมนูซ้าย เพราะยังไม่รู้สิทธิ์ของผู้ใช้)
 */
import type { ReactNode } from "react";

import { ThemeScript, ThemeToggle } from "@/components/shell";

import styles from "./auth.module.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ThemeScript />
      <div className="flex min-h-full flex-col bg-bg">
        <div className="flex justify-end p-3">
          <ThemeToggle />
        </div>

        <main className="flex flex-1 items-start justify-center px-4 pb-10">
          <div className="w-full max-w-[380px] rounded-card border border-border bg-surface p-6 shadow-sm">
            <div className="mb-5 flex flex-col items-center gap-2 text-center">
              <div
                className={`${styles.logo} h-[89px] w-[176px]`}
                role="img"
                aria-label="Advance Group Asia (AGA)"
              />
              <p className="text-[13px] text-fg-muted">ระบบทะเบียนบริการ Bait</p>
            </div>
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
