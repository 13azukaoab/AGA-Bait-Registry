"use client";

/**
 * แถบประเภทงานที่ติดด้านบนตอนเลื่อน (mockup FINAL ?v=b · DECISIONS 2.91)
 *
 * Logic summary:
 *   * ปุ่มแบบ segmented "ทั้งหมด | New | Renew" ชุดเดียวของทั้งหน้า (aria-pressed) + บรรทัดสรุปตัวกรองที่เหลือ 1 บรรทัด
 *   * กดบรรทัดสรุป = เลื่อนกลับไปที่ชุดตัวกรองเต็ม (id `sales-filters`) แล้วโฟกัสช่องแรก
 *   * ติดใต้ Topbar ของแอปด้วยตัวแปรเดียว `--topbar-h` (AppShell ตั้งไว้) — ห้าม hardcode ความสูง
 *   * sticky ใช้ได้เพราะ ancestor ไม่มี overflow (ห้ามเพิ่ม overflow ให้ parent ของแถบนี้)
 *   * เงาตอนลอย: คำนวณจากตำแหน่งจริงทุกครั้งที่เลื่อน/ปรับขนาด + IntersectionObserver สำรอง
 *   * สูงรวมบนมือถือ ≈ 96px (ปุ่ม 44px สองแถว) · พื้นทึบ token `bg`
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui";

import type { SalesTypeFilter } from "./salesView";

const OPTIONS: ReadonlyArray<{ value: SalesTypeFilter; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "new", label: "New" },
  { value: "renew", label: "Renew" },
];

export interface SalesStickyBarProps {
  type: SalesTypeFilter;
  onTypeChange: (t: SalesTypeFilter) => void;
  summary: string;
}

export function SalesStickyBar({ type, onTypeChange, summary }: SalesStickyBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  const update = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const topPx = parseFloat(getComputedStyle(bar).top) || 0;
    setStuck(window.scrollY > 0 && bar.getBoundingClientRect().top <= topPx + 1);
  }, []);

  useEffect(() => {
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    let observer: IntersectionObserver | null = null;
    if (sentinelRef.current && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(update);
      observer.observe(sentinelRef.current);
    }
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [update]);

  const goToFilters = () => {
    const target = document.getElementById("sales-filters");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.querySelector<HTMLElement>("select")?.focus({ preventScroll: true });
  };

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="pointer-events-none -mb-px h-px" />
      <div
        ref={barRef}
        className={cx(
          "sticky top-[var(--topbar-h,0px)] z-10 -mx-4 mb-3 flex items-center gap-3 border-b border-border bg-bg px-4 py-1",
          "max-[767px]:-mx-3 max-[767px]:flex-col max-[767px]:items-stretch max-[767px]:gap-0 max-[767px]:px-3",
          stuck && "shadow-[0_3px_6px_var(--border-strong)]",
        )}
      >
        <div
          role="group"
          aria-label="ประเภทงาน"
          className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border-strong bg-surface max-[767px]:flex"
        >
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={type === o.value}
              onClick={() => onTypeChange(o.value)}
              className={cx(
                "min-h-11 min-w-[84px] px-3.5 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent max-[767px]:flex-1 max-[767px]:min-w-0",
                type === o.value ? "bg-accent font-semibold text-accent-fg" : "bg-surface text-fg hover:bg-surface-2",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={goToFilters}
          aria-label={`ตัวกรองตอนนี้: ${summary} — กดเพื่อเลื่อนกลับไปที่ชุดตัวกรอง`}
          className="min-h-11 min-w-0 flex-1 truncate rounded px-1 text-left text-[13px] text-fg-muted hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent max-[767px]:w-full max-[767px]:flex-none"
        >
          {summary}
        </button>
      </div>
    </>
  );
}
