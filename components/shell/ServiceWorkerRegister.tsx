"use client";

/**
 * ServiceWorkerRegister — ลงทะเบียน service worker ครั้งเดียวเมื่อหน้าโหลด (ทุกหน้า · วางใน app/layout.tsx)
 * แทนการลงทะเบียนอัตโนมัติของ @serwist/next (ปิดด้วย register: false ใน next.config.ts)
 * เพื่อจับ error เองไม่ให้เป็น unhandled rejection (Sentry AGA-BAIT-REGISTRY-2) — ดู lib/pwa/registerServiceWorker.ts
 */
import { useEffect } from "react";

import { registerServiceWorker } from "@/lib/pwa/registerServiceWorker";

export function ServiceWorkerRegister(): null {
  useEffect(() => {
    // registerServiceWorker ไม่ reject เด็ดขาด (จับ error ข้างในแล้ว)
    void registerServiceWorker();
  }, []);
  return null;
}
