"use client";

/**
 * แถบตัวกรองของหน้าทะเบียนลูกค้า/สัญญา (mockup FINAL `#registry` ใน docs/mockup/aga-bait-registry-prototype.html)
 *
 * Logic summary:
 *   * ตัวกรอง: เขต · สาขา · ขนาด (Tier) · สถานะ (เลือกได้หลายค่า · ไม่เลือก = ทั้งหมด) · ปีสัญญา (1 ปี / 3 ปี) · ค้นหา
 *   * เลือกเขต → รายการสาขาแคบลงเหลือสาขาของเขตนั้น · สาขาที่ติ๊กไว้แต่ไม่อยู่ในเขตใหม่ถูกเอาออก
 *   * ตัวกรองเปลี่ยนเมื่อไหร่ → ส่ง RegistryFilters ใหม่ให้ตัวแม่ (ตัวแม่โหลดใหม่) · ที่นี่ไม่ยิง query เอง
 *   * คำค้น = ชื่อลูกค้า / เลขที่สัญญา · เป็น state ของตัวแม่ ไม่อยู่ใน URL (PDPA)
 *   * จอ ≤767px: ตัวกรองพับหลังปุ่ม "ตัวกรอง (n)" · ช่องกรอก 16px · เป้ากดสูง ≥44px · เรียงใช้ dropdown (ไม่มีหัวตาราง)
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { HistoryIcon } from "@/components/history/HistoryIcons";
import { Button, cx } from "@/components/ui";

import { countActiveFilters, SIZE_ORDER } from "./registryFilters";
import { STATUS_LABEL, STATUS_ORDER } from "./registryStatus";
import type { BranchRef, RegistryFilters, SortKey } from "./registryTypes";

export interface FilterBarProps {
  filters: RegistryFilters;
  branches: BranchRef[];
  search: string;
  exporting: boolean;
  onChange: (next: RegistryFilters) => void;
  onSearch: (text: string) => void;
  onReset: () => void;
  onExport: () => void;
}

interface Opt {
  value: string;
  label: string;
}

const FIELD_CLASS =
  "min-h-9 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg max-[767px]:min-h-11 max-[767px]:text-base";

export const SORT_LABEL: Record<SortKey, string> = {
  default: "วันเริ่มสัญญา ใหม่→เก่า (ค่าเริ่มต้น)",
  end_asc: "วันสิ้นสุด ใกล้→ไกล",
  end_desc: "วันสิ้นสุด ไกล→ใกล้",
  value_asc: "มูลค่า น้อย→มาก",
  value_desc: "มูลค่า มาก→น้อย",
};

function MultiSelect({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: Opt[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (ev: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(ev.target as Node)) ref.current.open = false;
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && ref.current?.open) ref.current.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const text =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? "1 รายการ")
        : `เลือก ${selected.length} รายการ`;

  return (
    <div className="flex min-w-0 flex-col gap-1 max-[767px]:w-full">
      <span className="text-xs text-fg-muted">{label}</span>
      <details ref={ref} className="relative">
        <summary
          className={cx(
            "flex min-h-9 max-w-[220px] cursor-pointer list-none items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] max-[767px]:min-h-11 max-[767px]:max-w-none max-[767px]:text-base",
            selected.length > 0 ? "border-accent bg-accent-soft font-semibold text-accent-strong" : "border-border-strong bg-surface text-fg",
          )}
        >
          <span className="truncate">{text}</span>
          <HistoryIcon name="chevron" className="rotate-90 text-fg-muted" />
        </summary>
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-max min-w-full max-w-[min(300px,86vw)] overflow-y-auto rounded-xl border border-border-strong bg-surface p-1.5 shadow-[var(--shadow)]">
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 block min-h-9 w-full rounded-md border-b border-border px-2 py-1.5 text-left text-xs text-accent-strong hover:bg-surface-2 max-[767px]:min-h-11"
          >
            ล้าง (เลือกทั้งหมด)
          </button>
          {options.length === 0 ? (
            <div className="px-2 py-2 text-xs text-fg-muted">ไม่มีตัวเลือก</div>
          ) : (
            options.map((o) => (
              <label key={o.value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-2 max-[767px]:min-h-11">
                <input
                  type="checkbox"
                  className="size-4 flex-none accent-accent"
                  checked={selected.includes(o.value)}
                  onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))}
                />
                {o.value === "XXL" ? <span className="tier xxl1">XXL</span> : o.label}
              </label>
            ))
          )}
        </div>
      </details>
    </div>
  );
}

export function RegistryFilterBar({ filters, branches, search, exporting, onChange, onSearch, onReset, onExport }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const active = countActiveFilters(filters) + (search.trim() ? 1 : 0);
  const set = (patch: Partial<RegistryFilters>) => onChange({ ...filters, ...patch });

  const zoneOpts = useMemo<Opt[]>(() => {
    const map = new Map<string, { name: string; order: number }>();
    for (const b of branches) map.set(b.zoneId, { name: b.zoneName, order: b.zoneOrder });
    return [...map.entries()]
      .sort((a, b) => a[1].order - b[1].order || a[1].name.localeCompare(b[1].name, "th", { numeric: true }))
      .map(([value, z]) => ({ value, label: z.name }));
  }, [branches]);
  const branchOpts = useMemo<Opt[]>(() => {
    const list = filters.zones.length === 0 ? branches : branches.filter((b) => filters.zones.includes(b.zoneId));
    return list.map((b) => ({ value: b.id, label: b.name }));
  }, [branches, filters.zones]);

  const onZones = (zones: string[]) => {
    // สาขาที่เลือกไว้แต่ไม่อยู่ในเขตใหม่ → เอาออก
    const keep = zones.length === 0 ? filters.branches : filters.branches.filter((id) => branches.find((b) => b.id === id && zones.includes(b.zoneId)));
    set({ zones, branches: keep });
  };

  return (
    <div className="mb-3 rounded-xl border border-border bg-surface p-3 max-[767px]:p-2.5">
      <div className="flex items-end gap-2 max-[767px]:flex-col max-[767px]:items-stretch">
        <label className="flex min-w-[220px] flex-col gap-1 max-[767px]:w-full">
          <span className="text-xs text-fg-muted">ค้นหา</span>
          <input
            type="search"
            data-tour="reg-search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="ชื่อลูกค้า / เลขที่สัญญา"
            autoComplete="off"
            className={cx(FIELD_CLASS, "w-full")}
          />
        </label>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="hidden min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-base text-fg max-[767px]:flex"
        >
          <HistoryIcon name="filter" />
          ตัวกรอง ({active})
        </button>
        <div className={cx("flex flex-1 flex-wrap items-end gap-2 max-[767px]:flex-col max-[767px]:items-stretch", !open && "max-[767px]:hidden")}>
          <MultiSelect label="เขต" allLabel="ทุกเขต" options={zoneOpts} selected={filters.zones} onChange={onZones} />
          <MultiSelect label="สาขา" allLabel="ทุกสาขา" options={branchOpts} selected={filters.branches} onChange={(branchesSel) => set({ branches: branchesSel })} />
          <MultiSelect
            label="ขนาด (Tier)"
            allLabel="ทุกขนาด"
            options={SIZE_ORDER.map((s) => ({ value: s, label: s }))}
            selected={filters.sizes}
            onChange={(sizes) => set({ sizes: sizes as RegistryFilters["sizes"] })}
          />
          <label className="flex min-w-0 flex-col gap-1 max-[767px]:w-full">
            <span className="text-xs text-fg-muted">ปีสัญญา</span>
            <select value={filters.years} onChange={(e) => set({ years: e.target.value as RegistryFilters["years"] })} className={FIELD_CLASS}>
              <option value="">ทุกแบบ</option>
              <option value="1">1 ปี (รวม Custom)</option>
              <option value="3">3 ปี</option>
            </select>
          </label>
          <MultiSelect
            label="สถานะ"
            allLabel="ทั้งหมด"
            options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            selected={filters.statuses}
            onChange={(statuses) => set({ statuses: statuses as RegistryFilters["statuses"] })}
          />
          <label className="hidden min-w-0 flex-col gap-1 max-[767px]:flex max-[767px]:w-full">
            <span className="text-xs text-fg-muted">เรียงตาม</span>
            <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} className={FIELD_CLASS}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {active > 0 ? (
            <Button size="sm" onClick={onReset} className="max-[767px]:min-h-11">
              <HistoryIcon name="close" /> ล้างตัวกรอง
            </Button>
          ) : null}
          <div className="ml-auto max-[767px]:ml-0">
            <Button size="sm" onClick={onExport} loading={exporting} className="max-[767px]:min-h-11 max-[767px]:w-full">
              <HistoryIcon name="download" /> ส่งออก Excel (CSV)
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
