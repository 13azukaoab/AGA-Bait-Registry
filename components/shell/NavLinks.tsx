"use client";

import Link from "next/link";
import { cx } from "./cx";
import {
  NAV_GROUPS,
  filterNavForRole,
  isActivePath,
  type NavGroup,
} from "./nav-items";
import type { Role } from "./types";

type NavLinksProps = {
  /** ตำแหน่งของผู้ใช้ — รับเป็น prop เท่านั้น (ห้ามอ่าน session ที่นี่) */
  role: Role;
  /** path ปัจจุบัน (จาก usePathname) — ลิงก์ที่ตรงจะได้ aria-current="page" */
  currentPath: string;
  /** เรียกเมื่อกดลิงก์ (ใช้ปิดลิ้นชักบนจอเล็ก) */
  onNavigate?: () => void;
  /** ทดสอบ/ต่อยอด: ใช้ชุดเมนูอื่นแทนค่าเริ่มต้น */
  groups?: readonly NavGroup[];
};

/**
 * รายการเมนู 3 กลุ่มตามสิทธิ์
 * เมนูที่ role นี้ไม่เห็น "ไม่ถูกวาดออกมาเลย" และหัวกลุ่มที่ไม่เหลือเมนูหายไปด้วย
 * ⚠ นี่ไม่ใช่ระบบความปลอดภัย — ของจริงบังคับที่ฐานข้อมูลด้วย RLS
 */
export function NavLinks({
  role,
  currentPath,
  onNavigate,
  groups = NAV_GROUPS,
}: NavLinksProps) {
  const visibleGroups = filterNavForRole(groups, role);

  return (
    <>
      {visibleGroups.map((group) => {
        const headingId = `nav-group-${group.key}`;
        return (
          <div key={group.key} role="group" aria-labelledby={headingId}>
            <p
              id={headingId}
              className="px-2.5 pt-3 pb-[5px] text-[11px] tracking-[0.06em] text-fg-faint"
            >
              {group.title}
            </p>
            {group.items.map((item) => {
              const active = isActivePath(item.href, currentPath);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "mb-px flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] leading-snug no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    active
                      ? "bg-accent-soft font-semibold text-accent-strong"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="w-[17px] shrink-0 text-center opacity-85"
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0">{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
