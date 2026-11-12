"use client";

/**
 * Modal — กล่องโต้ตอบกลางจอ (ใช้ <dialog> ของเบราว์เซอร์: โฟกัสถูกกักในกล่อง, Esc ปิดได้, ฉากหลังกั้นการกด)
 * ปิดด้วยปุ่ม ✕ / Esc / กดฉากหลัง · ของใช้เฉพาะหน้าเปิดงาน (ถ้าจะใช้ซ้ำหลายหน้า แจ้ง FE ย้ายไป components/ui)
 */
import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
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
      onClose={onClose}
      onClick={(e) => {
        // คลิกที่ตัว dialog เอง (= ฉากหลัง) ปิด · คลิกในเนื้อหาไม่ปิด
        if (e.target === ref.current) ref.current?.close();
      }}
      aria-labelledby="modal-title"
      className="m-auto w-[min(640px,calc(100vw-24px))] rounded-xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow)] backdrop:bg-black/40"
    >
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="modal-title" className="m-0 text-[15px] font-semibold">
            {title}
          </h2>
          {subtitle ? <p className="m-0 mt-0.5 text-[12px] text-fg-muted">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="ปิด"
          className="cursor-pointer rounded px-2 py-0.5 text-fg-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-4 py-3">{children}</div>
    </dialog>
  );
}
