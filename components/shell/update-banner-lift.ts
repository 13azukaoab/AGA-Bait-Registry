/**
 * คำนวณระยะ bottom ของกล่องแจ้งเวอร์ชันใหม่ ให้ลอยเหนือแถบบันทึกที่ติดขอบล่าง (pure function ไม่แตะ DOM · มีเทส)
 *
 * แถบบันทึกที่ติดล่าง: ติด attribute `data-sticky-savebar` (หรือ class `sticky bottom-0` ที่หน้าเดิมใช้อยู่)
 * UpdateBanner วัดตำแหน่งแถบแล้วส่งมาที่นี่:
 *  - แถบต้องซ้อนทับกล่องในแนวนอน และอยู่ในหน้าจอ (ไม่ได้เลื่อนพ้นไป) จึงนับ
 *  - ผลลัพธ์ = ระยะจากขอบล่างจอถึงขอบล่างของกล่อง ที่ทำให้กล่องอยู่เหนือแถบ + ช่องว่างเล็กน้อย
 *  - ไม่มีแถบที่ทับ → คืน null (กล่องอยู่ตำแหน่งเดิมตาม CSS)
 */

export type Rect = { top: number; bottom: number; left: number; right: number };

/** ช่องว่างระหว่างกล่องกับแถบบันทึก (px) */
export const BANNER_BAR_GAP = 8;

export function computeBannerBottom(
  bars: readonly Rect[],
  bannerRect: Pick<Rect, "left" | "right">,
  viewportHeight: number,
  defaultBottom: number,
  gap: number = BANNER_BAR_GAP,
): number | null {
  let result: number | null = null;
  for (const bar of bars) {
    const inViewport = bar.bottom > 0 && bar.top < viewportHeight;
    const overlapsX = bar.left < bannerRect.right && bar.right > bannerRect.left;
    if (!inViewport || !overlapsX) continue;
    const needed = viewportHeight - bar.top + gap;
    // ถ้ากล่องอยู่เหนือแถบอยู่แล้ว (ตำแหน่งเดิมไม่ทับ) ไม่ต้องยก
    if (needed <= defaultBottom) continue;
    if (result === null || needed > result) result = needed;
  }
  return result;
}
