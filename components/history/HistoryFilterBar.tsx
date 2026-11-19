"use client";

/**
 * แถบตัวกรองของหน้าประวัติการแก้ไข (mockup FINAL docs/mockup/history-log.html)
 *
 * Logic summary:
 *   * ตัวกรองเปลี่ยนเมื่อไหร่ → ส่ง HistoryFilters ใหม่ให้ตัวแม่ (ตัวแม่ปรับช่วงวันที่ + โหลดใหม่) · ที่นี่ไม่ยิง query เอง
 *     ยกเว้น "ค้นเลขสัญญา" (เรียก onFindContract ของตัวแม่)
 *   * ตัวกรองหลายค่า = ติ๊กเลือก (ไม่ติ๊กเลย = ทั้งหมด) · แถบ "กรองอยู่:" มีชิป ✕ เอาออกทีละค่า
 *   * ค่าที่เก็บเป็น id / enum / วันที่ เท่านั้น (ใส่ใน URL ได้) · เลขสัญญาที่พิมพ์ไม่เก็บ — แปลงเป็น id แล้วทิ้ง
 *   * จอ ≤600px: ตัวกรองพับหลังปุ่ม "ตัวกรอง (n)" · ช่องกรอก 16px · เป้ากดสูง ≥44px
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, cx } from "@/components/ui";

import { HistoryIcon } from "./HistoryIcons";
import { countActiveFilters, defaultFilters } from "./historyFilters";
import { formatMonthKey } from "./historyDiff";
import { ACTION_LABEL, DATA_KINDS } from "./historyLabels";
import type { AuditAction, HistoryFilters, HistoryRefs } from "./historyTypes";

export interface FilterBarProps {
  filters: HistoryFilters;
  refs: HistoryRefs;
  todayYmd: string;
  /** เลขสัญญาของตัวกรองสัญญาที่ใช้อยู่ (เพื่อแสดงชิป) */
  contractLabel: string | null;
  rangeClamped: boolean;
  onChange: (next: HistoryFilters) => void;
  onFindContract: (contractNo: string) => Promise<"ok" | "notfound" | "error">;
  onReset: () => void;
}

interface Opt {
  value: string;
  label: string;
}

const FIELD_CLASS =
  "min-h-9 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg max-[767px]:min-h-11 max-[767px]:text-base";

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
    <div className="flex min-w-0 flex-col gap-1 max-[600px]:w-full">
      <span className="text-xs text-fg-muted">{label}</span>
      <details ref={ref} className="relative">
        <summary
          className={cx(
            "flex min-h-9 max-w-[220px] cursor-pointer list-none items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] max-[600px]:max-w-none max-[767px]:min-h-11",
            selected.length > 0
              ? "border-accent bg-accent-soft font-semibold text-accent-strong"
              : "border-border-strong bg-surface text-fg",
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
                {o.label}
              </label>
            ))
          )}
        </div>
      </details>
    </div>
  );
}

/** เดือนให้เลือก: 18 เดือนล่าสุด + เดือนที่เคยปิด */
function monthOptions(todayYmd: string, refs: HistoryRefs): Opt[] {
  const [y = 0, m = 1] = todayYmd.split("-").map(Number);
  const set = new Set<string>();
  for (let i = 0; i < 18; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    set.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  for (const c of refs.closures) set.add(c.monthKey);
  const closed = new Set(refs.closures.filter((c) => c.closedAt).map((c) => c.monthKey));
  return [...set]
    .sort()
    .reverse()
    .map((v) => ({ value: v, label: formatMonthKey(v) + (closed.has(v) ? " (ปิดแล้ว)" : "") }));
}

export function HistoryFilterBar({ filters, refs, todayYmd, contractLabel, rangeClamped, onChange, onFindContract, onReset }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const [contractInput, setContractInput] = useState("");
  const [contractMsg, setContractMsg] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);

  const active = countActiveFilters(filters, todayYmd);
  const set = (patch: Partial<HistoryFilters>) => onChange({ ...filters, ...patch });

  const zoneOpts = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of refs.branches) map.set(b.zoneId, b.zoneName);
    return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "th", { numeric: true }));
  }, [refs.branches]);
  const branchOpts = useMemo(() => {
    const inZone = filters.zones.length === 0 ? refs.branches : refs.branches.filter((b) => filters.zones.includes(b.zoneId));
    return inZone.map((b) => ({ value: b.id, label: b.name }));
  }, [refs.branches, filters.zones]);
  const peopleOpts = useMemo(() => refs.people.map((p) => ({ value: p.userId, label: p.displayName })), [refs.people]);
  const monthOpts = useMemo(() => monthOptions(todayYmd, refs), [todayYmd, refs]);
  const kindOpts = DATA_KINDS.map((k) => ({ value: k.code as string, label: k.label }));
  const actOpts = (Object.keys(ACTION_LABEL) as AuditAction[]).map((a) => ({ value: a, label: ACTION_LABEL[a] }));

  async function findContract() {
    if (!contractInput.trim() || finding) return;
    setFinding(true);
    setContractMsg(null);
    const r = await onFindContract(contractInput);
    setFinding(false);
    if (r === "ok") setContractInput("");
    else setContractMsg(r === "notfound" ? "ไม่พบเลขสัญญานี้" : "ค้นเลขสัญญาไม่สำเร็จ ลองใหม่อีกครั้ง");
  }

  // ----- ชิป "กรองอยู่" -----
  const chips: { key: string; text: string; remove: () => void; tone?: "warn" }[] = [];
  const base = defaultFilters(todayYmd);
  if (filters.from !== base.from || filters.to !== base.to) {
    chips.push({ key: "range", text: `ช่วงเวลา: ${filters.from} ถึง ${filters.to}`, remove: () => set({ from: base.from, to: base.to }) });
  }
  const labelOf = (opts: Opt[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
  filters.people.forEach((v) => chips.push({ key: `p${v}`, text: `ใคร: ${labelOf(peopleOpts, v)}`, remove: () => set({ people: filters.people.filter((x) => x !== v) }) }));
  filters.zones.forEach((v) => chips.push({ key: `z${v}`, text: `เขต: ${labelOf(zoneOpts, v)}`, remove: () => set({ zones: filters.zones.filter((x) => x !== v) }) }));
  filters.branches.forEach((v) => chips.push({ key: `b${v}`, text: `สาขา: ${labelOf(branchOpts, v)}`, remove: () => set({ branches: filters.branches.filter((x) => x !== v) }) }));
  if (filters.contractId) chips.push({ key: "c", text: `สัญญา: ${contractLabel ?? "ที่เลือก"}`, remove: () => set({ contractId: null }) });
  filters.months.forEach((v) => chips.push({ key: `m${v}`, text: `เดือนข้อมูล: ${formatMonthKey(v)}`, remove: () => set({ months: filters.months.filter((x) => x !== v) }) }));
  filters.kinds.forEach((v) => chips.push({ key: `k${v}`, text: `ประเภท: ${labelOf(kindOpts, v)}`, remove: () => set({ kinds: filters.kinds.filter((x) => x !== v) }) }));
  filters.actions.forEach((v) => chips.push({ key: `a${v}`, text: `การกระทำ: ${ACTION_LABEL[v]}`, remove: () => set({ actions: filters.actions.filter((x) => x !== v) }) }));
  if (filters.postCloseOnly) chips.push({ key: "pc", text: "เฉพาะแก้หลังปิดเดือน", tone: "warn", remove: () => set({ postCloseOnly: false }) });

  return (
    <div>
      <div className="hidden items-center gap-2 border-b border-border px-4 py-2.5 max-[600px]:flex">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="history-filters"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 flex-1 items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface px-3.5 text-[13.5px] font-semibold text-fg"
        >
          <span className="inline-flex items-center gap-2">
            <HistoryIcon name="filter" />
            ตัวกรอง
            {active > 0 && <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-fg">{active}</span>}
          </span>
          <HistoryIcon name="chevron" className={open ? "-rotate-90" : "rotate-90"} />
        </button>
      </div>

      <div
        id="history-filters"
        className={cx("flex-wrap items-end gap-2.5 border-b border-border px-4 py-3", open ? "flex" : "flex max-[600px]:hidden")}
      >
        <label className="flex flex-col gap-1 max-[600px]:w-full">
          <span className="text-xs text-fg-muted">ตั้งแต่วันที่</span>
          <input type="date" className={FIELD_CLASS} value={filters.from} max={filters.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 max-[600px]:w-full">
          <span className="text-xs text-fg-muted">ถึงวันที่</span>
          <input type="date" className={FIELD_CLASS} value={filters.to} min={filters.from} max={todayYmd} onChange={(e) => e.target.value && set({ to: e.target.value })} />
        </label>
        <MultiSelect label="ใคร" allLabel="ทุกคน" options={peopleOpts} selected={filters.people} onChange={(v) => set({ people: v })} />
        <MultiSelect
          label="เขต"
          allLabel="ทุกเขต"
          options={zoneOpts}
          selected={filters.zones}
          onChange={(v) => set({ zones: v, branches: filters.branches.filter((b) => v.length === 0 || refs.branches.some((x) => x.id === b && v.includes(x.zoneId))) })}
        />
        <MultiSelect label="สาขา" allLabel="ทุกสาขา" options={branchOpts} selected={filters.branches} onChange={(v) => set({ branches: v })} />
        <MultiSelect label="เดือนของข้อมูล" allLabel="ทุกเดือน" options={monthOpts} selected={filters.months} onChange={(v) => set({ months: v })} />
        <MultiSelect label="ประเภทข้อมูล" allLabel="ทุกประเภท" options={kindOpts} selected={filters.kinds} onChange={(v) => set({ kinds: v })} />
        <MultiSelect label="การกระทำ" allLabel="เพิ่ม / แก้ / ลบ" options={actOpts} selected={filters.actions} onChange={(v) => set({ actions: v as AuditAction[] })} />

        <div className="flex min-w-[210px] flex-col gap-1 max-[600px]:w-full">
          <label htmlFor="history-contract" className="text-xs text-fg-muted">เลขที่สัญญา (พิมพ์ให้ตรงตัว)</label>
          <div className="flex gap-1.5">
            <input
              id="history-contract"
              type="search"
              autoComplete="off"
              className={cx(FIELD_CLASS, "min-w-0 flex-1")}
              placeholder="เช่น CT26-0000142"
              value={contractInput}
              onChange={(e) => setContractInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void findContract()}
            />
            <Button variant="secondary" size="sm" onClick={() => void findContract()} loading={finding} className="max-[767px]:min-h-11">
              ค้น
            </Button>
          </div>
          {contractMsg && <span role="alert" className="text-xs text-danger">{contractMsg}</span>}
        </div>

        <label className="flex min-h-10 cursor-pointer items-center gap-2 px-1 text-[12.5px] text-fg max-[767px]:min-h-11">
          <input type="checkbox" className="size-[18px] accent-accent" checked={filters.postCloseOnly} onChange={(e) => set({ postCloseOnly: e.target.checked })} />
          เฉพาะ “แก้หลังปิดเดือน”
        </label>
      </div>

      {rangeClamped && (
        <p role="status" className="m-0 border-b border-border bg-warn-soft px-4 py-2 text-xs text-fg">
          ช่วงวันที่ยาวเกิน 1 ปี — ระบบตัดวันเริ่มให้เหลือ 1 ปีย้อนหลังจากวันสิ้นสุด
        </p>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5 text-xs text-fg-muted" aria-label="ตัวกรองที่ใช้อยู่">
          <span>กรองอยู่:</span>
          {chips.map((c) => (
            <span
              key={c.key}
              className={cx(
                "inline-flex max-w-full items-center rounded-full border pl-2.5 text-xs",
                c.tone === "warn" ? "border-warn bg-warn-soft text-fg" : "border-accent bg-accent-soft text-accent-strong",
              )}
            >
              <span className="truncate">{c.text}</span>
              <button
                type="button"
                onClick={c.remove}
                aria-label={`เอาตัวกรอง ${c.text} ออก`}
                className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-full hover:bg-surface max-[767px]:min-h-9 max-[767px]:min-w-9"
              >
                <HistoryIcon name="close" />
              </button>
            </span>
          ))}
          <button type="button" onClick={onReset} className="ml-1 min-h-7 rounded-md px-2 text-xs text-accent-strong hover:bg-surface-2 max-[767px]:min-h-11">
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
}
