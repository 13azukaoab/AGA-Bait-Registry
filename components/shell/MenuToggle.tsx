"use client";

import { forwardRef } from "react";
import { cx } from "./cx";

type MenuToggleProps = {
  /** id ของเมนูซ้าย ใช้กับ aria-controls */
  navId: string;
  /** ข้อความอ่านออกเสียง/tooltip (ภาษาไทย) — ปุ่มนี้ไม่มีตัวหนังสือ MENU */
  label: string;
  onClick: () => void;
  /** จอกว้าง: ปุ่มสลับ ย่อ/ขยาย → aria-pressed */
  pressed?: boolean;
  /** จอเล็ก: ปุ่มเปิด/ปิดลิ้นชัก → aria-expanded */
  expanded?: boolean;
  /** แสดง tooltip (title) หรือไม่ — ใช้กับปุ่มจอกว้างที่เป็นไอคอนล้วน */
  showTitle?: boolean;
  className?: string;
};

/**
 * ปุ่มเมนู ☰ แบบไอคอนล้วน (พื้นเข้ม bg-fg / ตัว text-bg)
 * ใช้ 2 ที่: แถบบน (จอ ≤860px) และบนสุดของเมนูซ้าย (จอ ≥861px)
 * ที่ที่ไม่ใช้จะถูกซ่อนด้วย display:none ผ่าน className → ไม่ซ้ำใน accessibility tree
 */
export const MenuToggle = forwardRef<HTMLButtonElement, MenuToggleProps>(
  function MenuToggle(
    { navId, label, onClick, pressed, expanded, showTitle, className },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-label={label}
        title={showTitle ? label : undefined}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-controls={navId}
        className={cx(
          "group inline-flex h-[34px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-fg p-0 text-bg transition-[box-shadow,transform] duration-150 hover:shadow-[0_0_14px_0_var(--border-strong)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none motion-reduce:active:scale-100",
          className,
        )}
      >
        <svg
          viewBox="0 0 80 75"
          width="16"
          height="15"
          aria-hidden="true"
          className="flex-none fill-current transition-transform duration-300 group-hover:scale-[1.08] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        >
          <rect width="80" height="15" rx="7.5" />
          <rect y="30" width="80" height="15" rx="7.5" />
          <rect y="60" width="80" height="15" rx="7.5" />
        </svg>
      </button>
    );
  },
);
