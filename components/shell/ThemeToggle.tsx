"use client";

import { useSyncExternalStore } from "react";
import {
  nextThemePreference,
  readThemePreference,
  subscribeThemePreference,
  writeThemePreference,
  type ThemePreference,
} from "./theme";

const THEME_UI: Record<ThemePreference, { icon: string; label: string }> = {
  system: { icon: "◐", label: "ตามเครื่อง" },
  light: { icon: "☀", label: "สว่าง" },
  dark: { icon: "☾", label: "มืด" },
};

const getServerPreference = (): ThemePreference => "system";

/** ปุ่มสลับธีม ตามเครื่อง → สว่าง → มืด → ตามเครื่อง (กดวนไปเรื่อยๆ) */
export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribeThemePreference,
    readThemePreference,
    getServerPreference,
  );
  const current = THEME_UI[preference];
  const next = THEME_UI[nextThemePreference(preference)];

  return (
    <button
      type="button"
      onClick={() => writeThemePreference(nextThemePreference(preference))}
      aria-label={`โหมดสี: ${current.label} (กดเพื่อเปลี่ยนเป็น${next.label})`}
      title={`โหมดสี: ${current.label}`}
      className="inline-flex h-[34px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-[13px] text-fg hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span aria-hidden="true" className="text-base leading-none">
        {current.icon}
      </span>
      <span className="max-[600px]:hidden">{current.label}</span>
    </button>
  );
}
