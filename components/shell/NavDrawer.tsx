"use client";

import { forwardRef } from "react";
import { cx } from "./cx";
import { NavLinks } from "./NavLinks";
import styles from "./shell.module.css";
import type { Role } from "./types";

type NavDrawerProps = {
  role: Role;
  currentPath: string;
  /** จอเล็ก: ลิ้นชักเปิดอยู่หรือไม่ (จอกว้างเมนูแสดงตลอด ไม่สนค่านี้) */
  open: boolean;
  onClose: () => void;
  /** id ของ <nav> — ปุ่ม ☰ ใช้อ้างด้วย aria-controls */
  id: string;
};

/**
 * เมนูซ้าย
 * - จอกว้าง (≥861px): ติดที่ใต้แถบบน ยาวเต็มความสูง เลื่อนเองได้ถ้าเมนูยาว
 * - จอเล็ก (≤860px): เป็นลิ้นชักเลื่อนจากซ้าย + ฉากหลังทึบ (กดฉากหลังเพื่อปิด)
 *   ตอนปิดอยู่ใช้ `invisible` เพื่อให้ Tab ไม่เข้าไปโฟกัสเมนูที่มองไม่เห็น
 */
export const NavDrawer = forwardRef<HTMLElement, NavDrawerProps>(
  function NavDrawer({ role, currentPath, open, onClose, id }, ref) {
    return (
      <>
        <nav
          ref={ref}
          id={id}
          aria-label="เมนูหลัก"
          className={cx(
            "w-[238px] shrink-0 overflow-y-auto border-r border-border bg-surface px-2.5 py-3.5",
            "min-[861px]:sticky min-[861px]:top-[var(--topbar-h)] min-[861px]:h-[calc(100dvh-var(--topbar-h))]",
            "max-[860px]:fixed max-[860px]:inset-y-0 max-[860px]:left-0 max-[860px]:z-40 max-[860px]:w-[260px] max-[860px]:shadow-xl",
            "max-[860px]:transition-[transform,visibility] max-[860px]:duration-200 max-[860px]:ease-out motion-reduce:transition-none",
            open
              ? "max-[860px]:translate-x-0"
              : "max-[860px]:invisible max-[860px]:-translate-x-full",
          )}
        >
          <NavLinks role={role} currentPath={currentPath} onNavigate={onClose} />
        </nav>
        {open ? (
          <div
            aria-hidden="true"
            onClick={onClose}
            className={cx(
              styles.scrim,
              "fixed inset-0 z-30 min-[861px]:hidden",
            )}
          />
        ) : null}
      </>
    );
  },
);
