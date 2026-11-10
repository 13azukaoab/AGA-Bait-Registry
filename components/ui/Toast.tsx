"use client";

/**
 * Toast — ข้อความแจ้งผลชั่วคราว ลอยกลางล่างจอ (เช่น "บันทึกแล้ว")
 *  - role="status" + aria-live="polite" ให้ screen reader อ่านโดยไม่ขัดจังหวะ
 *  - ส่ง onClose เข้ามา: ปุ่มปิด (✕) จะแสดง และข้อความหายเองหลัง durationMs (ค่าเริ่มต้น 4000 ms)
 *    ตั้ง durationMs = 0 เพื่อไม่ให้หายเอง
 *  - ไม่ส่ง message (หรือว่าง) = ไม่แสดงอะไร — หน้าที่เรียกใช้เป็นคนถือ state ว่าจะแสดงเมื่อไหร่
 *  - เป็น client component เพราะใช้ตัวจับเวลา (useEffect)
 */
import { useEffect } from "react";
import { cx } from "./cx";

export type ToastProps = {
  message: string;
  /** เรียกเมื่อครบเวลาหรือผู้ใช้กดปิด — ถ้าไม่ส่งจะไม่มีปุ่มปิดและไม่หายเอง */
  onClose?: () => void;
  /** เวลาที่แสดงก่อนหายเอง (มิลลิวินาที) · 0 = ไม่หายเอง */
  durationMs?: number;
  className?: string;
};

export function Toast({ message, onClose, durationMs = 4000, className }: ToastProps) {
  useEffect(() => {
    if (!message || !onClose || durationMs <= 0) return;
    const timer = window.setTimeout(onClose, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, onClose, durationMs]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "fixed bottom-6 left-1/2 z-[60] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3",
        "rounded-[10px] bg-fg px-4 py-2.5 text-[13px] text-surface shadow-[var(--shadow)]",
        className,
      )}
    >
      <span>{message}</span>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดข้อความ"
          className="cursor-pointer rounded px-1 text-surface/80 hover:text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
