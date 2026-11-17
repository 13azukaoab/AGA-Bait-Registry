"use client";

/**
 * ชิ้นส่วนเล็กที่ใช้ร่วมกันในแท็บของหน้าตั้งค่า (ไม่มีตรรกะธุรกิจ)
 * ปุ่มบนมือถือสูง ≥ 44px · ช่องกรอกบนมือถือ 16px (กัน iOS ซูมเอง) · สีจาก token เท่านั้น
 */
import type { ReactNode } from "react";

import { Alert, Field, cx } from "@/components/ui";

export const MOBILE_INPUT = "max-[640px]:min-h-11 max-[640px]:text-base";
export const MOBILE_BTN = "max-[640px]:min-h-11";

export function DialogError({ message }: { message: string }) {
  return message ? (
    <div className="mt-3">
      <Alert variant="danger">{message}</Alert>
    </div>
  ) : null;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-3">{children}</div>;
}

/** กล่องการ์ดมาตรฐานของหน้านี้ (หัวข้อ + คำอธิบายรอง) */
export function Card({
  title,
  sub,
  right,
  children,
  className,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-lg border border-border bg-surface shadow-[var(--shadow)]", className)}>
      <h3 className="m-0 flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
        {title}
        {sub ? <span className="text-xs font-normal text-fg-muted">{sub}</span> : null}
        {right ? <span className="ml-auto">{right}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** ช่องพิมพ์คำยืนยัน "ยืนยันแก้ไข" */
export function ConfirmField({
  phrase,
  value,
  onChange,
  error,
}: {
  phrase: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Field label={`ยืนยันการแก้ไข — พิมพ์คำว่า "${phrase}" เพื่อบันทึก`} error={error}>
      {(c) => (
        <input
          {...c}
          className={cx(c.className, MOBILE_INPUT)}
          type="text"
          autoComplete="off"
          placeholder={phrase}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function SwitchButton({
  checked,
  disabled,
  label,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "relative inline-flex h-6 w-11 flex-none cursor-pointer items-center rounded-full border border-border-strong transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "max-[640px]:my-2.5",
        checked ? "bg-ok" : "bg-surface-3",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "inline-block size-4 rounded-full bg-surface shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
