/**
 * ตัดสินใจว่าจะโหลด Microsoft Clarity (บันทึกหน้าจอช่วง UAT · DECISIONS M36) หรือไม่
 * โหลดเมื่อ: เป็น production เท่านั้น และ Project ID เป็นตัวพิมพ์เล็ก/ตัวเลข 8–12 ตัว
 * (ตรวจรูปแบบกัน script injection เพราะ ID ถูกฝังในสคริปต์) · ไม่ผ่าน = คืน null
 */
const CLARITY_ID_PATTERN = /^[a-z0-9]{8,12}$/;

export function clarityIdToLoad(id: string | undefined, env: string | undefined): string | null {
  if (env !== "production") return null;
  if (typeof id !== "string" || !CLARITY_ID_PATTERN.test(id)) return null;
  return id;
}
