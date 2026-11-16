"use client";

/**
 * TeamPicker — เลือกทีมที่ดูแลสัญญา (เลือกได้หลายทีม · master จากตาราง teams)
 * ปุ่มแสดงรหัสทีมที่เลือก (เช่น "A, E") · ยังไม่เลือก = "—" · กดแล้วเปิดรายการติ๊กเลือก
 *
 * M26/M33: รายการซ่อนทีมที่ปิดใช้งานและทีมหัวหน้างาน (DB ปฏิเสธ TM004/TM005) — ยกเว้นทีมที่ถูกเลือกอยู่แล้ว
 * (งานเก่า) ยังโชว์ติดป้าย "ปิดใช้งาน"/"หัวหน้างาน" ติ๊กออกได้ แต่ติ๊กกลับไม่ได้ (ออกจากรายการเมื่อติ๊กออก)
 */
import { useEffect, useRef, useState } from "react";

import { isTeamAssignableToContract, teamUnavailableNote, teamsForPicker } from "@/lib/service/teamKind";

import type { TeamOption } from "./types";

export function TeamPicker({
  teams,
  value,
  onChange,
  label,
}: {
  teams: readonly TeamOption[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  label: string;
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

  const options = teamsForPicker(teams, value, isTeamAssignableToContract);
  const chosen = teams.filter((t) => value.includes(t.id)).map((t) => t.code);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${chosen.length ? chosen.join(", ") : "ยังไม่เลือก"}`}
        onClick={() => setOpen((v) => !v)}
        className="w-full cursor-pointer rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-left text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        {chosen.length ? chosen.join(", ") : <span className="text-fg-faint">—</span>}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 grid w-[168px] grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-2 shadow-[var(--shadow)]">
          {options.map((t) => {
            const on = value.includes(t.id);
            const note = teamUnavailableNote(t);
            return (
              <label
                key={t.id}
                title={note ? `ทีมนี้${note} — เป็นทีมเดิมของงานนี้ เอาออกได้ แต่เพิ่มกลับไม่ได้` : undefined}
                className={`flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[12.5px] hover:bg-surface-2${note ? " col-span-3" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    onChange(on ? value.filter((id) => id !== t.id) : [...value, t.id])
                  }
                />
                {t.code}
                {note ? <span className="text-[10.5px] text-fg-faint">({note})</span> : null}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
