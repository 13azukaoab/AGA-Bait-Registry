/**
 * Next.js instrumentation hook — เริ่ม Sentry ฝั่ง server / edge (M32)
 *
 * Logic summary: `register()` ถูกเรียกครั้งเดียวตอน server เริ่ม · ถ้าไม่มี DSN หรือไม่ใช่ production
 * `resolveSentryOptions` คืน null → ไม่ init อะไรเลย · `onRequestError` ส่ง error ของ Server Component /
 * route handler / middleware เข้า Sentry (ถ้ายังไม่ init ก็ไม่ทำอะไร)
 * คู่มือ: docs/คู่มือ Sentry.md
 */
import * as Sentry from "@sentry/nextjs";

import { resolveSentryOptions } from "@/lib/sentry/options";

export function register() {
  // NEXT_PUBLIC_* ถูกฝังตอน build — ใช้ได้ทั้ง nodejs และ edge runtime
  const options = resolveSentryOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    vercelEnv: process.env.NEXT_PUBLIC_SENTRY_ENV,
  });
  if (options) Sentry.init(options);
}

export const onRequestError = Sentry.captureRequestError;
