import withSerwistInit from "@serwist/next";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // ฝัง VERCEL_ENV ตอน build ให้ Sentry ฝั่ง browser/edge รู้ว่าเป็น production หรือไม่ (M32)
  // — Sentry ส่งเฉพาะ production เท่านั้น (lib/sentry/options.ts)
  env: {
    NEXT_PUBLIC_SENTRY_ENV: process.env.VERCEL_ENV ?? "",
  },
};

// PWA ผ่าน Serwist (SPEC §3) — ปิดใน dev เพื่อเลี่ยงปัญหา cache ตอนพัฒนา
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
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
