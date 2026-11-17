"use client";

/**
 * useServiceWorkerUpdate — ตรวจว่ามี service worker ตัวใหม่ "รออยู่" (waiting) ไหม (M34 · DECISIONS 2.56)
 *
 * ใช้ `navigator.serviceWorker` ตรงๆ (ไม่ใช้ @serwist/window เพราะไม่อยู่ใน package.json)
 * ลำดับ: รอ SW พร้อม (ready) → ถ้ามี registration.waiting อยู่แล้วให้แจ้งทันที
 *        → ฟัง updatefound → statechange = installed → แจ้ง
 *        → เมื่อแท็บกลับมาแสดง (visibilitychange) เรียก registration.update() ให้แท็บที่เปิดค้างนานเห็นเวอร์ชันใหม่
 * ติดตั้งครั้งแรก (ยังไม่มี controller) ไม่ถือเป็น "เวอร์ชันใหม่" → ไม่แจ้ง
 *
 * apply(): ส่ง {type:"SKIP_WAITING"} ให้ SW ที่รอ แล้วรีโหลดเมื่อ `controllerchange` (กันรีโหลดซ้ำด้วย flag)
 * แท็บอื่นของแอปเดียวกันไม่ถูกรีโหลดอัตโนมัติ (ฟังเฉพาะแท็บที่กดอัปเดต) เพื่อไม่ให้ข้อมูลที่กรอกค้างหาย
 * SW ปิดตอน dev (next.config.ts) → ใน dev hook นี้ไม่แจ้งอะไร
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function useServiceWorkerUpdate(): { hasWaiting: boolean; apply: () => void } {
  const [hasWaiting, setHasWaiting] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;

    // มี controller อยู่ = หน้านี้ถูกคุมโดย SW เก่าแล้ว → worker ที่รออยู่คือ "เวอร์ชันใหม่" จริง
    const notifyIfWaiting = () => {
      if (cancelled || !registration?.waiting || !container.controller) return;
      setHasWaiting(true);
    };

    const watchInstalling = () => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed") notifyIfWaiting();
      });
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        registration?.update().catch(() => {
          /* ออฟไลน์/ตรวจไม่ได้ — ไม่ต้องทำอะไร ลองใหม่ครั้งหน้า */
        });
      }
    };

    container.ready
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        registrationRef.current = reg;
        notifyIfWaiting();
        reg.addEventListener("updatefound", watchInstalling);
        document.addEventListener("visibilitychange", onVisible);
      })
      .catch(() => {
        /* ไม่มี SW ให้คุม — ไม่แจ้งอะไร */
      });

    return () => {
      cancelled = true;
      registration?.removeEventListener("updatefound", watchInstalling);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const apply = useCallback(() => {
    const waiting = registrationRef.current?.waiting;
    const container = navigator.serviceWorker;
    const reload = () => {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };
    if (!waiting || !container) {
      // ไม่มี worker รออยู่แล้ว (เช่นแท็บอื่นอัปเดตไปแล้ว) → รีโหลดให้ได้ของใหม่
      reload();
      return;
    }
    container.addEventListener("controllerchange", reload, { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, []);

  return { hasWaiting, apply };
}
