/**
 * Sentry ฝั่ง browser (M32) — Next.js โหลดไฟล์นี้ก่อน hydrate
 *
 * Logic summary: ไม่มี DSN / ไม่ใช่ production → ไม่ init (เงียบ) · ไม่ใส่ replayIntegration / feedback
 * (PDPA) · ข้อมูลผ่านตัวกรองใน lib/sentry/scrub.ts ทุกครั้ง
 * ⚠ ตัวแปรที่ขึ้นต้น NEXT_PUBLIC_ เห็นได้ใน browser — ห้ามใส่ SENTRY_AUTH_TOKEN ที่นี่
 */
import * as Sentry from "@sentry/nextjs";

import { resolveSentryOptions } from "@/lib/sentry/options";

const options = resolveSentryOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  vercelEnv: process.env.NEXT_PUBLIC_SENTRY_ENV,
});

if (options) Sentry.init(options);

// ให้ Sentry ผูก error กับการเปลี่ยนหน้าของ App Router (ไม่ทำอะไรถ้ายังไม่ init)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
