"use client";

/**
 * Dialog — กรอบกล่องข้อความกลางจอของหน้า /todo (ใช้ <dialog> ของเบราว์เซอร์: Esc ปิด · โฟกัสถูกกักในกล่อง)
 * `onClose` ทำงานเมื่อกด Esc / คลิกฉากหลัง · ปิดไม่ได้ขณะ `busy` (กำลังบันทึก)
 */
import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({
  titleId,
  onClose,
  busy = false,
  children,
}: {
  titleId: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
      className="m-auto w-[min(480px,calc(100vw-24px))] rounded-xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow)] backdrop:bg-black/40"
    >
      {children}
    </dialog>
  );
}
