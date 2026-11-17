/**
 * SummaryCards — ส่วนสรุปของหน้า /todo: การ์ดความคืบหน้า · การ์ดตัวเลข 3 ใบ · รายการ "ยังไม่กรอก" · รายการกล่อง AG รอถอด
 * (presentational ล้วน · ตัวเลขมาจาก data.ts / logic.ts)
 */
import Link from "next/link";
import type { ReactNode } from "react";

import type { ContractListItem } from "@/components/service/types";
import { TierBadge } from "@/components/ui";
import { monthLabel } from "@/lib/service/months";

import type { AgPendingItem } from "./data";
import type { CollectSummary, Progress } from "./logic";

const CARD = "rounded-xl border border-border bg-surface shadow-[var(--shadow)]";
const LIST_LIMIT = 10;

export function ProgressCard({ month, progress }: { month: string; progress: Progress }) {
  return (
    <section aria-labelledby="progress-title" className={`${CARD} mb-4`}>
      <h2 id="progress-title" className="m-0 flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-[15px] font-semibold">
        <span aria-hidden className="size-2.5 rounded-full bg-accent" />
        สถานะงานกรอกผล · {monthLabel(month)}
        <span className="text-xs font-normal text-fg-muted">เดือนที่ยังไม่ปิดเก่าสุด · ปิดเดือนแล้วหน้านี้เลื่อนไปเดือนถัดไปเอง</span>
      </h2>
      <div className="px-4 py-4">
        <div className="mb-2 flex justify-between text-[13px]">
          <span>
            กรอกผลแล้ว <b className="tabular-nums">{progress.filled}</b> / {progress.total} ราย
          </span>
          <span className="font-semibold tabular-nums text-ok">{progress.percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="ความคืบหน้าการกรอกผลบริการ"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          className="h-3 overflow-hidden rounded-full bg-surface-3"
        >
          <div className="h-full bg-ok" style={{ width: `${progress.percent}%` }} />
        </div>
        <div className="mt-2 text-xs text-fg-muted">
          เหลือยังไม่กรอก <b className={`tabular-nums ${progress.remaining ? "text-danger" : "text-ok"}`}>{progress.remaining}</b> ราย
        </div>
      </div>
    </section>
  );
}

function Stat({ tone, label, value, unit, sub }: { tone: "danger" | "warn" | "accent" | "ok"; label: string; value: number; unit?: string; sub: ReactNode }) {
  const dot = { danger: "bg-danger", warn: "bg-warn", accent: "bg-accent", ok: "bg-ok" }[tone];
  return (
    <div className={`${CARD} px-4 py-3`}>
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <span aria-hidden className={`size-2.5 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-1 text-[26px] font-bold tabular-nums">
        {value}
        {unit ? <span className="ml-1 text-sm font-medium text-fg-muted">{unit}</span> : null}
      </div>
      <div className="text-xs text-fg-muted">{sub}</div>
    </div>
  );
}

export function StatCards({
  missedCount,
  collect,
  agPendingCount,
}: {
  missedCount: number;
  collect: CollectSummary;
  agPendingCount: number;
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 max-[560px]:grid-cols-1 md:grid-cols-3">
      <Stat
        tone={missedCount ? "danger" : "ok"}
        label="เรื่องตกบริการรอตัดสิน"
        value={missedCount}
        sub="ค้างจากเดือนก่อน · บันทึกบริการชดเชย หรือ ไม่ชดเชย"
      />
      <Stat
        tone={collect.customers ? "warn" : "ok"}
        label="ลูกค้ารอเก็บสถานี"
        value={collect.customers}
        unit="ราย"
        sub={
          <>
            IG เหลือ {collect.stations} สถานี ·{" "}
            <Link href="/collection" className="inline-block py-2.5 -my-2.5 text-accent underline">
              ดูรายการ →
            </Link>
          </>
        }
      />
      <Stat tone="accent" label="กล่องเหยื่อรอถอด" value={agPendingCount} sub="พบปลวกตายแล้ว · รอถอด" />
    </div>
  );
}

export function ListCard({
  title,
  count,
  tone,
  empty,
  footerHref,
  footerLabel,
  note,
  children,
}: {
  title: string;
  count: number;
  tone: "danger" | "accent";
  empty: string;
  footerHref: string;
  footerLabel: string;
  note?: string;
  children: ReactNode;
}) {
  const dot = tone === "danger" ? "bg-danger" : "bg-accent";
  const badge = tone === "danger" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent-strong";
  return (
    <section className={CARD}>
      <h2 className="m-0 flex items-center gap-2 border-b border-border px-4 py-3 text-[15px] font-semibold">
        <span aria-hidden className={`size-2.5 rounded-full ${dot}`} />
        {title}
        <span className={`rounded-full px-2 text-xs ${badge}`}>{count}</span>
      </h2>
      {note ? <p className="m-0 border-b border-border px-4 py-2 text-xs text-fg-muted">{note}</p> : null}
      {count === 0 ? <p className="m-0 px-4 py-4 text-[13px] text-fg-muted">{empty}</p> : <ul className="m-0 list-none p-0">{children}</ul>}
      <div className="border-t border-border px-4 py-2">
        <Link href={footerHref} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent md:min-h-10">
          {footerLabel}
        </Link>
      </div>
    </section>
  );
}

export function UnfilledList({ items }: { items: readonly ContractListItem[] }) {
  return items.slice(0, LIST_LIMIT).map((c) => (
    <li key={c.contractId} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <b className="block truncate text-[13px]">{c.customerName}</b>
        <small className="text-[12.5px] text-fg-muted">{c.contractNo}</small>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-danger">
        <TierBadge tier={c.tier} termMonths={c.termMonths} />
        ยังไม่กรอก
      </div>
    </li>
  ));
}

export function AgList({ items }: { items: readonly AgPendingItem[] }) {
  return items.slice(0, LIST_LIMIT).map((a) => (
    <li key={a.stationId} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <b className="block truncate text-[13px]">
          AG{a.label ? ` จุดที่ ${a.label}` : ""} · {a.customerName}
        </b>
        <small className="text-[12.5px] text-fg-muted">
          สาขา{a.branchName} · {a.contractNo} · พบปลวกตาย · รอถอด
        </small>
      </div>
    </li>
  ));
}
