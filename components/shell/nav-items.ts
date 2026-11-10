/**
 * รายการเมนูซ้าย (ย้ายจาก docs/mockup/_shell/nav.html — 14 รายการ 3 กลุ่ม)
 *
 * - `roles` = ตำแหน่งที่เห็นเมนูนี้ (ตรงกับ `data-roles` ใน mockup)
 * - กรองด้วย `filterNavForRole` ที่ระดับข้อมูล → รายการที่ไม่มีสิทธิ์ "ไม่ถูกวาดออกมาเลย"
 *   (ไม่ใช่ซ่อนด้วย CSS) และกลุ่มที่ไม่เหลือเมนูจะหายไปด้วย
 *
 * ⚠ การซ่อนเมนูไม่ใช่ระบบความปลอดภัย — แค่ทำให้ผู้ใช้ไม่เห็นทางเข้าที่ใช้ไม่ได้
 *   ของจริงบังคับที่ฐานข้อมูลด้วย RLS (SPEC §5) และฝั่ง server ของแต่ละหน้า
 *
 * href: หน้าที่มีอยู่แล้วใน app/ ใช้เส้นทางจริง · หน้าที่ยังไม่สร้าง (ทำเครื่องหมาย "ยังไม่มีหน้า")
 *   ใช้เส้นทางที่เสนอไว้ก่อน — HQ/หมวดที่ทำหน้านั้นยืนยันหรือแก้ที่ไฟล์นี้ที่เดียว
 */
import type { Role } from "./types";

export type NavItem = {
  /** ตรงกับ `data-nav` ใน mockup */
  key: string;
  label: string;
  href: string;
  /** ตัวอักษรไอคอนแบบเดียวกับ mockup (ตกแต่งอย่างเดียว ไม่ถูกอ่านออกเสียง) */
  icon: string;
  roles: readonly Role[];
};

export type NavGroup = {
  key: string;
  title: string;
  items: readonly NavItem[];
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: "daily",
    title: "งานประจำวัน",
    items: [
      { key: "todo", label: "สถานะทะเบียนบริการ", href: "/todo", icon: "◉", roles: ["host", "recorder"] },
      { key: "service", label: "กรอกข้อมูลทำบริการประจำเดือน", href: "/service", icon: "✎", roles: ["host", "recorder"] },
      { key: "bait", label: "ติดตามผล AG และติดกล่อง AG (ไม่พร้อมรอบบริการ)", href: "/bait", icon: "▣", roles: ["host", "recorder"] },
      { key: "collect", label: "ลูกค้ารอเก็บสถานี", href: "/collection", icon: "⇲", roles: ["host", "recorder"] },
    ],
  },
  {
    key: "registry",
    title: "ทะเบียนและสรุป",
    items: [
      { key: "registry", label: "ทะเบียนลูกค้า/สัญญา", href: "/customers", icon: "▤", roles: ["host", "admin", "recorder"] },
      // ยังไม่มีหน้า — เส้นทางที่เสนอ
      { key: "new", label: "เปิดงานเข้าทะเบียนบริการ", href: "/customers/new", icon: "＋", roles: ["host", "admin"] },
      // ยังไม่มีหน้า — เส้นทางที่เสนอ
      { key: "material", label: "สรุปยอดใช้อุปกรณ์รายเดือน", href: "/material", icon: "▥", roles: ["host", "admin", "recorder"] },
      // หน้า public อยู่นอกกลุ่ม (app) จึงไม่มีโครงหน้านี้ครอบ — ลิงก์ยังใช้ได้
      { key: "summary", label: "Dashboard สรุปมูลค่าทั้งหมด", href: "/summary", icon: "▦", roles: ["host", "admin", "recorder", "viewer"] },
    ],
  },
  {
    key: "system",
    title: "ดูแลระบบ",
    items: [
      // หน้าจริง 6 รายการนี้ยังไม่มี (ตอนนี้มีแค่ /admin แบบ stub) — เส้นทางที่เสนอ
      { key: "closure", label: "ส่งข้อมูล และสรุปงานประจำเดือน", href: "/admin/closure", icon: "🔒", roles: ["host", "recorder"] },
      { key: "port", label: "ลงข้อมูล Port ต่างจังหวัด", href: "/admin/port", icon: "⛰", roles: ["host"] },
      { key: "sync", label: "Dashboard Sync", href: "/admin/sync", icon: "⇅", roles: ["host"] },
      { key: "history", label: "ประวัติย้อนหลัง", href: "/admin/history", icon: "⟲", roles: ["host"] },
      { key: "users", label: "จัดการผู้ใช้", href: "/admin/users", icon: "☺", roles: ["host"] },
      { key: "settings", label: "ตั้งค่า", href: "/admin/settings", icon: "⚙", roles: ["host"] },
    ],
  },
];

/** เหลือเฉพาะเมนูที่ `role` เห็น และตัดกลุ่มที่ไม่เหลือเมนูทิ้ง */
export function filterNavForRole(
  groups: readonly NavGroup[],
  role: Role,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.roles.includes(role)),
    }))
    .filter((group) => group.items.length > 0);
}

/** ตัด `/` ท้าย path ออก (ยกเว้น root) เพื่อเทียบ path ให้ตรงกัน */
function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** เมนูนี้คือหน้าปัจจุบันหรือไม่ — เทียบตรงตัว (หน้า detail เช่น /customers/123 ไม่ทำให้เมนูไหน active ตาม mockup v2) */
export function isActivePath(href: string, currentPath: string): boolean {
  return normalizePath(href) === normalizePath(currentPath);
}
