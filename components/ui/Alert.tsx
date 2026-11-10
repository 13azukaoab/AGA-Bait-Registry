/**
 * Alert — กล่องข้อความแจ้งเตือนในหน้า (ไม่ลอย ต่างจาก Toast)
 *  - variant: info (น้ำเงิน) · warn (เหลือง) · danger (แดง) · ok (เขียว)
 *  - title (ไม่บังคับ) เป็นหัวข้อตัวหนา · children เป็นเนื้อหา
 *  - danger/warn ใช้ role="alert" (อ่านทันที) · info/ok ใช้ role="status" (อ่านเมื่อว่าง)
 */
import type { ReactNode } from "react";
import { cx } from "./cx";

export type AlertVariant = "info" | "warn" | "danger" | "ok";

export type AlertProps = {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  className?: string;
};

const VARIANT_CLASS: Record<AlertVariant, string> = {
  info: "border-l-accent bg-accent-soft",
  warn: "border-l-warn bg-warn-soft",
  danger: "border-l-danger bg-danger-soft",
  ok: "border-l-ok bg-ok-soft",
};

const TITLE_CLASS: Record<AlertVariant, string> = {
  info: "text-accent-strong",
  warn: "text-warn",
  danger: "text-danger",
  ok: "text-ok",
};

const ICON: Record<AlertVariant, string> = {
  info: "i",
  warn: "!",
  danger: "×",
  ok: "✓",
};

export function Alert({ variant = "info", title, children, className }: AlertProps) {
  const role = variant === "danger" || variant === "warn" ? "alert" : "status";
  return (
    <div
      role={role}
      className={cx(
        "flex items-start gap-2.5 rounded-r-lg border-l-[3px] px-3 py-2.5 text-[13px] text-fg",
        VARIANT_CLASS[variant],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "mt-0.5 inline-flex size-4 flex-none items-center justify-center rounded-full",
          "border border-current text-[11px] font-bold leading-none",
          TITLE_CLASS[variant],
        )}
      >
        {ICON[variant]}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className={cx("m-0 font-semibold", TITLE_CLASS[variant])}>{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}
