/**
 * ธีมสว่าง / มืด / ตามเครื่อง
 *
 * - เก็บใน localStorage คีย์ `aga-theme` (คีย์เดียวกับ mockup) ค่า `light` | `dark`
 *   ส่วน "ตามเครื่อง" = ไม่มีค่าในที่เก็บ และไม่ตั้ง `data-theme` บน <html>
 *   (globals.css ใช้ `@media (prefers-color-scheme: dark)` เอง)
 * - ไม่กะพริบตอนโหลด: `THEME_INIT_SCRIPT` ฝังเป็น <script> ต้นหน้า (ดู ThemeScript.tsx)
 *   อ่านค่าและตั้ง `data-theme` ก่อน React วาดเมนู
 * - localStorage ใช้ไม่ได้ (โหมดส่วนตัว/ถูกบล็อก) → จำแค่ในหน้านั้น ไม่ error
 */
export const THEME_STORAGE_KEY = "aga-theme";

export type ThemePreference = "system" | "light" | "dark";

/** สคริปต์สั้นๆ ที่รันก่อนวาดหน้า — ต้องไม่ throw ไม่ว่ากรณีใด */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;

let memoryPreference: ThemePreference = "system";
const listeners = new Set<() => void>();

function applyToDocument(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return "system";
  } catch {
    return memoryPreference;
  }
}

export function writeThemePreference(pref: ThemePreference): void {
  memoryPreference = pref;
  try {
    if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* ใช้ค่าในหน่วยความจำแทน */
  }
  applyToDocument(pref);
  listeners.forEach((notify) => notify());
}

/** ใช้กับ useSyncExternalStore — ฟังทั้งการเปลี่ยนในหน้านี้และจากแท็บอื่น */
export function subscribeThemePreference(notify: () => void): () => void {
  listeners.add(notify);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyToDocument(readThemePreference());
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", onStorage);
  };
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}
