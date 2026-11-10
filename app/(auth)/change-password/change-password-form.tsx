"use client";

/** ฟอร์มตั้งรหัสผ่านใหม่ — ตรวจความยาวและความตรงกันของ 2 ช่องซ้ำอีกครั้งฝั่ง server */
import { useActionState } from "react";

import {
  CHANGE_PASSWORD_INITIAL_STATE,
  PASSWORD_MIN_LENGTH,
  type ChangePasswordState,
} from "../form-state";
import {
  ALERT_DANGER,
  FIELD_HINT,
  FIELD_INPUT,
  FIELD_INPUT_ERROR,
  FIELD_LABEL,
  FIELD_WRAP,
  PRIMARY_BUTTON,
} from "../ui";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    CHANGE_PASSWORD_INITIAL_STATE,
  );

  const hasError = Boolean(state.error);
  const inputClass = `${FIELD_INPUT}${hasError ? ` ${FIELD_INPUT_ERROR}` : ""}`;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <p className={ALERT_DANGER} role="alert" aria-live="polite">
          <span aria-hidden="true">⚠ </span>
          {state.error}
        </p>
      ) : null}

      <div className={FIELD_WRAP}>
        <label className={FIELD_LABEL} htmlFor="password">
          รหัสผ่านใหม่
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className={inputClass}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          autoFocus
          required
          aria-describedby="password-hint"
        />
        <p className={FIELD_HINT} id="password-hint">
          ยาวอย่างน้อย {PASSWORD_MIN_LENGTH} ตัวอักษร และต้องไม่ซ้ำกับรหัสผ่านเดิม
        </p>
      </div>

      <div className={FIELD_WRAP}>
        <label className={FIELD_LABEL} htmlFor="confirmation">
          ยืนยันรหัสผ่านใหม่
        </label>
        <input
          id="confirmation"
          name="confirmation"
          type="password"
          className={inputClass}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
      </div>

      <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
        {pending ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}
      </button>
    </form>
  );
}
