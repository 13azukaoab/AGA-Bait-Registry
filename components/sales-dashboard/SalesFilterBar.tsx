"use client";

/**
 * ชุดตัวกรองเต็มของหน้า Dashboard งานขาย: ตั้งแต่เดือน · ถึงเดือน · เขต · สาขา · ผู้ขาย + ล้างตัวกรอง
 *
 * Logic summary:
 *   * ค่าเก็บเป็น id / 'YYYY-MM' / ชื่อผู้ขาย ในหน่วยความจำของหน้าเท่านั้น (ไม่ใส่ URL — ชื่อผู้ขายเป็นข้อความอิสระ · PDPA)
 *   * ตั้งช่วงเดือนกลับด้าน → อีกฝั่งตามมาให้เท่ากัน · เปลี่ยนเขต → ล้างสาขา · สาขาที่เลือกต้องอยู่ในเขตที่เลือก
 *   * ตัวเลือกเขต/สาขา/ผู้ขายมาจากแถวที่โหลดมา (ตามสิทธิ์ RLS ของผู้ใช้) — admin เห็นเฉพาะสาขาตน
 */
import { cx } from "@/components/ui";

import { monthShort } from "./salesFormat";
import { FIELD_CLASS } from "./salesStyle";
import type { SalesFilters } from "./salesTypes";

export interface RefOption {
  id: string;
  name: string;
}
export interface BranchOption extends RefOption {
  zoneId: string;
}

export interface SalesFilterBarProps {
  filters: SalesFilters;
  months: readonly string[];
  zones: readonly RefOption[];
  branches: readonly BranchOption[];
  sellers: readonly string[];
  hasUnnamedSeller: boolean;
  onChange: (next: SalesFilters) => void;
  onReset: () => void;
}

const UNNAMED = "__unnamed__";

export function SalesFilterBar({ filters, months, zones, branches, sellers, hasUnnamedSeller, onChange, onReset }: SalesFilterBarProps) {
  const visibleBranches = filters.zoneId ? branches.filter((b) => b.zoneId === filters.zoneId) : branches;
  const sellerValue = filters.seller === null ? "" : filters.seller === "" ? UNNAMED : filters.seller;

  const setFrom = (m: string) => onChange({ ...filters, fromMonth: m, toMonth: m > filters.toMonth ? m : filters.toMonth });
  const setTo = (m: string) => onChange({ ...filters, toMonth: m, fromMonth: m < filters.fromMonth ? m : filters.fromMonth });

  return (
    <section
      id="sales-filters"
      aria-label="ตัวกรอง"
      className="mb-3 grid scroll-mt-[calc(var(--topbar-h,0px)+8px)] grid-cols-[repeat(5,minmax(0,1fr))_auto] items-end gap-2.5 max-[1000px]:grid-cols-3 max-[767px]:grid-cols-2"
    >
      <Labeled label="ตั้งแต่เดือน">
        <select className={FIELD_CLASS} value={filters.fromMonth} onChange={(e) => setFrom(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthShort(m)}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label="ถึงเดือน">
        <select className={FIELD_CLASS} value={filters.toMonth} onChange={(e) => setTo(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthShort(m)}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label="เขต">
        <select
          className={FIELD_CLASS}
          value={filters.zoneId ?? ""}
          onChange={(e) => onChange({ ...filters, zoneId: e.target.value || null, branchId: null })}
        >
          <option value="">ทุกเขต</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label="สาขา">
        <select className={FIELD_CLASS} value={filters.branchId ?? ""} onChange={(e) => onChange({ ...filters, branchId: e.target.value || null })}>
          <option value="">ทุกสาขา</option>
          {visibleBranches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label="ผู้ขาย">
        <select
          className={FIELD_CLASS}
          value={sellerValue}
          onChange={(e) => onChange({ ...filters, seller: e.target.value === "" ? null : e.target.value === UNNAMED ? "" : e.target.value })}
        >
          <option value="">ทุกคน</option>
          {sellers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          {hasUnnamedSeller && <option value={UNNAMED}>ไม่ระบุผู้ขาย</option>}
        </select>
      </Labeled>
      <button
        type="button"
        onClick={onReset}
        className={cx(
          "min-h-10 rounded-lg border border-border-strong bg-surface px-3.5 text-[13.5px] text-fg hover:bg-surface-3 max-[767px]:min-h-11",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        ล้างตัวกรอง
      </button>
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-0.5 text-[12.5px] text-fg-muted">
      {label}
      {children}
    </label>
  );
}
