"use client";

/**
 * หน้า error สุดท้ายของแอป (เมื่อ root layout พัง) — ส่ง error เข้า Sentry แล้วแสดงข้อความไทย (M32)
 * ถ้า Sentry ปิดอยู่ (ไม่มี DSN) `captureException` ไม่ทำอะไร จึงปลอดภัย
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="th">
      <body style={{ fontFamily: "sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1>ระบบขัดข้องชั่วคราว</h1>
        <p>เกิดข้อผิดพลาดที่ไม่คาดคิด ทีมงานได้รับแจ้งแล้ว กรุณาลองใหม่อีกครั้ง</p>
        <button type="button" onClick={() => reset()} style={{ padding: "0.5rem 1.25rem" }}>
          ลองใหม่
        </button>
      </body>
    </html>
  );
}
