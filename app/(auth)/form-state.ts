/**
 * ชนิดข้อมูลและค่าคงที่ของฟอร์มในกลุ่ม auth
 *
 * ทำไมต้องแยกไฟล์: ไฟล์ที่มี `"use server"` **ส่งออกได้เฉพาะ async function**
 * (ข้อบังคับของ Next) จึงเก็บ type กับค่าเริ่มต้นของ `useActionState` ไว้ที่นี่
 * เพื่อให้ทั้ง server action และฟอร์มฝั่ง client ใช้ร่วมกันได้
 */

/**
 * สถานะของฟอร์มเข้าสู่ระบบ — `error` = ข้อความที่แสดงให้ผู้ใช้ (null = ยังไม่มีข้อผิดพลาด)
 * `hint` = บรรทัดช่วยใต้ข้อความผิดพลาด (ไม่บังคับ)
 */
export type LoginState = { error: string | null; hint?: string };

/**
 * บรรทัดช่วยใต้ข้อความกลาง "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" (DECISIONS 2.109 · UAT BUG-3 ทาง ค)
 * ไม่แยกข้อความ "บัญชีถูกปิด" ออกมา — กันคนนอกไล่เดาว่ามีชื่อผู้ใช้ไหนอยู่ในระบบ
 */
export const LOGIN_GENERIC_HINT = "ถ้าลืมรหัสหรือบัญชีถูกปิด ติดต่อ Host";

export const LOGIN_INITIAL_STATE: LoginState = { error: null };

/** สถานะของฟอร์มเปลี่ยนรหัสผ่าน */
export type ChangePasswordState = { error: string | null };

export const CHANGE_PASSWORD_INITIAL_STATE: ChangePasswordState = { error: null };

/** ความยาวขั้นต่ำของรหัสผ่าน (DECISIONS 2.69 = 8) — นิยามจริงอยู่ที่ lib/auth/passwordStrength.ts */
export { PASSWORD_MIN_LENGTH } from "@/lib/auth/passwordStrength";
