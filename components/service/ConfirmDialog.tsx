"use client";

/**
 * ConfirmDialog — กล่องยืนยันกลางจอ (ใช้ <dialog> ของเบราว์เซอร์: Esc ปิดได้ โฟกัสถูกกักในกล่อง)
 *
 * ใช้ 2 งานในหน้ากรอกข้อมูลทำบริการ:
 *   * เตือนก่อนออกจากรายที่ยังไม่บันทึก — ปุ่มเริ่มต้น = "กลับไปกรอกต่อ" (autoFocus) กันกดทิ้งโดยไม่ตั้งใจ
 *   * ยืนยันลบการเข้าบริการ
 * `onCancel` ทำงานเมื่อกด Esc / ฉากหลัง / ปุ่มยกเลิก
 */
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
    // showModal() โฟกัสปุ่มแรกเอง — บังคับให้โฟกัสที่ปุ่มปลอดภัย (ยกเลิก/กลับไปกรอกต่อ) เสมอ
    cancelRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(440px,calc(100vw-24px))] rounded-xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow)] backdrop:bg-black/40"
    >
      <div className="px-4 py-3">
        <h2 id="confirm-title" className="m-0 text-[15px] font-semibold">
          {title}
        </h2>
        <p className="m-0 mt-1.5 text-[13px] text-fg-muted">{message}</p>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant={danger ? "primary" : "secondary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} variant={danger ? "secondary" : "primary"} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </dialog>
  );
}
