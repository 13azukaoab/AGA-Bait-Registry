/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// Service worker ของ PWA — Serwist build ไฟล์นี้เป็น public/sw.js ตอน next build
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// อัปเดตแบบไม่เงียบ (M34 · DECISIONS 2.56): worker ตัวใหม่ติดตั้งเสร็จแล้ว "รอ" จนผู้ใช้กด "อัปเดตตอนนี้"
// ในกล่อง UpdateBanner (components/shell) ซึ่งส่ง {type:"SKIP_WAITING"} มาให้ — กันหน้าเปลี่ยนเวอร์ชันกลางทางจนข้อมูลที่กรอกค้างหาย
// clientsClaim คงไว้: มีผลเฉพาะติดตั้งครั้งแรก (หน้าที่ยังไม่มี SW คุม) · ตอนอัปเดต หน้าถูกคุมอยู่แล้ว
// เปลี่ยน controller ก็ต่อเมื่อผู้ใช้สั่ง skipWaiting เท่านั้น
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// ผู้ใช้ยืนยันอัปเดตในกล่องแจ้งเวอร์ชันใหม่ → ให้ worker ตัวที่รออยู่เริ่มทำงานทันที
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
