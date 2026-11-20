/**
 * ความสูง Topbar จริง → ตัวแปร `--topbar-h` ของทั้งแอป
 *
 * Logic summary:
 *   * AppShell วัดความสูง <header> จริงด้วย ResizeObserver (บนมือถือ Topbar พับเป็น 2 แถว สูง ~103px ไม่ใช่ 57px)
 *     แล้วตั้ง `--topbar-h` บน element ครอบทั้งแอป — ทุกที่ที่ติดใต้ Topbar (เมนูซ้าย, แถบ sticky, scroll-mt) อ่านตัวแปรนี้ตัวเดียว
 *   * 57px = ค่าเริ่มต้นก่อนวัดเสร็จ (และเมื่อวัดไม่ได้) · ห้ามให้ <header> ใช้ min-h จาก `--topbar-h` (จะไม่หดกลับเมื่อจอกว้างขึ้น)
 */
export const DEFAULT_TOPBAR_HEIGHT = 57;

/** ค่าที่วัดได้ → px ที่ใช้ตั้งตัวแปร · วัดไม่ได้/ไม่สมเหตุสมผล (0, ติดลบ, NaN) → null = คงค่าเดิม */
export function topbarHeightPx(measured: number): number | null {
  if (!Number.isFinite(measured) || measured <= 0) return null;
  return Math.round(measured);
}
