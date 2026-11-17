/**
 * ชิ้นส่วนเล็กๆ ที่ใช้ซ้ำในหน้ารายละเอียดลูกค้า — ไอคอนเส้น SVG (ไม่ใช้อีโมจิ), กล่อง "วิธีอ่าน", ป้ายสถานะ
 * ป้ายสถานะใช้ Chip กลาง (ขนาดตัวอักษรบังคับ ≥ 12px ที่นี่)
 */
import type { ReactNode } from "react";

import { Chip, cx } from "@/components/ui";

import type { Tone } from "./logic";

const IC_PATH = {
  pencil: "M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4z M13.5 6.5l4 4",
  trash: "M4 7h16 M10 11v6 M14 11v6 M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12 M9 7V4h6v3",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5",
  max: "M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4",
  copy: "M8 8h12v12H8z M16 8V4H4v12h4",
  download: "M4 17v3h16v-3 M7 11l5 5 5-5 M12 4v12",
  check: "M5 12l5 5L20 7",
  x: "M18 6L6 18 M6 6l12 12",
  plus: "M12 5v14 M5 12h14",
  info: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 8h.01 M11 12h1v4h1",
  alert: "M12 9v4 M12 17h.01 M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  alertc: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 8v4 M12 16h.01",
  moved: "M15 14l5-5-5-5 M20 9H9.5A5.5 5.5 0 0 0 4 14.5V20",
  back: "M9 14L4 9l5-5 M4 9h10.5A5.5 5.5 0 0 1 20 14.5V20",
  pin: "M12 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6z M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z",
  history: "M12 8v4l3 2 M3.05 11a9 9 0 1 1 .5 4 M3 20v-5h5",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5",
  lock: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
} as const;

export type IconName = keyof typeof IC_PATH;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("inline-block size-4 flex-none align-[-3px]", className)}
    >
      <path d={IC_PATH[name]} />
    </svg>
  );
}

/** ป้ายสถานี/สัญญา — ตัวอักษร 12px */
export function Tag({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title}>
      <Chip tone={tone} className="!text-xs">
        {children}
      </Chip>
    </span>
  );
}

/** ข้อความอธิบายวิธีอ่าน — พับไว้ ไม่กินพื้นที่บนสุดของแท็บ */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <details className={cx("mb-3 rounded-lg border border-border bg-surface-2 text-[13px]", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 text-xs font-semibold text-accent-strong md:min-h-9">
        <Icon name="info" />
        วิธีอ่าน
      </summary>
      <div className="px-3 pb-3 leading-relaxed text-fg-muted">{children}</div>
    </details>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 rounded-lg border border-dashed border-border-strong px-3 py-5 text-center text-[13px] text-fg-muted">{children}</p>;
}

/** ช่องเลือก/พิมพ์ในแถบกรอง — 16px บนจอ ≤ 767px (กัน iOS ซูมเอง) · สูง ≥ 44px บนมือถือ */
export const CONTROL_CLASS =
  "w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg max-md:min-h-11 max-md:text-base md:min-h-9";

export function FilterField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="min-w-[160px] flex-1">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-fg-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/** ปุ่มตัวกรองแบบเม็ดยา (กดเลือกได้) — สูง ≥ 44px บนมือถือ */
export function FilterChip({
  tone,
  on,
  onClick,
  children,
  title,
}: {
  tone: Tone;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span title={title} className="inline-flex">
      <Chip tone={tone} selected={on} onClick={onClick} className="!text-xs max-md:min-h-11 max-md:px-3 md:min-h-8">
        {children}
      </Chip>
    </span>
  );
}

export const TABLE_WRAP = "overflow-x-auto rounded-lg border border-border";
export const TH_CLASS = "whitespace-nowrap border-b border-border bg-surface-2 px-2.5 py-2 text-left text-xs font-semibold text-fg-muted";
export const TD_CLASS = "border-b border-border px-2.5 py-2 align-top text-[13px]";
