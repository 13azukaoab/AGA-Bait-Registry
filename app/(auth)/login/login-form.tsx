"use client";

/**
 * ฟอร์มเข้าสู่ระบบ — ส่งไปให้ server action `loginAction` (ฝั่ง client ไม่รู้เรื่องอีเมลเลย)
 * ยึดหน้าตาตาม docs/mockup/login.html: ช่องชื่อผู้ใช้ + รหัสผ่าน + ปุ่มแสดง/ซ่อนรหัส
 */
import { useActionState, useState } from "react";

import { LOGIN_INITIAL_STATE, type LoginState } from "../form-state";
import {
  ALERT_DANGER,
  FIELD_HINT,
  FIELD_INPUT,
  FIELD_INPUT_ERROR,
  FIELD_LABEL,
  FIELD_WRAP,
  PRIMARY_BUTTON,
} from "../ui";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    LOGIN_INITIAL_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);

  const hasError = Boolean(state.error);
  const inputClass = `${FIELD_INPUT}${hasError ? ` ${FIELD_INPUT_ERROR}` : ""}`;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p className={ALERT_DANGER} role="alert" aria-live="polite">
          <span aria-hidden="true">⚠ </span>
          {state.error}
        </p>
      ) : null}

      <div className={FIELD_WRAP}>
        <label className={FIELD_LABEL} htmlFor="username">
          ชื่อผู้ใช้
        </label>
        <input
          id="username"
          name="username"
          type="text"
          className={inputClass}
          placeholder="เช่น somsri.k"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          aria-describedby="username-hint"
        />
        <p className={FIELD_HINT} id="username-hint">
          ใช้ชื่อผู้ใช้ที่ Host สร้างให้ ไม่ต้องพิมพ์อีเมล
        </p>
      </div>

      <div className={FIELD_WRAP}>
        <label className={FIELD_LABEL} htmlFor="password">
          รหัสผ่าน
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            className={`${inputClass} pr-12`}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 px-3 text-fg-muted hover:text-fg"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            aria-pressed={showPassword}
            title="แสดง/ซ่อนรหัสผ่าน"
          >
            <span aria-hidden="true">👁</span>
          </button>
        </div>
      </div>

      <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
        {pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
