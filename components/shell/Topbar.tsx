"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { TutorialButton } from "@/components/tutorial";
import { cx } from "./cx";
import { MenuToggle } from "./MenuToggle";
import styles from "./shell.module.css";
import { ThemeToggle } from "./ThemeToggle";
import { ROLE_LABELS, ROLES, type MonthOption, type Role } from "./types";

type TopbarProps = {
  /** id ของเมนูซ้าย ใช้กับ aria-controls ของปุ่ม ☰ (จอเล็ก) */
  navId: string;
  /** จอเล็ก: ลิ้นชักเปิดอยู่หรือไม่ */
  navOpen: boolean;
  onToggleNav: () => void;
  months: readonly MonthOption[];
  month: string;
  onMonthChange: (value: string) => void;
  role: Role;
  /** ตัวสลับบทบาท (ชั่วคราว) — แสดงเมื่อส่ง onRoleChange เข้ามาเท่านั้น */
  onRoleChange?: (role: Role) => void;
  /** ปลายทางของปุ่มออกจากระบบ (ตอนนี้ลิงก์ไปหน้า login · ของจริงรอหมวด BE) */
  logoutHref: string;
};

const selectClass =
  "h-[34px] min-w-0 cursor-pointer rounded-lg border border-border-strong bg-surface px-2 text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * แถบบน: โลโก้ AGA ซ้าย (จอเล็ก ≤860px มีปุ่ม ☰ ไอคอนล้วนนำหน้า · จอกว้างปุ่มย้ายไปบนสุดของเมนูซ้าย) · ขวา = เดือน / บทบาท (ชั่วคราว) / ธีม / ออกจากระบบ
 * จอ ≤600px: กลุ่มเดือน+บทบาทขึ้นบรรทัดที่สอง เพื่อไม่ให้ล้นจอ 375px
 */
export const Topbar = forwardRef<HTMLButtonElement, TopbarProps>(function Topbar(
  {
    navId,
    navOpen,
    onToggleNav,
    months,
    month,
    onMonthChange,
    role,
    onRoleChange,
    logoutHref,
  },
  toggleRef,
) {
  return (
    <header className="sticky top-0 z-20 flex min-h-[var(--topbar-h)] flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-[18px] py-[9px] max-[600px]:gap-x-2 max-[600px]:px-3 max-[600px]:py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3 max-[600px]:gap-2">
        {/* จอเล็ก (≤860px) เท่านั้น: ปุ่มเปิด/ปิดลิ้นชัก · จอกว้างปุ่มอยู่บนสุดของเมนูซ้าย (NavDrawer) */}
        <MenuToggle
          ref={toggleRef}
          navId={navId}
          label={navOpen ? "ปิดเมนู" : "เปิดเมนู"}
          expanded={navOpen}
          onClick={onToggleNav}
          className="min-[861px]:hidden max-[600px]:min-h-11 max-[600px]:min-w-11"
        />
        <Link
          href="/todo"
          className="flex min-w-0 items-center gap-3 rounded-lg text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent max-[600px]:gap-[9px]"
        >
          <span
            role="img"
            aria-label="Advance Group Asia (AGA)"
            className={cx(
              styles.logo,
              "-my-[5px] h-12 w-[94px] shrink-0 max-[600px]:-my-1 max-[600px]:h-10 max-[600px]:w-[78px]",
            )}
          />
          <span className="min-w-0 border-l border-border pl-3 max-[600px]:pl-[9px] max-[420px]:hidden">
            <b className="block truncate text-[14.5px] leading-tight font-semibold text-fg max-[600px]:text-[13.5px]">
              ข้อมูลหลังบ้านระบบเหยื่อ
            </b>
            <span className="block text-[11.5px] text-fg-muted max-[600px]:hidden">
              ส่วนกลาง
            </span>
          </span>
        </Link>
      </div>

      {/* เดือน + บทบาท: จอเล็กขึ้นบรรทัดใหม่เต็มความกว้าง (order-1 + basis-full) */}
      <div className="flex min-w-0 items-center gap-2 max-[600px]:order-1 max-[600px]:basis-full">
        <label className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted max-[600px]:flex-1">
          <span className="shrink-0">เดือน</span>
          <select
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            className={cx(selectClass, "max-[600px]:min-w-0 max-[600px]:flex-1")}
          >
            {months.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {onRoleChange ? (
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted max-[600px]:flex-1">
            <span className="shrink-0">ดูในมุมของ</span>
            <select
              value={role}
              onChange={(event) => onRoleChange(event.target.value as Role)}
              className={cx(selectClass, "max-[600px]:min-w-0 max-[600px]:flex-1")}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <span className="shrink-0 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn max-[600px]:hidden">
              ทดลอง
            </span>
          </label>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <TutorialButton />
        <ThemeToggle />
        {/* เปลี่ยนรหัสผ่านเอง (หน้า /change-password รองรับกรณีไม่ถูกบังคับ) */}
        <Link
          href="/change-password"
          aria-label="เปลี่ยนรหัสผ่าน"
          title="เปลี่ยนรหัสผ่าน"
          className="inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-[13px] text-fg no-underline hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-[600px]:min-h-11 max-[600px]:min-w-11"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="8" cy="15" r="4" />
            <path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" />
          </svg>
          <span className="max-[860px]:hidden">เปลี่ยนรหัสผ่าน</span>
        </Link>
        <Link
          href={logoutHref}
          aria-label="ออกจากระบบ"
          title="ออกจากระบบ"
          className="inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-[13px] text-fg no-underline hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ⏻
          </span>
          <span className="max-[600px]:hidden">ออกจากระบบ</span>
        </Link>
      </div>
    </header>
  );
});
