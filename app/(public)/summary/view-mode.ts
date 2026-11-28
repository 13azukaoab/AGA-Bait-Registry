/**
 * ตัดสินว่าหน้า /summary จะแสดงแบบไหน (DECISIONS 2.116)
 *
 * - `shell`  = ล็อกอินอยู่และบัญชีใช้งานได้ → แสดงในกรอบระบบ (AppShell)
 * - `public` = นอกนั้นทั้งหมด → หน้าสาธารณะแบบเดิม (PublicHeader)
 *
 * ไม่มีโปรไฟล์ / ปิดบัญชี (`getCurrentProfile` คืน null อยู่แล้ว) / ต้องเปลี่ยนรหัสผ่าน = `public`
 * หน้านี้ไม่ redirect เอง — ปล่อยให้ middleware.ts จัดการตามเดิม
 */
import type { AppProfile } from "@/lib/db";

export type SummaryViewMode = "shell" | "public";

export function summaryViewMode(
  profile: Pick<AppProfile, "isActive" | "mustChangePassword"> | null,
): SummaryViewMode {
  if (!profile || !profile.isActive || profile.mustChangePassword) return "public";
  return "shell";
}
