/**
 * ขั้นตอนเปลี่ยนรหัสผ่านของตัวเอง (SEC-04 · DECISIONS 2.109 "หลัง go-live")
 *
 * Logic summary:
 *   1. ตรวจรหัสใหม่ (ความแข็งแรง + 2 ช่องตรงกัน) ก่อน ไม่เรียกเครือข่าย
 *   2. อ่านผู้ใช้ที่ล็อกอินอยู่ (ไม่มี = ให้ไปหน้า login)
 *   3. ตัดสินจาก **โปรไฟล์ฝั่ง server** เท่านั้น (ไม่เชื่อค่าจากฟอร์ม):
 *        - `must_change_password = true` (บังคับเปลี่ยนครั้งแรก / host รีเซ็ตให้) → ไม่ต้องกรอกรหัสเดิม
 *        - นอกนั้น (รวมอ่านโปรไฟล์ไม่ได้ = fail closed) → ต้องกรอกรหัสเดิม และตรวจกับ Supabase Auth ก่อน
 *   4. รหัสเดิมผิด → ข้อความกลาง "รหัสผ่านเดิมไม่ถูกต้อง" (ไม่บอกรายละเอียดอื่น)
 *   5. เปลี่ยนรหัส → ปิดธง must_change_password → ออกจากระบบอุปกรณ์อื่น (best effort · ล้มก็ไม่ทำให้รอบนี้ล้ม)
 *
 * แยกจาก server action ด้วย ports เพื่อเทสได้โดยไม่ต้องต่อ Supabase จริง (`changePassword.test.ts`)
 * ห้าม log รหัสผ่านทุกช่อง
 */
import type { UserRole } from "@/lib/db/types";

import { translatePasswordUpdateError, type PasswordUpdateError } from "./passwordErrors";
import { checkPasswordStrength, describePasswordIssues } from "./passwordStrength";

export type ChangePasswordInput = {
  /** รหัสผ่านเดิม — ว่างได้เฉพาะตอนบังคับเปลี่ยนครั้งแรก */
  currentPassword: string;
  password: string;
  confirmation: string;
};

/** ผลการตรวจรหัสเดิม: ถูก / ผิด / ตรวจไม่ได้ตอนนี้ (เช่น ติด rate limit หรือเครือข่ายล่ม) */
export type CurrentPasswordCheck = "valid" | "invalid" | "unavailable";

export type ChangePasswordPorts = {
  getUser(): Promise<{ id: string; email: string | null } | null>;
  /** โปรไฟล์ของผู้ใช้ — null = อ่านไม่ได้ (ถือว่าไม่ใช่การบังคับเปลี่ยน) */
  loadProfile(userId: string): Promise<{ mustChangePassword: boolean; role: UserRole } | null>;
  /** ตรวจรหัสเดิมแบบไม่แตะ session/cookie ของผู้ใช้ */
  verifyCurrentPassword(userId: string, email: string, password: string): Promise<CurrentPasswordCheck>;
  /** คืน error ของ Supabase Auth (null = สำเร็จ) */
  updatePassword(password: string): Promise<PasswordUpdateError | null>;
  completePasswordChange(): Promise<void>;
  /** ออกจากระบบทุก session อื่นของผู้ใช้นี้ (คง session ปัจจุบัน) */
  signOutOtherSessions(): Promise<void>;
};

export type ChangePasswordOutcome =
  | { kind: "unauthenticated" }
  | { kind: "error"; error: string }
  | { kind: "ok"; role: UserRole | null };

export const CURRENT_PASSWORD_REQUIRED_MESSAGE = "กรุณากรอกรหัสผ่านเดิม";
export const CURRENT_PASSWORD_WRONG_MESSAGE = "รหัสผ่านเดิมไม่ถูกต้อง";
export const CURRENT_PASSWORD_UNAVAILABLE_MESSAGE =
  "ตรวจรหัสผ่านเดิมไม่สำเร็จ กรุณาลองใหม่อีกครั้งในภายหลัง";

export async function changeOwnPassword(
  input: ChangePasswordInput,
  ports: ChangePasswordPorts,
): Promise<ChangePasswordOutcome> {
  const weakness = describePasswordIssues(checkPasswordStrength(input.password));
  if (weakness) {
    return { kind: "error", error: weakness };
  }
  if (input.password !== input.confirmation) {
    return { kind: "error", error: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน" };
  }

  const user = await ports.getUser();
  if (!user) {
    return { kind: "unauthenticated" };
  }

  const profile = await ports.loadProfile(user.id);
  const isForcedChange = profile?.mustChangePassword === true;

  if (!isForcedChange) {
    if (input.currentPassword === "") {
      return { kind: "error", error: CURRENT_PASSWORD_REQUIRED_MESSAGE };
    }
    if (!user.email) {
      // บัญชีไม่มีอีเมล = ตรวจรหัสเดิมไม่ได้ → ไม่ยอมเปลี่ยน (fail closed)
      return { kind: "error", error: CURRENT_PASSWORD_UNAVAILABLE_MESSAGE };
    }
    const check = await ports.verifyCurrentPassword(user.id, user.email, input.currentPassword);
    if (check === "invalid") {
      return { kind: "error", error: CURRENT_PASSWORD_WRONG_MESSAGE };
    }
    if (check !== "valid") {
      return { kind: "error", error: CURRENT_PASSWORD_UNAVAILABLE_MESSAGE };
    }
  }

  const updateError = await ports.updatePassword(input.password);
  if (updateError) {
    return { kind: "error", error: translatePasswordUpdateError(updateError) };
  }

  // ปิดธง "ต้องเปลี่ยนรหัสผ่าน" — ถ้าขั้นนี้พลาด ผู้ใช้จะถูกพามาหน้านี้อีกครั้ง (ไม่หลุดสิทธิ์)
  await ports.completePasswordChange();

  try {
    await ports.signOutOtherSessions();
  } catch {
    // best effort: เปลี่ยนรหัสสำเร็จแล้ว · session อื่นหมดอายุเองตามรอบ refresh
  }

  return { kind: "ok", role: profile?.role ?? null };
}
