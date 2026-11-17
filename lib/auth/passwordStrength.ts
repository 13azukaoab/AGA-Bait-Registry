/**
 * กติการหัสผ่าน (DECISIONS 2.69) — ฟังก์ชันตรวจจุดเดียวของทั้งระบบ
 *
 * กติกา: ยาวอย่างน้อย 10 ตัวอักษร + มีตัวพิมพ์เล็ก (a–z) + ตัวพิมพ์ใหญ่ (A–Z) + ตัวเลข (0–9)
 *   * ต้องตรงกับ Supabase Auth บน cloud และ `supabase/config.toml`
 *     (`minimum_password_length = 10` · `password_requirements = "lower_upper_letters_digits"`)
 *   * ช่องว่างนับเป็นอักขระธรรมดา (ไม่ตัดหัวท้าย) · อักขระไทยนับความยาวได้ แต่ไม่นับเป็นตัวพิมพ์เล็ก/ใหญ่
 *
 * ใช้ได้ทั้งฝั่ง client (ฟอร์ม) และ server (action / รหัสชั่วคราว) — เป็น pure function ไม่แตะ DB
 * หน้าจัดการผู้ใช้เรียกใช้ได้: `import { checkPasswordStrength } from "@/lib/auth/passwordStrength"`
 */

/** ความยาวขั้นต่ำของรหัสผ่าน */
export const PASSWORD_MIN_LENGTH = 10;

/** ข้อที่ไม่ผ่าน */
export type PasswordIssue = "too_short" | "no_lowercase" | "no_uppercase" | "no_digit";

/** ข้อความไทยของแต่ละข้อ — ใช้แสดงผู้ใช้ตรงๆ ได้ (ห้ามแสดงข้อความดิบจาก Supabase) */
export const PASSWORD_ISSUE_MESSAGES: Record<PasswordIssue, string> = {
  too_short: `ยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`,
  no_lowercase: "มีตัวพิมพ์เล็ก (a–z) อย่างน้อย 1 ตัว",
  no_uppercase: "มีตัวพิมพ์ใหญ่ (A–Z) อย่างน้อย 1 ตัว",
  no_digit: "มีตัวเลข (0–9) อย่างน้อย 1 ตัว",
};

/** ข้อความช่วยเหลือสั้นๆ ใต้ช่องกรอก */
export const PASSWORD_RULE_HINT = `อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข`;

/** คืนรายการข้อที่ไม่ผ่าน (อาร์เรย์ว่าง = ผ่านทุกข้อ) เรียงตามลำดับในกติกา */
export function checkPasswordStrength(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  // นับเป็นตัวอักษร (code point) ไม่ใช่ UTF-16 unit — ให้ตรงกับที่ผู้ใช้เห็น
  if (Array.from(password).length < PASSWORD_MIN_LENGTH) issues.push("too_short");
  if (!/[a-z]/.test(password)) issues.push("no_lowercase");
  if (!/[A-Z]/.test(password)) issues.push("no_uppercase");
  if (!/[0-9]/.test(password)) issues.push("no_digit");
  return issues;
}

/** ข้อความไทยรวมทุกข้อที่ไม่ผ่าน — คืน null ถ้าผ่าน */
export function describePasswordIssues(issues: readonly PasswordIssue[]): string | null {
  if (issues.length === 0) return null;
  return `รหัสผ่านใหม่ต้อง${issues.map((i) => PASSWORD_ISSUE_MESSAGES[i]).join(" และ")}`;
}
