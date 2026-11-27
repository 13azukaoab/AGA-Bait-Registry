import { redirect } from "next/navigation";

import { LOGIN_PATH } from "@/lib/auth/access";

/**
 * หน้า `/` — ไม่มีเนื้อหาของตัวเอง ส่งไปหน้าเข้าสู่ระบบเสมอ (SEC-07 · DECISIONS 2.109)
 * เดิมเป็นหน้าโครงที่ลิสต์เส้นทางภายใน ซึ่งไม่ควรเปิดให้คนนอกเห็น
 * ถ้าล็อกอินอยู่แล้ว middleware จะพาจาก `/login` ไปหน้าแรกของตำแหน่งนั้นเอง
 */
export default function Home(): never {
  redirect(LOGIN_PATH);
}
