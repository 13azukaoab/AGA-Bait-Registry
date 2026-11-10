/**
 * Field — ป้ายชื่อ + ช่องกรอก (input/select/textarea) + ข้อความช่วย + ข้อความผิดพลาด
 *  - Field สร้าง id ให้เอง (useId) แล้วผูก <label htmlFor> กับช่องกรอกให้ถูก
 *    พร้อม aria-describedby ชี้ไปที่ข้อความช่วย/ข้อความผิดพลาด และ aria-invalid เมื่อมี error
 *  - ใช้แบบ render prop: ส่ง control props ที่ได้ไป spread บนช่องกรอกของคุณ
 *
 *      <Field label="ชื่อลูกค้า" required error={errors.name}>
 *        {(control) => <input {...control} type="text" name="name" />}
 *      </Field>
 *
 *      <Field label="สาขา" hint="เลือกสาขาที่ดูแล">
 *        {(control) => (
 *          <select {...control} name="branch">
 *            <option value="">— เลือก —</option>
 *          </select>
 *        )}
 *      </Field>
 *
 *  - control.className มีสไตล์ช่องกรอกมาตรฐานให้แล้ว (ขอบ/มุมโค้ง/โฟกัส/สถานะ error)
 *    ถ้าจะต่อ class เพิ่มให้ใช้ cx(control.className, "…")
 * สีทั้งหมดอ้าง token ใน app/globals.css ห้ามใส่ hex
 */
import { useId } from "react";
import type { ReactNode } from "react";
import { cx } from "./cx";

/** props ที่ Field แจกให้ช่องกรอก — spread ลงบน <input>/<select>/<textarea> ได้ตรงๆ */
export type FieldControlProps = {
  id: string;
  className: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  "aria-required": true | undefined;
};

export type FieldProps = {
  label: string;
  /** ข้อความช่วยใต้ช่องกรอก */
  hint?: string;
  /** ข้อความผิดพลาด (มีค่า = ช่องเป็นสถานะผิดพลาด) */
  error?: string;
  /** ทำเครื่องหมาย * หลังป้ายชื่อ และบอก screen reader ว่าจำเป็นต้องกรอก */
  required?: boolean;
  /** ระบุ id เอง (ถ้าไม่ระบุใช้ id ที่สร้างอัตโนมัติ) */
  id?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

const CONTROL_BASE_CLASS = [
  "w-full min-w-0 rounded-lg border bg-surface px-2.5 py-1.5 text-[13px] text-fg",
  "placeholder:text-fg-faint",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");

export function Field({ label, hint, error, required, id, className, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  const control: FieldControlProps = {
    id: controlId,
    className: cx(CONTROL_BASE_CLASS, error ? "border-danger" : "border-border-strong"),
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    "aria-required": required ? true : undefined,
  };

  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={controlId} className="text-[11px] text-fg-muted">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        ) : null}
      </label>
      {children(control)}
      {hint ? (
        <p id={hintId} className="m-0 text-[11.5px] text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="m-0 text-[11.5px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
