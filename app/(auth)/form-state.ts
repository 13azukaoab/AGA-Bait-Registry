/**
 * ชนิดข้อมูลและค่าคงที่ของฟอร์มในกลุ่ม auth
 *
 * ทำไมต้องแยกไฟล์: ไฟล์ที่มี `"use server"` **ส่งออกได้เฉพาะ async function**
 * (ข้อบังคับของ Next) จึงเก็บ type กับค่าเริ่มต้นของ `useActionState` ไว้ที่นี่
 * เพื่อให้ทั้ง server action และฟอร์มฝั่ง client ใช้ร่วมกันได้
 */

/** สถานะของฟอร์มเข้าสู่ระบบ — `error` = ข้อความที่แสดงให้ผู้ใช้ (null = ยังไม่มีข้อผิดพลาด) */
export type LoginState = { error: string | null };

export const LOGIN_INITIAL_STATE: LoginState = { error: null };

/** สถานะของฟอร์มเปลี่ยนรหัสผ่าน */
export type ChangePasswordState = { error: string | null };

export const CHANGE_PASSWORD_INITIAL_STATE: ChangePasswordState = { error: null };

/** ความยาวขั้นต่ำของรหัสผ่าน (DECISIONS 2.69 = 10) — นิยามจริงอยู่ที่ lib/auth/passwordStrength.ts */
export { PASSWORD_MIN_LENGTH } from "@/lib/auth/passwordStrength";
