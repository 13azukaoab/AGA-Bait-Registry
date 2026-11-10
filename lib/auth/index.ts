/**
 * ตรรกะการเข้าสู่ระบบและสิทธิ์ (lib/auth)
 *
 * ไฟล์นี้ส่งออกเฉพาะส่วนที่เป็น **pure function** (ใช้ได้ทั้งฝั่ง server และ client)
 * ส่วนที่อ่าน session ต้อง import ตรงจาก `@/lib/auth/session` เพราะใช้ `next/headers`
 * (ถ้ารวมไว้ที่นี่ client component ที่ import `@/lib/auth` จะพัง)
 */
export {
  APP_SECTIONS,
  CHANGE_PASSWORD_PATH,
  LOGIN_PATH,
  LOGOUT_PATH,
  canAccessPath,
  homeForRole,
  isAppPath,
  rolesForPath,
  safeRedirectPath,
} from "./access";
export {
  AGA_EMAIL_DOMAIN,
  USERNAME_PATTERN,
  emailForUsername,
  isValidUsername,
  normalizeUsername,
} from "./username";
