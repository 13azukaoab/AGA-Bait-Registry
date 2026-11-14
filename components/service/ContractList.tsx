"use client";

/**
 * ContractList — ฝั่งซ้ายของหน้ากรอกข้อมูลทำบริการ: ตัวกรอง เขต/สาขา/เดือน (แถวเดียว ไม่มีตัวกรองทีม) · ช่องค้นหาช่องเดียว
 * (ชื่อ หรือ เลขสัญญา · ไม่พบตรงตัว → "หมายถึงรายนี้ไหม") · แถบความคืบหน้า · สลับ ยังไม่กรอก/กรอกแล้ว · รายชื่อ
 * (ป้าย Tier, "AG n", "กรอกแล้ว") — แผงตรึงข้างจอบนจอใหญ่
 *
 * `variant="offround"` (หน้า /bait "กล่อง AG นอกรอบประจำเดือน"): ไม่มีแถบความคืบหน้า/ป้าย "กรอกแล้ว" ·
 * สลับเป็น "มีกล่องค้างติดตาม / ทุกราย" (mockup #bait FINAL)
 */
import { useMemo } from "react";

import { Chip, TierBadge } from "@/components/ui";
import { cx } from "@/components/ui/cx";

import { MonthTagBadge } from "./MonthTagBadge";
import { monthChoices, monthLabel } from "@/lib/service/months";
import { searchContracts } from "./search";
import { INPUT, LABEL } from "./styles";
import type { BranchOption, ContractListItem, ZoneOption } from "./types";

export type ListView = "todo" | "done" | "ag" | "all";
export type ListVariant = "round" | "offround";

export function ContractList({
  zones,
  branches,
  zoneId,
  branchId,
  month,
  currentMonth,
  items,
  truncated,
  selectedId,
  query,
  view,
  variant = "round",
  onFilter,
  onQuery,
  onView,
  onSelect,
}: {
  zones: readonly ZoneOption[];
  branches: readonly BranchOption[];
  zoneId: string;
  branchId: string;
  month: string;
  currentMonth: string;
  items: readonly ContractListItem[];
  truncated: boolean;
  selectedId: string | null;
  query: string;
  view: ListView;
  variant?: ListVariant;
  onFilter: (next: { zoneId?: string; branchId?: string; month?: string }) => void;
  onQuery: (q: string) => void;
  onView: (v: ListView) => void;
  onSelect: (id: string) => void;
}) {
  const zoneBranches = branches.filter((b) => b.zoneId === zoneId);
  const done = items.filter((c) => c.routineCountInMonth > 0).length;
  const total = items.length;
  const pct = total ? Math.round((done * 100) / total) : 0;

  const search = useMemo(() => searchContracts(items, query), [items, query]);
  const offround = variant === "offround";
  const toggles: readonly (readonly [ListView, string])[] = offround
    ? [
        ["ag", "มีกล่องค้างติดตาม"],
        ["all", "ทุกราย"],
      ]
    : [
        ["todo", "ยังไม่กรอก"],
        ["done", "กรอกแล้ว"],
      ];
  const visible = search.searching
    ? search.items
    : items.filter((c) => (offround ? view === "all" || c.agCount > 0 : (view === "done") === c.routineCountInMonth > 0));

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-24px)]">
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[14px] font-semibold">ลูกค้า</h2>
        <Chip tone="na">{total} ราย</Chip>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="sv-zone" className={LABEL}>
            เขต
          </label>
          <select
            id="sv-zone"
            value={zoneId}
            onChange={(e) => onFilter({ zoneId: e.target.value, branchId: "" })}
            className={INPUT}
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="sv-branch" className={LABEL}>
            สาขา
          </label>
          <select id="sv-branch" value={branchId} onChange={(e) => onFilter({ branchId: e.target.value })} className={INPUT}>
            <option value="">ทุกสาขา</option>
            {zoneBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="sv-month" className={LABEL}>
            เดือน
          </label>
          <select id="sv-month" value={month} onChange={(e) => onFilter({ month: e.target.value })} className={INPUT}>
            {monthChoices(currentMonth).map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <input
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="พิมพ์ชื่อลูกค้า หรือเลขที่สัญญา"
        aria-label="ค้นหาลูกค้า ด้วยชื่อหรือเลขที่สัญญา"
        className={INPUT}
      />

      {search.searching && search.items.length === 0 ? (
        <div role="status" className="rounded-lg bg-warn-soft px-2.5 py-2 text-[12.5px]">
          {search.suggestions.length > 0 ? (
            <>
              <div>ไม่พบตรงตัว หมายถึงรายนี้ไหม</div>
              <div className="mt-1 flex flex-col gap-1">
                {search.suggestions.map((c) => (
                  <button
                    key={c.contractId}
                    type="button"
                    onClick={() => {
                      onQuery("");
                      onSelect(c.contractId);
                    }}
                    className="cursor-pointer rounded border border-border bg-surface px-2 py-1 text-left text-[13px] hover:bg-surface-2"
                  >
                    {c.customerName} <small className="text-fg-muted">{c.contractNo}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div>ไม่พบ ลองพิมพ์สั้นลง หรือเปลี่ยนตัวกรอง</div>
          )}
        </div>
      ) : null}

      {offround ? null : (
      <div>
        <div className="flex items-center justify-between text-[12.5px]">
          <span>
            กรอกแล้ว <b className="num">{done}</b> / <span className="num">{total}</span>
          </span>
          <span className="num text-fg-muted">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label="ความคืบหน้าการกรอกข้อมูลทำบริการ"
          className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-3"
        >
          <div className="h-full bg-ok" style={{ width: `${pct}%` }} />
        </div>
      </div>
      )}

      <div role="group" aria-label="กรองรายชื่อ" className="grid grid-cols-2 gap-1 rounded-lg bg-surface-3 p-1">
        {toggles.map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => onView(v)}
            className={cx(
              "cursor-pointer rounded-md px-2 py-1 text-[12.5px]",
              view === v ? "bg-surface font-semibold text-fg shadow-[var(--shadow)]" : "text-fg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {truncated ? (
        <p className="m-0 text-[11.5px] text-warn">แสดงได้สูงสุด 1,000 ราย — เลือกสาขาเพื่อดูครบ</p>
      ) : null}

      <div className="flex min-h-[120px] flex-col gap-1 overflow-y-auto" role="list" aria-label="รายชื่อสัญญา">
        {visible.length === 0 && !search.searching ? (
          <p className="m-0 px-1 py-4 text-center text-[12.5px] text-fg-muted">
            {total === 0
              ? "ไม่มีสัญญาที่อยู่ในช่วงบริการของเดือนนี้ตามตัวกรองนี้ — ลองเปลี่ยนสาขา/เดือน"
              : offround
                ? "ไม่มีลูกค้าที่มีกล่องค้างติดตามตามตัวกรองนี้"
                : view === "done"
                  ? "ยังไม่มีรายที่กรอกแล้ว"
                  : "ไม่มีรายที่ยังไม่กรอก — ครบแล้ว"}
          </p>
        ) : null}
        {visible.map((c) => (
          <button
            key={c.contractId}
            type="button"
            role="listitem"
            aria-current={selectedId === c.contractId ? "true" : undefined}
            onClick={() => onSelect(c.contractId)}
            className={cx(
              "flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left",
              selectedId === c.contractId ? "border-accent bg-accent-soft" : "border-transparent hover:bg-surface-2",
            )}
          >
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[13px]">{c.customerName}</b>
              <small className="block truncate text-[11.5px] text-fg-muted">
                {c.contractNo}
                {c.stationsInitialized ? "" : " · รอระบุจำนวนสถานี"}
              </small>
              {c.monthTag ? <MonthTagBadge tag={c.monthTag} /> : null}
            </span>
            <span className="flex flex-none flex-wrap items-center justify-end gap-1">
              <TierBadge tier={c.tier} years={c.termYears} />
              {c.agCount > 0 ? (
                <span className="rounded bg-warn-soft px-1.5 py-px text-[11px] font-semibold text-warn">AG {c.agCount}</span>
              ) : null}
              {!offround && c.routineCountInMonth > 0 && (search.searching || view !== "done") ? (
                <Chip tone="ok">กรอกแล้ว</Chip>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
