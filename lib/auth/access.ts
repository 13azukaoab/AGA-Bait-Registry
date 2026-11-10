/**
 * ตรรกะสิทธิ์ตามเส้นทาง (path) — pure function ล้วน ไม่แตะ DB/คุกกี้ จึงทดสอบได้ตรงๆ
 * ใช้ทั้งใน `middleware.ts` (ด่านจริงฝั่ง server) และหน้าอื่นที่ต้องรู้ว่าควรพาไปไหน
 *
 * Logic summary:
 *   * **สิทธิ์ของแต่ละเมนูอ่านจาก `components/shell/nav-items.ts` ที่เดียว** (README ของ shell
 *     กำหนดให้แก้เมนูที่ไฟล์นั้นไฟล์เดียว) — ถ้าคัดลอกตารางสิทธิ์มาไว้ที่นี่อีกชุด
 *     วันหนึ่งเมนูกับด่านฝั่ง server จะไม่ตรงกัน
 *   * เทียบด้วย **prefix ที่ยาวที่สุดที่ตรง** เพื่อให้หน้าลูกได้สิทธิ์ของหน้าแม่
 *     (`/customers/123` ใช้สิทธิ์ของ `/customers`) และกฎที่เจาะจงกว่าชนะ
 *     (`/customers/new` = host, admin · ไม่ใช่สิทธิ์ของ `/customers`)
 *   * **ไม่พบกฎ = ไม่ให้เข้า** (default closed) ไม่ใช่ปล่อยผ่าน
 *   * ⚠ การซ่อนเมนูไม่ใช่ความปลอดภัย — ไฟล์นี้คือด่านฝั่ง server ส่วนด่านสุดท้ายคือ
 *     RLS ในฐานข้อมูล (SPEC §5)
 */
// import แบบ relative (ไม่ใช้ alias `@/`) เพื่อให้ vitest รันไฟล์ทดสอบได้โดยไม่ต้องตั้ง alias เพิ่ม
import { NAV_GROUPS } from "../../components/shell/nav-items";
import type { UserRole } from "../db/types";

/**
 * ส่วนบนสุดของเส้นทางที่อยู่ในกลุ่ม `app/(app)` — ต้องล็อกอินก่อนเข้าทุกเส้นทาง
 * (`/summary` อยู่ในกลุ่ม `app/(public)` จึงไม่อยู่ในรายการนี้ — viewer ไม่ต้องล็อกอิน)
 */
export const APP_SECTIONS: readonly string[] = [
  "/todo",
  "/service",
  "/bait",
  "/collection",
  "/customers",
  "/material",
  "/admin",
];

/** เส้นทางของการเข้าสู่ระบบ/เปลี่ยนรหัส/ออกจากระบบ (กลุ่ม `app/(auth)`) */
export const LOGIN_PATH = "/login";
export const CHANGE_PASSWORD_PATH = "/change-password";
export const LOGOUT_PATH = "/logout";

/**
 * กฎเพิ่มเติมของเส้นทางที่ไม่มีในเมนู (จึงไม่มีสิทธิ์ติดมาจาก `nav-items.ts`)
 * `/admin` คือหน้ารวมของกลุ่มดูแลระบบ — ให้เฉพาะ host เหมือนเมนูย่อยส่วนใหญ่ของกลุ่มนี้
 */
const EXTRA_PATH_ROLES: readonly { prefix: string; roles: readonly UserRole[] }[] = [
  { prefix: "/admin", roles: ["host"] },
];

/** ตัด `/` ท้ายออก (ยกเว้น root) ให้เทียบ path ได้ตรงกัน */
function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** `path` อยู่ใต้ `prefix` หรือเท่ากับ `prefix` หรือไม่ (เทียบเป็นช่วงของ segment) */
function isUnder(path: string, prefix: string): boolean {
  const p = normalizePath(path);
  const base = normalizePath(prefix);
  return p === base || p.startsWith(`${base}/`);
}

/** รวมกฎทั้งหมด: สิทธิ์ของทุกเมนู + กฎเพิ่มเติม */
function allPathRoles(): { prefix: string; roles: readonly UserRole[] }[] {
  const fromNav = NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ prefix: item.href, roles: item.roles as readonly UserRole[] })),
  );
  return [...fromNav, ...EXTRA_PATH_ROLES];
}

/**
 * ตำแหน่งที่เข้าเส้นทางนี้ได้ — คืน null ถ้าไม่มีกฎครอบเส้นทางนี้
 * (เลือกกฎที่ prefix ยาวที่สุด เพื่อให้กฎที่เจาะจงกว่าชนะ)
 */
export function rolesForPath(pathname: string): readonly UserRole[] | null {
  let best: { prefix: string; roles: readonly UserRole[] } | null = null;

  for (const rule of allPathRoles()) {
    if (!isUnder(pathname, rule.prefix)) continue;
    if (!best || normalizePath(rule.prefix).length > normalizePath(best.prefix).length) {
      best = rule;
    }
  }

  return best ? best.roles : null;
}

/** ตำแหน่งนี้เข้าเส้นทางนี้ได้หรือไม่ — ไม่มีกฎครอบ = ไม่ให้เข้า */
export function canAccessPath(role: UserRole, pathname: string): boolean {
  const roles = rolesForPath(pathname);
  return roles ? roles.includes(role) : false;
}

/** เส้นทางนี้อยู่ในกลุ่มที่ต้องล็อกอินก่อนเข้าหรือไม่ */
export function isAppPath(pathname: string): boolean {
  return APP_SECTIONS.some((section) => isUnder(pathname, section));
}

/**
 * หน้าแรกของแต่ละตำแหน่ง = เมนูรายการแรกที่ตำแหน่งนั้นเห็นและอยู่ในกลุ่มที่ต้องล็อกอิน
 * (host/recorder → `/todo` · admin → `/customers`) · ถ้าไม่มีเลย (viewer) → หน้าสรุป public
 */
export function homeForRole(role: UserRole): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if ((item.roles as readonly UserRole[]).includes(role) && isAppPath(item.href)) {
        return item.href;
      }
    }
  }
  return "/summary";
}

/**
 * กรองค่า `next` ที่รับมาจาก query string ก่อนเอาไป redirect (กัน open redirect)
 * ยอมรับเฉพาะ path ภายในที่อยู่ในกลุ่มที่ต้องล็อกอิน — อย่างอื่นใช้ `fallback`
 */
export function safeRedirectPath(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  // ต้องเป็น path ภายในเท่านั้น: ขึ้นต้นด้วย "/" เดียว ไม่มี backslash (กัน "//host" และ "/\host")
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  const pathOnly = value.split("#")[0]?.split("?")[0] ?? "";
  return isAppPath(pathOnly) ? value : fallback;
}
