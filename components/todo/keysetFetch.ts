/**
 * ดึงข้อมูลให้ "ครบทุกแถว" ด้วย keyset (pure · ทดสอบได้ตรงๆ) — ใช้กับ /todo
 *
 * Logic summary:
 *   * PostgREST ตัดผลที่ `max_rows` (= 1,000 ใน supabase/config.toml) เงียบๆ — query ที่ไม่แบ่งหน้าจึงได้แค่ 1,000 แถวแรกแบบไม่เรียง
 *     (บั๊ก B1: การ์ด "ลูกค้ารอเก็บสถานี" นับต่ำกว่าจริงเมื่อมีสัญญาที่มี IG ค้างเกิน 1,000)
 *   * `fetchAllKeyset`: ขอทีละก้อน ≤ pageSize แถว เรียงตามคีย์ แล้วขอก้อนถัดไปด้วย "คีย์ > คีย์สุดท้าย" วนจนก้อนที่ได้น้อยกว่า pageSize
 *     (keyset ไม่ซ้ำ/ไม่ข้ามแม้มีการเพิ่ม/ลบแถวระหว่างอ่าน ต่างจาก offset)
 *   * กันวนไม่รู้จบ: เกิน maxPages ก้อน → หยุดและคืน `truncated = true` ให้ผู้เรียกแจ้งผู้ใช้ (ห้ามตัดเงียบ)
 *   * ก้อนที่ไม่เดินหน้า (คีย์สุดท้ายไม่มากกว่าเดิม) → หยุดกันวนซ้ำ + `truncated = true`
 *   * error จากก้อนใดก็ตาม → คืน error ทันที (ไม่คืนข้อมูลบางส่วนเป็นข้อมูลครบ)
 */
export interface KeysetPageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface KeysetOptions {
  /** ขนาดก้อน ต้อง ≤ max_rows ของ PostgREST (1,000) */
  pageSize?: number;
  /** เพดานจำนวนก้อน (กันวนไม่รู้จบ) */
  maxPages?: number;
}

export const KEYSET_PAGE_SIZE = 1000;
export const KEYSET_MAX_PAGES = 200;

export async function fetchAllKeyset<T>(
  fetchPage: (afterKey: string | null) => PromiseLike<KeysetPageResult<T>>,
  keyOf: (row: T) => string,
  options: KeysetOptions = {},
): Promise<{ rows: T[]; error: string | null; truncated: boolean }> {
  const pageSize = options.pageSize ?? KEYSET_PAGE_SIZE;
  const maxPages = options.maxPages ?? KEYSET_MAX_PAGES;
  const rows: T[] = [];
  let after: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const res: KeysetPageResult<T> = await fetchPage(after);
    if (res.error) return { rows: [], error: res.error.message, truncated: false };
    const batch = res.data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, error: null, truncated: false };
    const last = keyOf(batch[batch.length - 1] as T);
    if (after !== null && last <= after) return { rows, error: null, truncated: true };
    after = last;
  }
  return { rows, error: null, truncated: true };
}
