/**
 * Button — ปุ่มกลางของระบบ
 *  - variant: primary (น้ำเงินทึบ) · secondary (ขอบเทา) · danger (ตัวแดงโปร่ง ใช้กับลบ/ยกเลิก)
 *             add  (ปุ่มเพิ่ม สี --ok ไอคอน + สไลด์ — ข้อความไม่ต้องมี "+ " นำหน้า ใส่แค่ "เพิ่มแถว")
 *             save (ปุ่มบันทึกหลัก แถบสีกวาด + ไอคอนดิสก์ — ใช้กับปุ่มบันทึกตัวหลักของฟอร์ม/ฟุตเตอร์เท่านั้น)
 *    add/save สูงคงที่ 38px (ไม่ใช้ size) · สไตล์อยู่ที่ ./button.module.css (เจ้าของเลือกแบบ 16 พ.ย. 2026)
 *  - size: md (ปกติ) · sm (ปุ่มเล็กในตาราง/แถบเครื่องมือ)
 *  - disabled: กดไม่ได้ · loading: แสดงวงกลมหมุน + กดซ้ำไม่ได้ (aria-busy)
 *  - type เริ่มต้นเป็น "button" กันกด submit ฟอร์มโดยไม่ตั้งใจ ต้องการส่งฟอร์มให้ใส่ type="submit"
 * สีทั้งหมดอ้าง token ใน app/globals.css (bg-accent, text-danger …) ห้ามใส่ hex
 */
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "add" | "save";
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
  add: "", // แบบ add/save ใช้ CSS module แยก (ดู render ด้านล่าง)
  save: "",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: "px-3.5 py-2 text-[13px]",
  sm: "px-2.5 py-1 text-xs",
};

const SPIN_CLASS =
  "inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent";

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

  if (variant === "add" || variant === "save") {
    const common = {
      ...rest,
      type,
      disabled: isDisabled,
      "aria-busy": loading || undefined,
    };
    if (variant === "add") {
      return (
        <button {...common} className={cx(styles.add, className)}>
          {loading ? <span className="sr-only">กำลังดำเนินการ</span> : null}
          <span className={styles.addTx}>{children}</span>
          <span className={styles.addIc} aria-hidden="true">
            {loading ? (
              <span className={SPIN_CLASS} />
            ) : (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
          </span>
        </button>
      );
    }
    return (
      <button {...common} className={cx(styles.save, className)}>
        <span className={styles.saveIn}>
          {loading ? (
            <>
              <span aria-hidden="true" className={SPIN_CLASS} />
              <span className="sr-only">กำลังดำเนินการ</span>
            </>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M17 21v-8H7v8M7 3v5h8" />
            </svg>
          )}
          {children}
        </span>
      </button>
    );
  }

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
          <span aria-hidden="true" className={SPIN_CLASS} />
          <span className="sr-only">กำลังดำเนินการ</span>
        </>
      ) : null}
      {children}
    </button>
  );
}
