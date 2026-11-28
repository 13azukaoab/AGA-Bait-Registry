import withSerwistInit from "@serwist/next";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import pkg from "./package.json";
import { securityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // ไม่ส่ง X-Powered-By: Next.js (SEC-08)
  poweredByHeader: false,
  // security headers ทุกเส้นทาง (SEC-02) — ดู lib/security/headers.ts
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // ฝัง VERCEL_ENV ตอน build ให้ Sentry ฝั่ง browser/edge รู้ว่าเป็น production หรือไม่ (M32)
  // — Sentry ส่งเฉพาะ production เท่านั้น (lib/sentry/options.ts)
  env: {
    NEXT_PUBLIC_SENTRY_ENV: process.env.VERCEL_ENV ?? "",
    // เลขเวอร์ชัน (SemVer, DECISIONS 2.58) + commit สั้น 7 ตัว — แสดงที่หน้าล็อกอินและท้ายเมนูซ้าย
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
  },
};

// PWA ผ่าน Serwist (SPEC §3) — ปิดใน dev เพื่อเลี่ยงปัญหา cache ตอนพัฒนา
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // ไม่ให้ Serwist ลงทะเบียน SW เอง (ไม่ catch error → unhandled rejection "Rejected" · Sentry AGA-BAIT-REGISTRY-2)
  // ลงทะเบียนแทนที่ components/shell/ServiceWorkerRegister.tsx (ทุกหน้า · จับ error เอง · scope/sw.js เดิม)
  register: false,
});

// Sentry (M32) ห่อนอกสุด: withSentryConfig(withSerwist(config))
//   - org / project / authToken อ่านจาก env (SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN) เท่านั้น
//   - ไม่มี SENTRY_AUTH_TOKEN → ข้ามการสร้าง/อัปโหลด source map (build ผ่านปกติ ไม่มี warning)
//   - ไม่ใช้ tunnelRoute → ไม่ต้องแตะ middleware matcher (ดู docs/คู่มือ Sentry.md)
export default withSentryConfig(withSerwist(nextConfig), {
  silent: true,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
});
