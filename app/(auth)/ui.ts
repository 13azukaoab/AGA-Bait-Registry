/**
 * class ของชิ้นส่วนฟอร์มในกลุ่ม auth — รวมไว้ที่เดียวเพื่อให้หน้าเข้าสู่ระบบกับ
 * หน้าเปลี่ยนรหัสผ่านหน้าตาตรงกัน (ยึดตาม docs/mockup/login.html)
 *
 * ห้ามใส่รหัสสี hex — ใช้ class ของ Tailwind ที่ผูกกับ token ใน app/globals.css เท่านั้น
 * (ชิ้นส่วนกลางของโครงการอยู่ที่ `components/ui/**` ซึ่งเป็นงานของหมวด Frontend —
 *  เมื่อมีชิ้นส่วนปุ่ม/ช่องกรอกที่นั่นแล้ว ให้ย้ายมาใช้ของกลางและลบไฟล์นี้)
 */

export const FIELD_WRAP = "flex flex-col gap-1.5";

export const FIELD_LABEL = "text-[13px] font-medium text-fg";

export const FIELD_INPUT =
  "w-full rounded-[8px] border border-border bg-surface px-3 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-faint hover:border-fg-faint focus:border-accent focus:ring-[3px] focus:ring-accent-soft";

export const FIELD_INPUT_ERROR = "border-danger bg-danger-soft";

export const FIELD_HINT = "text-[12px] text-fg-faint";

export const PRIMARY_BUTTON =
  "w-full rounded-[8px] bg-accent px-3 py-2.5 text-[15px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60";

export const SECONDARY_BUTTON =
  "w-full rounded-[8px] border border-border bg-surface px-3 py-2.5 text-[15px] font-medium text-fg transition-colors hover:border-fg-faint";

export const ALERT_DANGER =
  "rounded-[8px] border border-danger bg-danger-soft px-3 py-2.5 text-[13px] leading-relaxed text-fg";

export const ALERT_INFO =
  "rounded-[8px] border border-border bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-fg-muted";

export const PAGE_TITLE = "text-center text-[18px] font-bold text-fg";

export const PAGE_HELP = "text-center text-[12px] leading-relaxed text-fg-muted";
