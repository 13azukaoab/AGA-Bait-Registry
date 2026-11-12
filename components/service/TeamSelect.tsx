"use client";

/**
 * TeamSelect — เลือกทีมที่เข้า (เลือกได้หลายทีม · A–O และ Z · อย่างน้อย 1 ทีม)
 * ปุ่มแสดง "ทีม A, B" (เกิน 3 ทีมย่อเป็น +n) · กดแล้วเปิดรายการติ๊ก · Esc/คลิกนอกกล่องปิด
 */
import { useEffect, useRef, useState } from "react";

import { INPUT, INVALID } from "./styles";
import type { TeamOption } from "./types";
import { cx } from "@/components/ui/cx";

export function teamButtonText(codes: readonly string[]): string {
  if (codes.length === 0) return "";
  return `ทีม ${codes.slice(0, 3).join(", ")}${codes.length > 3 ? ` +${codes.length - 3}` : ""}`;
}

export function TeamSelect({
  id,
  teams,
  value,
  onChange,
  invalid,
}: {
  id: string;
  teams: readonly TeamOption[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const codes = teams.filter((t) => value.includes(t.id)).map((t) => t.code);

  return (
    <div ref={box} className="relative" data-field="teams">
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(INPUT, "flex cursor-pointer items-center justify-between text-left", invalid && INVALID)}
      >
        <span className={codes.length ? "" : "text-fg-faint"}>{codes.length ? teamButtonText(codes) : "เลือกทีม"}</span>
        <span aria-hidden="true" className="text-fg-muted">
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="เลือกทีมที่เข้า"
          className="absolute left-0 top-full z-30 mt-1 w-[220px] rounded-lg border border-border bg-surface p-2 shadow-[var(--shadow)]"
        >
          <div className="grid grid-cols-4 gap-1">
            {teams.map((t) => {
              const on = value.includes(t.id);
              return (
                <label key={t.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-[12.5px] hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onChange(on ? value.filter((v) => v !== t.id) : [...value, t.id])}
                  />
                  {t.code}
                </label>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11.5px] text-fg-muted">
            <span>เลือกได้หลายทีม</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-lg border border-accent bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg"
            >
              เสร็จ
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
