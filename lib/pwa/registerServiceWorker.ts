/**
 * registerServiceWorker — ลงทะเบียน service worker (/sw.js) แบบ "จับ error เอง"
 *
 * ทำไมต้องมี (Sentry AGA-BAIT-REGISTRY-2 · 28 พ.ย. 2026):
 *   เดิม @serwist/next ลงทะเบียนให้อัตโนมัติ (register: true) แต่ไม่ catch promise
 *   เมื่อ browser ปฏิเสธการลงทะเบียน (เช่น extension ของ Chrome ดัก, โหมดส่วนตัว, ปิด cookie/storage)
 *   → กลายเป็น unhandled rejection "Error: Rejected" ส่งเข้า Sentry ทุกครั้ง
 *   ตอนนี้ next.config.ts ตั้ง register: false แล้วให้ไฟล์นี้ลงทะเบียนแทน (เรียกจาก
 *   components/shell/ServiceWorkerRegister.tsx ที่อยู่ใน app/layout.tsx = ทุกหน้าเหมือนเดิม)
 *
 * พฤติกรรม:
 *   - ใช้ window.serwist.register() ตัวเดิมของ Serwist (scope "/" + /sw.js ตามที่ next.config.ts ฝังไว้)
 *     ถ้าไม่มี window.serwist (ไม่ควรเกิดใน production) → fallback navigator.serviceWorker.register("/sw.js")
 *   - ไม่มี service worker ในเบราว์เซอร์ / ไม่ใช่ production (dev ปิด SW ใน next.config.ts) → ไม่ทำอะไร
 *   - ล้มเหลว → console.warn ครั้งเดียวต่อการโหลดหน้า แล้วคืน false · ไม่ throw ไม่ reject
 *   - ไม่แตะเรื่อง "มีเวอร์ชันใหม่" — useServiceWorkerUpdate ฟังจาก navigator.serviceWorker.ready เหมือนเดิม
 *     (ไม่ skipWaiting อัตโนมัติ · M34)
 */

/** ส่วนที่ใช้จาก window.serwist (@serwist/window) — ประกาศเองเพื่อไม่ต้องเพิ่ม typings ใน tsconfig */
type SerwistLike = { register: (options?: { immediate?: boolean }) => Promise<unknown> };

export type RegisterDeps = {
  /** true เฉพาะ build production (SW ถูกสร้างเฉพาะตอน build) */
  isProduction: boolean;
  serwist?: SerwistLike | undefined;
  serviceWorker?: Pick<ServiceWorkerContainer, "register"> | undefined;
  warn: (message: string, error: unknown) => void;
};

let warned = false;

/** สำหรับเทสต์: ล้าง flag "เตือนไปแล้ว" */
export function resetRegisterWarningForTest(): void {
  warned = false;
}

/** ลงทะเบียน SW · คืน true เมื่อสำเร็จ, false เมื่อข้าม/ล้มเหลว (ไม่ reject เด็ดขาด) */
export async function registerServiceWorker(deps: RegisterDeps = defaultDeps()): Promise<boolean> {
  if (!deps.isProduction || !deps.serviceWorker) return false;
  try {
    if (deps.serwist) {
      await deps.serwist.register();
    } else {
      await deps.serviceWorker.register("/sw.js", { scope: "/" });
    }
    return true;
  } catch (error) {
    if (!warned) {
      warned = true;
      deps.warn("[sw] ลงทะเบียน service worker ไม่สำเร็จ — แอปยังใช้ได้ แต่ไม่มีโหมดออฟไลน์/แจ้งเวอร์ชันใหม่", error);
    }
    return false;
  }
}

function defaultDeps(): RegisterDeps {
  const hasWindow = typeof window !== "undefined";
  const sw =
    hasWindow && typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker
      : undefined;
  return {
    isProduction: process.env.NODE_ENV === "production",
    serwist: hasWindow ? (window as unknown as { serwist?: SerwistLike }).serwist : undefined,
    serviceWorker: sw,
    warn: (message, error) => console.warn(message, error),
  };
}
