/**
 * คลาสสีของ New / Renew ที่ใช้ร่วมทั้งหน้า Dashboard งานขาย
 *
 * - New = สีน้ำเงิน (token `accent`) · Renew = สีม่วง token `--renew` / `--renew-soft` (เพิ่มใน app/globals.css · light/dark)
 * - ต่อสัญญาล่าช้า = สีแดง (token `danger`) — ต้องมีข้อความ/ไอคอนกำกับเสมอ ไม่ใช้สีอย่างเดียว
 * - คลาส Tailwind ต้องเป็นสตริงเต็ม (ไม่ประกอบสตริง) เพื่อให้ Tailwind สแกนเจอ
 */
export const NEW_BG = "bg-accent";
export const NEW_TEXT = "text-accent";
export const NEW_SOFT = "bg-accent-soft";
export const NEW_BORDER_L = "border-l-accent";
export const NEW_RING = "ring-accent";

export const RENEW_BG = "bg-[var(--renew)]";
export const RENEW_TEXT = "text-[var(--renew)]";
export const RENEW_SOFT = "bg-[var(--renew-soft)]";
export const RENEW_BORDER_L = "border-l-[var(--renew)]";
export const RENEW_RING = "ring-[var(--renew)]";

/** ช่องกรอก/ตัวเลือก: สูง ≥44px และตัวหนังสือ 16px บนจอ ≤767px (กัน iOS ซูม) */
export const FIELD_CLASS =
  "min-h-10 w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[14px] text-fg max-[767px]:min-h-11 max-[767px]:text-base";

export const CARD_CLASS = "rounded-[10px] border border-border bg-surface p-4 shadow-[var(--shadow)]";
