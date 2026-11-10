/**
 * หัวหน้าของหน้า public (/summary) — โลโก้ AGA + ชื่อหน้า + สลับธีม + ลิงก์เข้าสู่ระบบ
 * ไม่ใช้ AppShell (ต้องมี session) เพราะผู้ชมทั่วไปไม่ต้องล็อกอิน
 */
import Link from "next/link";

import { ThemeToggle } from "@/components/shell/ThemeToggle";

import styles from "./summary.module.css";

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-2 min-[601px]:px-6 max-[600px]:gap-2">
        <span
          role="img"
          aria-label="Advance Group Asia (AGA)"
          className={`${styles.logo} h-[38px] w-[76px] shrink-0 max-[600px]:h-8 max-[600px]:w-16`}
        />
        <div className="min-w-0 flex-1 border-l border-border pl-3 max-[600px]:pl-2">
          <b className="block truncate text-[14.5px] leading-tight font-semibold text-fg max-[600px]:text-[13px]">
            Dashboard สรุปมูลค่าระบบเหยื่อ
          </b>
          <span className="block truncate text-[11.5px] text-fg-muted max-[420px]:hidden">
            Advance Group Asia (AGA)
          </span>
        </div>
        <ThemeToggle />
        <Link
          href="/login"
          className="inline-flex h-[34px] shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 px-2.5 text-[13px] text-fg no-underline hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          เข้าสู่ระบบ
        </Link>
      </div>
    </header>
  );
}
