"use client";

/**
 * หน้า "ตั้งค่า" ฝั่ง client — โครงแท็บ (mockup FINAL `docs/mockup/settings.html`)
 *
 * Logic summary:
 *   * 3 แท็บ: เกณฑ์ Tier · ประเภทลูกค้า · ทีม (เกณฑ์ Workload อยู่ในแท็บทีมตาม mockup) — แท็บเป็น ARIA tablist (ลูกศรซ้าย/ขวา)
 *   * ข้อมูลทั้งหมดมาจาก server (page.tsx) · ทุกการเขียนผ่าน server action (settingsActions.ts) แล้ว `router.refresh()`
 *   * หน้านี้เข้าได้เฉพาะ host จึงไม่มีโหมดอ่านอย่างเดียว (ตำแหน่งอื่นถูกกันที่ middleware + page + action)
 *   * แต่ละแท็บมีตัวชี้ "แก้ที่ยังไม่บันทึก" ผ่าน useUnsavedWork ในแท็บนั้นๆ
 */
import { useRef, useState } from "react";

import { Toast, cx } from "@/components/ui";

import type { SettingsData } from "./settingsData";
import { TeamsTab } from "./TeamsTab";
import { TierTab } from "./TierTab";
import { TypesTab } from "./TypesTab";

type TabKey = "tier" | "types" | "teams";

export function SettingsClient({ data }: { data: SettingsData }) {
  const [tab, setTab] = useState<TabKey>("tier");
  const [toast, setToast] = useState("");
  const refs = useRef<Record<TabKey, HTMLButtonElement | null>>({ tier: null, types: null, teams: null });

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "tier", label: "เกณฑ์ Tier" },
    { key: "types", label: "ประเภทลูกค้า", count: data.customerTypes.length },
    { key: "teams", label: "ทีม", count: data.teams.length },
  ];

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    setTab(next.key);
    refs.current[next.key]?.focus();
  };

  return (
    <div>
      <div className="mb-3">
        <h1 className="m-0 text-xl font-semibold">ตั้งค่า</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          ข้อมูลหลักที่ทั้งระบบใช้ร่วมกัน · แก้ได้เฉพาะผู้ดูแลระบบ (PM / OM / เจ้าของ) · ทุกการแก้ไขบันทึกลงประวัติการแก้ไข
        </p>
      </div>

      <div role="tablist" aria-label="หมวดการตั้งค่า" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t, i) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-controls={`p-${t.key}`}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={cx(
                "-mb-px flex-none cursor-pointer whitespace-nowrap border-b-2 px-4 py-2.5 text-[13px] max-[640px]:min-h-11",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                on ? "border-accent font-semibold text-accent-strong" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
              {t.count !== undefined ? (
                <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-fg-muted">{t.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === "tier" ? (
        <section id="p-tier" role="tabpanel" aria-labelledby="tab-tier">
          <TierTab key={JSON.stringify(data.ruleSets)} data={data} onToast={setToast} />
        </section>
      ) : null}
      {tab === "types" ? (
        <section id="p-types" role="tabpanel" aria-labelledby="tab-types">
          <TypesTab data={data} onToast={setToast} />
        </section>
      ) : null}
      {tab === "teams" ? (
        <section id="p-teams" role="tabpanel" aria-labelledby="tab-teams">
          <TeamsTab data={data} onToast={setToast} />
        </section>
      ) : null}

      <Toast message={toast} onClose={() => setToast("")} durationMs={4500} />
    </div>
  );
}
