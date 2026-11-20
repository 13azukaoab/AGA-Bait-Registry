"use client";

/**
 * TutorialButton — ปุ่ม “สอนใช้งาน” บนแถบบน: เปิดเมนูเลือกบทเรียนมาดูซ้ำได้ทุกเมื่อ
 * (ส่วนกลาง + บทเรียนของตำแหน่งตัวเอง) · เป็นจุดชี้ `data-tour="help-btn"` ของขั้นท้ายๆ ในบทเรียน
 * ปิดเมนูด้วย Esc / คลิกนอกเมนู / เลือกบทเรียน
 */
import { useEffect, useId, useRef, useState } from "react";

import { useTutorial } from "./TutorialProvider";
import styles from "./tutorial.module.css";

export function TutorialButton() {
  const { lessonOptions, start, snapshot } = useTutorial();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const running = snapshot.running;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    wrapRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={styles.menuWrap}>
      <button
        ref={btnRef}
        type="button"
        data-tour="help-btn"
        aria-haspopup="menu"
        aria-expanded={open && !running}
        aria-controls={open ? menuId : undefined}
        aria-label="สอนใช้งาน"
        title="สอนใช้งาน"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-[34px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-[13px] text-fg hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-[767px]:h-11 max-[767px]:min-w-11"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01" />
        </svg>
        <span className="max-[600px]:hidden">สอนใช้งาน</span>
      </button>
      {open && !running ? (
        <div id={menuId} role="menu" aria-label="บทเรียนสอนใช้งาน" className={styles.menu}>
          <p className={styles.menuTitle}>เปิดดูบทเรียนซ้ำ</p>
          {lessonOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                start(option.id);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
