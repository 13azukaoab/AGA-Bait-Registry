/**
 * ตรวจสุขภาพระบบสำหรับ `GET /api/health` (M31 — เฝ้าดูเว็บล่มแบบฟรี)
 *
 * Logic summary:
 *   1. เรียก `probe()` ที่ถูกส่งเข้ามา (ของจริงคือ query anon อ่าน view `v_branch_summary` 1 แถว)
 *   2. probe สำเร็จ = db "ok" · probe โยน error / คืน error / ช้าเกิน `timeoutMs` = db "down"
 *   3. ผลลัพธ์มีแค่ 3 ช่อง (status, db, checkedAt) — **ห้ามใส่ข้อความ error, เวอร์ชัน, หรือข้อมูลลูกค้า**
 *      เพราะ endpoint นี้เปิดสาธารณะ ไม่ต้องล็อกอิน
 *   4. HTTP status: ok = 200 · down = 503 (ให้ตัวเฝ้าดูเห็นว่าล่มได้จาก status code เลย)
 *
 * แยกจาก route เพื่อให้เทสได้ง่าย (ไม่ต้องต่อ DB จริง) — ตัว route อยู่ที่ app/api/health/route.ts
 */

export type HealthState = "ok" | "down";

export interface HealthReport {
  status: HealthState;
  db: HealthState;
  checkedAt: string;
}

/** probe ต้องคืน `{ error }` แบบเดียวกับ supabase-js (error = null เมื่อสำเร็จ) */
export type HealthProbe = (signal: AbortSignal) => PromiseLike<{ error: unknown }>;

export const DEFAULT_HEALTH_TIMEOUT_MS = 5000;

export async function checkHealth(
  probe: HealthProbe,
  options: { timeoutMs?: number; now?: () => Date } = {},
): Promise<{ httpStatus: 200 | 503; body: HealthReport }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  let db: HealthState = "down";
  try {
    const result = await Promise.race([Promise.resolve(probe(controller.signal)), timeout]);
    if (result !== "timeout" && !result.error) db = "ok";
  } catch {
    db = "down"; // ไม่ส่งรายละเอียด error ออกไปข้างนอก
  } finally {
    clearTimeout(timer);
  }

  return {
    httpStatus: db === "ok" ? 200 : 503,
    body: { status: db, db, checkedAt: now().toISOString() },
  };
}
