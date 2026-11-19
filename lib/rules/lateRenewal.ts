/**
 * "ต่อสัญญาล่าช้า" (DECISIONS 2.91)
 *
 * Logic summary:
 *   - สัญญา Renew ที่ `mail_received_date` เป็นวันที่ > 15 ของเดือน = ล่าช้า (วันที่ 15 ยังไม่ล่าช้า)
 *   - สัญญา New ไม่เข้ากฎนี้ · ไม่มีวันที่รับเมล (null/ว่าง/รูปแบบผิด) = ไม่ล่าช้า
 *   - ใช้ "วันที่ตามปฏิทิน" จากข้อความ 'YYYY-MM-DD' ตรงๆ ไม่แปลงผ่าน Date/เขตเวลา วันจึงไม่เลื่อน
 */

/** ต่อสัญญาล่าช้าหลังวันที่เท่านี้ของเดือน (วันที่ 16 ขึ้นไป) */
export const LATE_RENEWAL_AFTER_DAY = 15;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLateRenewal(saleType: "new" | "renew" | string | null | undefined, mailReceivedDate: string | null | undefined): boolean {
  if (saleType !== "renew" || !mailReceivedDate) return false;
  const m = YMD.exec(mailReceivedDate.trim());
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return day > LATE_RENEWAL_AFTER_DAY;
}
