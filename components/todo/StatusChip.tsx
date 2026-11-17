/**
 * StatusChip — ป้ายสถานะของหน้า /todo (ตัวอักษร 12px ตามเกณฑ์ UX ขั้นต่ำ · components/ui/Chip ใช้ 11.5px จึงไม่ใช้ที่นี่)
 * สีอ้าง token เดียวกับ Chip: ok · miss · pend · na · info
 */
import type { ReactNode } from "react";

export type StatusTone = "ok" | "miss" | "pend" | "na" | "info";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-ok-soft text-ok",
  miss: "bg-danger-soft text-danger",
  pend: "bg-warn-soft text-warn",
  na: "bg-surface-3 text-fg-muted",
  info: "bg-accent-soft text-accent-strong",
};

export function StatusChip({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`mr-1.5 inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
