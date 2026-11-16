/**
 * ตัวสร้าง option ของ `Sentry.init` (M32) — ใช้ร่วมกันทั้ง server / edge / client
 *
 * Logic summary:
 *   - **ไม่มี DSN → คืน null → ผู้เรียกไม่ต้อง init** (Sentry ปิดตัวเองเงียบๆ ไม่มี error/warning)
 *   - **ส่งเฉพาะ production** (`VERCEL_ENV === "production"`) — dev / local / test / preview ไม่ส่ง
 *     (ฝั่ง client อ่านค่านี้ผ่าน `NEXT_PUBLIC_SENTRY_ENV` ที่ next.config.ts ฝังตอน build)
 *   - PDPA: `@sentry/nextjs` v11 **ไม่มี `sendDefaultPii` แล้ว** (ถูกแทนด้วย `dataCollection` ที่ค่าเริ่มต้น "เก็บทุกอย่าง"
 *     — headers, cookies, body, query, ตัวแปรใน stack) จึง**ปิดทุกข้อใน `DATA_COLLECTION_OFF` ชัดเจน**
 *     แล้วผ่านตัวกรอง `scrubEvent` / `scrubBreadcrumb` ทุกครั้ง,
 *     ไม่เปิด Session Replay / profiling / feedback widget
 *   - โควตาฟรี: ปิด tracing (`tracesSampleRate: 0`) เก็บเฉพาะ error
 */
import type { BrowserOptions } from "@sentry/nextjs";

import { scrubBreadcrumb, scrubEvent } from "./scrub";

export type SentryEnvInput = {
  /** NEXT_PUBLIC_SENTRY_DSN */
  dsn?: string | undefined;
  /** "production" | "preview" | "development" | ""  (ค่าจาก VERCEL_ENV) */
  vercelEnv?: string | undefined;
};

/** ปิด tracing ไว้ก่อน — เก็บเฉพาะ error เพื่อไม่กินโควตาฟรีและลดพื้นผิวข้อมูลส่วนบุคคล */
export const TRACES_SAMPLE_RATE = 0;

/**
 * ปิดการเก็บข้อมูลอัตโนมัติของ SDK v11 ทุกหมวด (ค่าเริ่มต้นของ SDK คือเก็บทั้งหมด)
 * ⚠ ห้ามผ่อนค่าใดเป็น true โดยไม่ผ่านเจ้าของ — มีเทสล็อกไว้ใน options.test.ts
 */
export const DATA_COLLECTION_OFF = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} as const satisfies NonNullable<BrowserOptions["dataCollection"]>;

/** true เมื่อมี DSN และเป็น production เท่านั้น */
export function isSentryEnabled({ dsn, vercelEnv }: SentryEnvInput): boolean {
  return Boolean(dsn && dsn.trim() !== "") && vercelEnv === "production";
}

/** option กลางสำหรับ Sentry.init · คืน null เมื่อไม่ควรเปิด Sentry */
export function resolveSentryOptions(input: SentryEnvInput) {
  if (!isSentryEnabled(input)) return null;
  return {
    dsn: input.dsn,
    environment: "production",
    dataCollection: DATA_COLLECTION_OFF,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    maxBreadcrumbs: 30,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  } satisfies BrowserOptions;
}
