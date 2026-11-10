/**
 * Button — ปุ่มกลางของระบบ
 *  - variant: primary (น้ำเงินทึบ) · secondary (ขอบเทา) · danger (ตัวแดงโปร่ง ใช้กับลบ/ยกเลิก)
 *  - size: md (ปกติ) · sm (ปุ่มเล็กในตาราง/แถบเครื่องมือ)
 *  - disabled: กดไม่ได้ · loading: แสดงวงกลมหมุน + กดซ้ำไม่ได้ (aria-busy)
 *  - type เริ่มต้นเป็น "button" กันกด submit ฟอร์มโดยไม่ตั้งใจ ต้องการส่งฟอร์มให้ใส่ type="submit"
 * สีทั้งหมดอ้าง token ใน app/globals.css (bg-accent, text-danger …) ห้ามใส่ hex
 */
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "danger";
export type ButtonSize = "md" | "sm";

export type ButtonProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** กำลังทำงาน — ปุ่มจะกดไม่ได้และมีวงกลมหมุนนำหน้าข้อความ */
  loading?: boolean;
  children: ReactNode;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent text-accent-fg hover:border-accent-strong hover:bg-accent-strong",
  secondary: "border-border-strong bg-surface text-fg hover:bg-surface-2",
  danger: "border-transparent bg-transparent text-danger hover:bg-danger-soft",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: "px-3.5 py-2 text-[13px]",
  sm: "px-2.5 py-1 text-xs",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...rest}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
    >
      {loading ? (
        <>
          <span
            aria-hidden="true"
            className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <span className="sr-only">กำลังดำเนินการ</span>
        </>
      ) : null}
      {children}
    </button>
  );
}
