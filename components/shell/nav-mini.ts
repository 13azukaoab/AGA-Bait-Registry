/**
 * เมนูย่อบนจอกว้าง (≥861px) — ตรรกะสถานะ "ย่อ/ขยาย" ของเมนูซ้าย
 *
 * ต้นแบบ: docs/mockup/_shell (shell.js `navMini`) · ค่าที่เจ้าของสั่ง 11 พ.ย. 2026
 *
 * หลักการ
 * - แหล่งความจริงคือ attribute `data-nav-mini="1"` บน <html> (CSS ใน shell.module.css อ่านจากตัวนี้)
 *   React อ่านค่าผ่าน useSyncExternalStore → ไม่เกิด hydration mismatch
 * - กันหน้ากะพริบ/แอนิเมชันหุบตอนโหลด: `NAV_MINI_INIT_SCRIPT` ฝังเป็น <script> ใน AppShell
 *   รันก่อนเบราว์เซอร์วาดเมนู (วิธีเดียวกับ ThemeScript) แล้วตั้ง `data-nav-noanim` ไว้ชั่วคราว
 * - จำค่าใน localStorage คีย์ `aga-nav-mini` ("1" = ย่อ) · ครอบ try/catch เสมอ (โหมดส่วนตัว/ถูกบล็อก)
 * - หน้าใน `NAV_MINI_START_PATHS` เริ่มแบบย่อเสมอ และ **ไม่บันทึกค่า** ลง localStorage
 *   (ไม่ให้ไปเปลี่ยนค่าของหน้าอื่น) — บันทึกเฉพาะตอนผู้ใช้กด ☰ เอง
 */
export const NAV_MINI_STORAGE_KEY = "aga-nav-mini";
export const NAV_MINI_ATTR = "data-nav-mini";
export const NAV_NOANIM_ATTR = "data-nav-noanim";

/** หน้าที่ตารางกว้าง → เริ่มแบบย่อเสมอ (เพิ่ม path ที่นี่ที่เดียว) */
export const NAV_MINI_START_PATHS: readonly string[] = ["/customers/new"];

/** ตัด `/` ท้าย path ออก (ยกเว้น root) */
function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function isMiniStartPath(
  pathname: string,
  paths: readonly string[] = NAV_MINI_START_PATHS,
): boolean {
  const current = normalizePath(pathname);
  return paths.some((path) => normalizePath(path) === current);
}

/** สถานะเริ่มต้นของหน้า = หน้าที่บังคับย่อ หรือผู้ใช้เคยเลือกย่อไว้ */
export function resolveMini(
  pathname: string,
  stored: string | null,
  paths: readonly string[] = NAV_MINI_START_PATHS,
): boolean {
  return isMiniStartPath(pathname, paths) || stored === "1";
}

/**
 * สคริปต์สั้นๆ ที่รันก่อนวาดหน้า — ต้องไม่ throw ไม่ว่ากรณีใด
 * ตรรกะต้องตรงกับ `resolveMini` ด้านบน (มีเทสเทียบกัน)
 */
export function buildNavMiniInitScript(
  paths: readonly string[] = NAV_MINI_START_PATHS,
): string {
  return `(function(){try{var r=document.documentElement;var p=location.pathname;if(p.length>1&&p.slice(-1)==="/")p=p.slice(0,-1);var f=${JSON.stringify(
    paths.map(normalizePath),
  )}.indexOf(p)>=0;var s=null;try{s=localStorage.getItem(${JSON.stringify(
    NAV_MINI_STORAGE_KEY,
  )})}catch(e){}if(f||s==="1")r.setAttribute(${JSON.stringify(
    NAV_MINI_ATTR,
  )},"1");r.setAttribute(${JSON.stringify(NAV_NOANIM_ATTR)},"1")}catch(e){}})();`;
}

export const NAV_MINI_INIT_SCRIPT = buildNavMiniInitScript();

// ---------- ส่วนที่แตะ DOM (เรียกจาก client เท่านั้น) ----------

const listeners = new Set<() => void>();

export function subscribeMini(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMini(): boolean {
  return document.documentElement.getAttribute(NAV_MINI_ATTR) === "1";
}

/** ค่าที่ผู้ใช้เคยเลือก (null ถ้าไม่มี/อ่านไม่ได้) */
export function readStoredMini(): string | null {
  try {
    return window.localStorage.getItem(NAV_MINI_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** ตั้งสถานะบนหน้า (ไม่บันทึก) */
export function applyMini(on: boolean): void {
  const root = document.documentElement;
  if (on) root.setAttribute(NAV_MINI_ATTR, "1");
  else root.removeAttribute(NAV_MINI_ATTR);
  listeners.forEach((listener) => listener());
}

/** ผู้ใช้กด ☰ เอง → ตั้งสถานะ + บันทึก */
export function setMiniByUser(on: boolean): void {
  applyMini(on);
  try {
    window.localStorage.setItem(NAV_MINI_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // ใช้ที่เก็บไม่ได้ → จำแค่ในหน้านั้น ไม่ error
  }
}

/** เลิกกันแอนิเมชันหลังวาดหน้าแรกเสร็จ (รอ 2 เฟรม) */
export function releaseNoAnim(): () => void {
  const root = document.documentElement;
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(() => root.removeAttribute(NAV_NOANIM_ATTR));
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}
