/**
 * แปล error ของ Supabase Auth ตอนตั้ง/เปลี่ยนรหัสผ่านเป็นข้อความไทย
 *
 * ห้ามแสดงข้อความดิบ (อังกฤษ) ให้ผู้ใช้ และห้าม log รหัสผ่าน — ฟังก์ชันนี้รับเฉพาะ
 * `code` / `message` / `reasons` ของ error ไม่รับตัวรหัสผ่าน
 */
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE_HINT } from "./passwordStrength";

export type PasswordUpdateError = {
  code?: string;
  message?: string;
  /** AuthWeakPasswordError: 'length' | 'characters' | 'pwned' */
  reasons?: readonly string[];
};

const GENERIC_MESSAGE = "เปลี่ยนรหัสผ่านไม่สำเร็จ ลองอีกครั้ง หากยังไม่ได้ให้ติดต่อ Host";

export function translatePasswordUpdateError(error: PasswordUpdateError): string {
  const message = (error.message ?? "").toLowerCase();

  if (error.code === "same_password" || message.includes("should be different")) {
    return "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม";
  }

  const isWeak =
    error.code === "weak_password" ||
    message.includes("password should be") ||
    message.includes("weak password");
  if (isWeak) {
    const reasons = error.reasons ?? [];
    if (reasons.includes("pwned")) {
      return "รหัสผ่านนี้เคยรั่วไหลหรือเดาง่ายเกินไป กรุณาเลือกรหัสอื่น";
    }
    if (reasons.length === 1 && reasons[0] === "length") {
      return `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`;
    }
    return `รหัสผ่านใหม่ไม่ผ่านเงื่อนไข: ${PASSWORD_RULE_HINT}`;
  }

  return GENERIC_MESSAGE;
}
