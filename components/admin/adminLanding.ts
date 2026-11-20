/**
 * หน้าแรกของ "/admin" — ไม่มีหน้าของตัวเอง จึงส่งไปเมนูแรกในกลุ่ม "ดูแลระบบ" ที่ตำแหน่งนั้นเข้าได้
 *
 * Logic summary:
 *   * อ่านลำดับเมนูจาก NAV_GROUPS (กลุ่ม key = "system") — เมนูแรกที่ role เห็น **และ** canAccessPath ผ่าน
 *     (สิทธิ์อ่านจากที่เดียวกับ middleware จึงไม่ส่งไปหน้าที่ถูกเด้งกลับ)
 *   * ไม่มีเมนูที่เข้าได้เลย → homeForRole(role)
 *   * pure function ล้วน (ไม่แตะ session/DB) — ใช้ใน app/(app)/admin/page.tsx
 */
import { NAV_GROUPS } from "@/components/shell/nav-items";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import type { UserRole } from "@/lib/db/types";

export const ADMIN_GROUP_KEY = "system";

export function adminLandingPath(role: UserRole): string {
  const group = NAV_GROUPS.find((g) => g.key === ADMIN_GROUP_KEY);
  const hit = group?.items.find(
    (item) => (item.roles as readonly UserRole[]).includes(role) && canAccessPath(role, item.href),
  );
  return hit ? hit.href : homeForRole(role);
}
