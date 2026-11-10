/**
 * ชนิดข้อมูลของชั้นอ่าน/เขียนฐานข้อมูล (lib/db)
 *
 * ชื่อฟิลด์ในฐานข้อมูลเป็น snake_case — ชั้นนี้แปลงเป็น camelCase ให้โค้ดฝั่งแอปใช้
 * เพื่อไม่ให้รูปแบบของตารางรั่วไปทั่วทั้งแอป (เปลี่ยน schema แล้วแก้ที่ชั้นนี้ที่เดียว)
 */

/** ระดับสิทธิ์ในฐานข้อมูล (enum `user_role`) — ตรงกับ `Role` ของ components/shell */
export type UserRole = "host" | "admin" | "recorder" | "viewer";

/** หน่วยงาน (enum `division`) — เฟส 1 ใช้ `central` เท่านั้น */
export type Division = "central" | "province";

/** โปรไฟล์ของผู้ใช้ที่ล็อกอินอยู่ (ตาราง `profiles` + ชื่อตำแหน่งจาก `positions`) */
export type AppProfile = {
  userId: string;
  username: string;
  /** ชื่อที่แสดงบนจอ — อาจว่างถ้า host ยังไม่กรอก */
  displayName: string | null;
  role: UserRole;
  /** รหัสตำแหน่ง (`positions.code`) — null ได้ในแถวที่ host ยังไม่ตั้งตำแหน่ง */
  positionCode: string | null;
  /** ชื่อตำแหน่งภาษาไทยที่ผู้ใช้เห็น (SPEC §5.1) เช่น "หัวหน้างาน" */
  positionName: string | null;
  divisionScope: Division[];
  teamId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLogin: string | null;
};
