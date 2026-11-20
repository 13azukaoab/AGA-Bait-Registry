/**
 * คลาสสีของ New / Renew ที่ใช้ร่วมทั้งหน้า Dashboard งานขาย
 *
 * - New = สีน้ำเงิน (token `accent`) · Renew = สีม่วง token `--renew` / `--renew-soft`
 *   ⚠ ถ้า token ม่วงยังไม่อยู่ใน app/globals.css จะตกไปใช้สีส้มของ `--tier-xl` ชั่วคราว (ไม่ hardcode hex)
 *   เมื่อเพิ่ม `--renew` / `--renew-soft` ใน globals.css (light/dark) หน้านี้จะเป็นสีม่วงเองโดยไม่ต้องแก้โค้ด
 * - ต่อสัญญาล่าช้า = สีแดง (token `danger`) — ต้องมีข้อความ/ไอคอนกำกับเสมอ ไม่ใช้สีอย่างเดียว
 * - คลาส Tailwind ต้องเป็นสตริงเต็ม (ไม่ประกอบสตริง) เพื่อให้ Tailwind สแกนเจอ
 */
export const NEW_BG = "bg-accent";
export const NEW_TEXT = "text-accent";
export const NEW_SOFT = "bg-accent-soft";
export const NEW_BORDER_L = "border-l-accent";
export const NEW_RING = "ring-accent";

export const RENEW_BG = "bg-[var(--renew,var(--tier-xl))]";
export const RENEW_TEXT = "text-[var(--renew,var(--tier-xl))]";
export const RENEW_SOFT = "bg-[var(--renew-soft,var(--tier-xl-soft))]";
export const RENEW_BORDER_L = "border-l-[var(--renew,var(--tier-xl))]";
export const RENEW_RING = "ring-[var(--renew,var(--tier-xl))]";

/** ช่องกรอก/ตัวเลือก: สูง ≥44px และตัวหนังสือ 16px บนจอ ≤767px (กัน iOS ซูม) */
export const FIELD_CLASS =
  "min-h-10 w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[14px] text-fg max-[767px]:min-h-11 max-[767px]:text-base";

export const CARD_CLASS = "rounded-[10px] border border-border bg-surface p-4 shadow-[var(--shadow)]";
