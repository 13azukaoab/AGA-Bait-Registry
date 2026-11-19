"use client";

/**
 * ชิ้นส่วนเล็กของหน้า Port: ไอคอน SVG · ป้ายสถานะ 12px · กล่องข้อความ · กล่องยืนยัน (<dialog>)
 *
 * Logic summary:
 *   * ไอคอนเป็น SVG ทั้งหมด (ห้ามใช้ emoji) สีตาม currentColor
 *   * `Pill` เป็นป้ายสถานะขนาด 12px (ป้ายกลาง `Chip` ใช้ 11.5px ต่ำกว่าเกณฑ์ของหน้านี้ และแก้ components/ui ไม่ได้)
 *   * `useConfirm` ให้ `confirm(title, message, okLabel)` คืน Promise<boolean> — ใช้ <dialog> มาตรฐาน (โฟกัส/Esc ทำงานเอง)
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "@/components/ui";

export type IconName = "info" | "warn" | "carry" | "lock" | "flag" | "pointer" | "x" | "check" | "circle" | "chevron-down" | "chevron-right";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const common = {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const, "aria-hidden": true as const, focusable: false as const,
    className: cx("inline-block size-[1em] flex-none align-[-0.14em]", className),
  };
  switch (name) {
    case "info": return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>);
    case "warn": return (<svg {...common}><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5h.01" /></svg>);
    case "carry": return (<svg {...common}><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></svg>);
    case "lock": return (<svg {...common}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>);
    case "flag": return (<svg {...common}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>);
    case "pointer": return (<svg {...common}><path d="M20 12H5M11 6l-6 6 6 6" /></svg>);
    case "x": return (<svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>);
    case "check": return (<svg {...common}><path d="M5 12.5l4.5 4.5L19 7" /></svg>);
    case "circle": return (<svg {...common}><circle cx="12" cy="12" r="8" /></svg>);
    case "chevron-down": return (<svg {...common}><path d="M6 9l6 6 6-6" /></svg>);
    case "chevron-right": return (<svg {...common}><path d="M9 6l6 6-6 6" /></svg>);
  }
}

export type PillTone = "ok" | "miss" | "pend" | "na" | "info";
const PILL_TONE: Record<PillTone, string> = {
  ok: "bg-ok-soft text-ok",
  miss: "bg-danger-soft text-danger",
  pend: "bg-warn-soft text-warn",
  na: "bg-surface-3 text-fg-muted",
  info: "bg-accent-soft text-accent-strong",
};

/** wrap = ข้อความยาวให้ขึ้นบรรทัดใหม่ได้ (ปกติไม่ตัดบรรทัด) */
export function Pill({ tone, children, title, className, wrap }: { tone: PillTone; children: ReactNode; title?: string; className?: string; wrap?: boolean }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs", wrap ? "rounded-xl" : "whitespace-nowrap", PILL_TONE[tone], className)}>
      {children}
    </span>
  );
}

export type NoticeTone = "info" | "warn" | "danger" | "ok";
const NOTICE_TONE: Record<NoticeTone, string> = {
  info: "border-accent bg-accent-soft [&_.ic]:text-accent-strong",
  warn: "border-warn bg-warn-soft [&_.ic]:text-warn",
  danger: "border-danger bg-danger-soft [&_.ic]:text-danger",
  ok: "border-ok bg-ok-soft [&_.ic]:text-ok",
};
const NOTICE_ICON: Record<NoticeTone, IconName> = { info: "info", warn: "warn", danger: "x", ok: "check" };

/** กล่องข้อความในหน้า (ตัวหนังสือ 12.5px ขึ้นไป) */
export function Notice({ tone, children, className, live }: { tone: NoticeTone; children: ReactNode; className?: string; live?: boolean }) {
  return (
    <div
      role={tone === "danger" || tone === "warn" ? "alert" : live ? "status" : undefined}
      className={cx("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px] text-fg", NOTICE_TONE[tone], className)}
    >
      <span className="ic mt-0.5 text-[15px]"><Icon name={NOTICE_ICON[tone]} /></span>
      <div className="min-w-0 flex-1 [&_small]:mt-0.5 [&_small]:block [&_small]:text-xs [&_small]:text-fg-muted">{children}</div>
    </div>
  );
}

interface ConfirmState { title: string; message: string; okLabel: string; resolve: (v: boolean) => void }

/** กล่องยืนยันแบบ Promise: `if (!(await confirm("หัวข้อ", "ข้อความ", "ตกลง"))) return;` */
export function useConfirm(): { confirm: (title: string, message: string, okLabel?: string) => Promise<boolean>; dialog: ReactNode } {
  const [st, setSt] = useState<ConfirmState | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  const confirm = useCallback(
    (title: string, message: string, okLabel = "ตกลง") =>
      new Promise<boolean>((resolve) => setSt({ title, message, okLabel, resolve })),
    [],
  );

  useEffect(() => {
    const d = ref.current;
    if (st && d && !d.open) d.showModal();
  }, [st]);

  const finish = (v: boolean) => {
    const cur = st;
    setSt(null);
    if (ref.current?.open) ref.current.close();
    cur?.resolve(v);
  };

  const dialog = st ? (
    <dialog
      ref={ref}
      aria-labelledby="port-dlg-t"
      onCancel={(e) => { e.preventDefault(); finish(false); }}
      className="m-auto w-[calc(100%-32px)] max-w-[440px] rounded-xl border border-border-strong bg-surface p-5 text-fg shadow-[var(--shadow)] backdrop:bg-black/50"
    >
      <h2 id="port-dlg-t" className="m-0 mb-2 text-base font-semibold">{st.title}</h2>
      <p className="m-0 mb-4 text-[13px] text-fg-muted">{st.message}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus onClick={() => finish(false)} className="min-h-[34px] cursor-pointer rounded-lg border border-border-strong bg-surface px-3.5 py-2 text-[13px] font-medium text-fg max-md:min-h-11">ยกเลิก</button>
        <button type="button" onClick={() => finish(true)} className="min-h-[34px] cursor-pointer rounded-lg border border-accent bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-fg max-md:min-h-11">{st.okLabel}</button>
      </div>
    </dialog>
  ) : null;

  return { confirm, dialog };
}
