"use client";

import { forwardRef } from "react";
import { cx } from "./cx";
import styles from "./shell.module.css";

type MenuToggleProps = {
  /** id ของเมนูซ้าย ใช้กับ aria-controls */
  navId: string;
  /** ข้อความอ่านออกเสียง/tooltip (ภาษาไทย) — ตัวหนังสือ MENU ที่เห็นเป็นแค่ตกแต่ง (aria-hidden) */
  label: string;
  onClick: () => void;
  /** จอกว้าง: ปุ่มสลับ ย่อ/ขยาย → aria-pressed */
  pressed?: boolean;
  /** จอเล็ก: ปุ่มเปิด/ปิดลิ้นชัก → aria-expanded */
  expanded?: boolean;
  /** แสดง tooltip (title) หรือไม่ — ใช้กับปุ่มจอกว้างที่เป็นไอคอนล้วน */
  showTitle?: boolean;
  /** จอกว้างบนสุดของเมนูซ้าย: แสดงคำว่า MENU ต่อท้ายไอคอนตอนเมนูขยาย (ตอนย่อ 58px เหลือไอคอนล้วน — คุมด้วย CSS ใน shell.module.css) */
  withText?: boolean;
  className?: string;
};

/**
 * ปุ่มเมนู ☰ (พื้นเข้ม bg-fg / ตัว text-bg) — แถบบนจอเล็กเป็นไอคอนล้วน · ในเมนูซ้ายมีคำว่า MENU ตอนเมนูขยาย
 * ใช้ 2 ที่: แถบบน (จอ ≤860px) และบนสุดของเมนูซ้าย (จอ ≥861px)
 * ที่ที่ไม่ใช้จะถูกซ่อนด้วย display:none ผ่าน className → ไม่ซ้ำใน accessibility tree
 */
export const MenuToggle = forwardRef<HTMLButtonElement, MenuToggleProps>(
  function MenuToggle(
    { navId, label, onClick, pressed, expanded, showTitle, withText, className },
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
          withText && styles.menuToggleNav,
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
        {withText ? (
          <span
            aria-hidden="true"
            className={cx(
              styles.menuToggleText,
              "overflow-hidden text-[12.5px] leading-none font-semibold tracking-[0.04em] whitespace-nowrap",
            )}
          >
            MENU
          </span>
        ) : null}
      </button>
    );
  },
);
