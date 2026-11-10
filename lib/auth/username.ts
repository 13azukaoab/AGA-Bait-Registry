/**
 * ชื่อผู้ใช้ (username) ↔ อีเมลที่ Supabase Auth ต้องใช้
 *
 * ผู้ใช้พิมพ์แค่ username ไม่ต้องพิมพ์อีเมล (SPEC §5.1 · เจ้าของตัดสิน 10 พ.ย. 2026)
 * Supabase Auth บังคับให้ล็อกอินด้วยอีเมล ระบบจึงเติมโดเมน `@aga.local` ให้เบื้องหลัง
 *
 * ⚠ ประกอบอีเมล **ฝั่ง server เท่านั้น** (server action / route handler) —
 *   ฟอร์มฝั่ง browser ส่งไปแค่ username
 *
 * เป็น pure function ล้วน ไม่แตะ DB/คุกกี้ จึงทดสอบได้ตรงๆ (`username.test.ts`)
 */

/** โดเมนภายในที่ใช้ประกอบอีเมลให้ Supabase Auth — ไม่ใช่อีเมลจริงของผู้ใช้ */
export const AGA_EMAIL_DOMAIN = "aga.local";

/**
 * รูปแบบ username ที่ยอมรับ: a-z 0-9 . _ - ยาว 3–20 ตัว
 * ต้องตรงกับ constraint `profiles_username_format` ในฐานข้อมูล
 * (20261110090300_positions_and_profile_accounts.sql)
 */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,20}$/;

/**
 * จัดรูป username ที่ผู้ใช้พิมพ์มา: ตัดช่องว่างหัวท้าย + แปลงเป็นตัวพิมพ์เล็ก
 * (ฐานข้อมูลเก็บเป็นตัวพิมพ์เล็กเท่านั้น พิมพ์ใหญ่มาก็ยังเข้าได้)
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** ตรวจรูปแบบ username — ใช้คัดทิ้งก่อนยิง Supabase Auth เพื่อไม่ให้เปลืองคำขอ */
export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

/**
 * ประกอบอีเมลสำหรับ Supabase Auth จาก username ที่ผ่าน `normalizeUsername` แล้ว
 * โยน error ถ้ารูปแบบไม่ถูกต้อง เพื่อไม่ให้ค่าแปลกๆ หลุดไปถึง Auth
 */
export function emailForUsername(username: string): string {
  if (!isValidUsername(username)) {
    throw new Error("invalid username");
  }
  return `${username}@${AGA_EMAIL_DOMAIN}`;
}
