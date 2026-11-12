/**
 * class ของ Tailwind ที่ใช้ซ้ำในหน้ากรอกข้อมูลทำบริการ — อ้าง token ใน app/globals.css เท่านั้น ห้าม hex
 * (สีส้ม "ไม่ได้ตรวจ" ใช้ token --tier-xl* ที่เป็นสีส้มของระบบ ผ่าน var())
 */
export const INPUT =
  "w-full min-w-0 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60";

/** กรอบแดงเมื่อช่องขาด/ผิด (ใช้ต่อท้าย INPUT) */
export const INVALID = "border-danger bg-danger-soft";

export const LABEL = "text-[11px] text-fg-muted";

export const SECTION = "rounded-xl border border-border bg-surface p-3.5";
export const SECTION_TITLE = "m-0 text-[14px] font-semibold text-fg";

export const HINT = "m-0 mt-1.5 text-[11.5px] text-fg-muted";
export const ERROR_TEXT = "m-0 text-[11.5px] text-danger";

/** ป้าย "ไม่ได้ตรวจ" สีส้ม (DECISIONS: แดงใช้เฉพาะขาด/ผิด) */
export const CHIP_UNCHECKED =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] " +
  "bg-[var(--tier-xl-soft)] text-[var(--tier-xl)]";

/** ชิป "ปลวกใต้ดิน" สีฟ้า (DECISIONS 2.13) */
export const CHIP_SUBTERRANEAN =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] bg-accent-soft text-accent-strong";

export const STATION_TYPE_TAG =
  "inline-block rounded bg-surface-3 px-1.5 py-px text-[11px] font-semibold text-fg-muted";
