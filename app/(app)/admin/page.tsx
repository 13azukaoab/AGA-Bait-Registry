/*
 * /admin ไม่มีหน้าของตัวเอง — ส่งไปเมนูแรกของกลุ่ม "ดูแลระบบ" ที่ตำแหน่งผู้ใช้เข้าได้
 * (ตรรกะเลือกปลายทางอยู่ใน components/admin/adminLanding.ts · ไม่มีเมนูที่เข้าได้ → หน้าแรกของตำแหน่ง)
 */
import { redirect } from "next/navigation";

import { adminLandingPath } from "@/components/admin/adminLanding";
import { requireProfile } from "@/lib/auth/session";

export default async function AdminPage() {
  const profile = await requireProfile();
  redirect(adminLandingPath(profile.role));
}
