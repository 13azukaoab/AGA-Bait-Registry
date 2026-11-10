/**
 * Chip — ป้ายสถานะทรงเม็ดยา
 *  - tone: ok (เขียว) · miss (แดง) · pend (เหลือง) · na (เทา) · info (น้ำเงิน)
 *  - แบบแสดงอย่างเดียว: ไม่ส่ง onClick → render เป็น <span>
 *  - แบบกดได้ (ตัวกรอง): ส่ง onClick → render เป็น <button> พร้อม aria-pressed
 *    ใช้ selected บอกว่ากำลังถูกเลือกอยู่ (แสดงเป็นขอบวง)
 */
import type { ReactNode } from "react";
import { cx } from "./cx";

export type ChipTone = "ok" | "miss" | "pend" | "na" | "info";

type ChipBaseProps = {
  tone: ChipTone;
  children: ReactNode;
  className?: string;
};

export type ChipProps =
  | (ChipBaseProps & { onClick?: undefined; selected?: undefined; disabled?: undefined })
  | (ChipBaseProps & {
      onClick: () => void;
      /** ตัวกรองนี้ถูกเลือกอยู่หรือไม่ */
      selected?: boolean;
      disabled?: boolean;
    });

const TONE_CLASS: Record<ChipTone, string> = {
  ok: "bg-ok-soft text-ok",
  miss: "bg-danger-soft text-danger",
  pend: "bg-warn-soft text-warn",
  na: "bg-surface-3 text-fg-muted",
  info: "bg-accent-soft text-accent-strong",
};

const BASE_CLASS =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px]";

export function Chip(props: ChipProps) {
  const { tone, children, className } = props;
  const toneClass = TONE_CLASS[tone];

  if (props.onClick === undefined) {
    return <span className={cx(BASE_CLASS, toneClass, className)}>{children}</span>;
  }

  const { onClick, selected = false, disabled } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cx(
        BASE_CLASS,
        toneClass,
        "cursor-pointer transition-shadow hover:shadow-[inset_0_0_0_1px_currentColor]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selected && "shadow-[inset_0_0_0_2px_currentColor] font-semibold",
        className,
      )}
    >
      {children}
    </button>
  );
}
