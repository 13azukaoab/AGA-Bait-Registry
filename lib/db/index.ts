/**
 * ชั้นอ่าน/เขียนฐานข้อมูล (lib/db)
 *
 * กฎของชั้นนี้:
 *   * รับ Supabase client เข้ามาเป็นพารามิเตอร์ ไม่สร้าง client เอง — ผู้เรียกเป็นคนเลือกว่า
 *     ใช้ client ฝั่ง server (`lib/supabase/server`) หรือฝั่ง browser (`lib/supabase/client`)
 *   * **ไม่ใช้ `SUPABASE_SERVICE_ROLE_KEY`** ทุกคำสั่งวิ่งผ่าน RLS ของผู้ใช้จริง (SPEC §5)
 *   * แปลง snake_case ของฐานข้อมูลเป็น camelCase ให้โค้ดฝั่งแอป
 */
export { fetchProfileByUserId } from "./profiles";
export type { AppProfile, Division, UserRole } from "./types";
