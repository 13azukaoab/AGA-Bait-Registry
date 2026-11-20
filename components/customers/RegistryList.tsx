"use client";

/**
 * รายการสัญญาในทะเบียน — ตาราง (จอ ≥768px) และการ์ด (จอ ≤767px) ใช้ข้อมูลชุดเดียวกัน (mockup FINAL `#registry`)
 *
 * Logic summary:
 *   * คอลัมน์: # · ลูกค้า (ลิงก์ไปรายละเอียด + ชนิด · จำนวนสถานี + ปุ่มประวัติสำหรับ host) · สัญญา·ระยะเวลา (เลขที่ + แถบเวลา)
 *     · สาขา·เขต · มูลค่า (+ ต่อปี) · Tier (อัตโนมัติ) · สถานะ
 *   * เรียงได้ที่หัว "สัญญา·ระยะเวลา" (วันสิ้นสุด) และ "มูลค่า" — คลิก: น้อย→มาก → มาก→น้อย → ลำดับเดิม (เรียงฝั่งฐานข้อมูล)
 *   * ลิงก์ไปหน้าลูกค้าสร้างจาก customerDetailHref (lib/links) · ลิงก์ประวัติ = /admin/history?c=<contract id> (host เท่านั้น)
 *   * สี/ป้ายอ้าง token และ TierBadge (--tier-*-ink) เท่านั้น · แถว "ใกล้หมด" ขีดซ้ายสีเตือน
 */
import Link from "next/link";

import { HistoryIcon } from "@/components/history/HistoryIcons";
import { Chip, cx, TierBadge, type ChipTone } from "@/components/ui";
import type { UserRole } from "@/lib/db/types";
import { customerDetailHref, customerLinkContexts } from "@/lib/links/customerLink";

import { nextSort, sortDirection, type SortColumn } from "./registryFilters";
import { fmtDate, remainingOf, STATUS_LABEL } from "./registryStatus";
import type { RegistryRow, RegistryStatus, SortKey } from "./registryTypes";

const STATUS_TONE: Record<RegistryStatus, ChipTone> = {
  active: "ok",
  near_end: "pend",
  pending_collection: "info",
  ended: "na",
  paused: "na",
  cancelled: "miss",
};

const BAR_TONE = { ok: "bg-ok", warn: "bg-warn", end: "bg-fg-faint" } as const;
const TEXT_TONE = { ok: "text-fg-muted", warn: "text-warn font-semibold", end: "text-fg-muted" } as const;

const fmtMoney = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

interface Props {
  rows: RegistryRow[];
  today: string;
  role: UserRole;
  sort: SortKey;
  onSort: (next: SortKey) => void;
}

function StatusChip({ status }: { status: RegistryStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>;
}

function TierCell({ row }: { row: RegistryRow }) {
  return row.tier ? <TierBadge tier={row.tier} termMonths={row.termMonths} /> : <span className="text-fg-muted" title="ไม่มีเกณฑ์ Tier ของเดือนเริ่มสัญญา">—</span>;
}

function TimeBar({ row, today }: { row: RegistryRow; today: string }) {
  const rem = remainingOf(row.startDate, row.endDate, today, row.status);
  return (
    <>
      <div role="img" aria-label={`ผ่านไป ${Math.round(rem.percent)}% ของสัญญา`} className="mt-1 h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-surface-3">
        <i className={cx("block h-full rounded-full", BAR_TONE[rem.tone])} style={{ width: `${rem.percent.toFixed(1)}%` }} />
      </div>
      <small className={cx("mt-1 block text-xs", TEXT_TONE[rem.tone])}>{rem.text}</small>
    </>
  );
}

function CustomerName({ row, role }: { row: RegistryRow; role: UserRole }) {
  const href = customerDetailHref(row.customerId, customerLinkContexts.contract(row.contractId));
  return (
    <>
      {href ? (
        <Link href={href} className="font-semibold text-accent-strong hover:underline max-[767px]:inline-flex max-[767px]:min-h-11 max-[767px]:items-center" aria-label={`ดูรายละเอียดลูกค้า ${row.customerName}`}>
          {row.customerName || "(ไม่มีชื่อ)"}
        </Link>
      ) : (
        <b>{row.customerName}</b>
      )}
      {role === "host" ? (
        <Link
          href={`/admin/history?c=${row.contractId}`}
          className="ml-1.5 inline-flex min-h-6 items-center gap-1 rounded-md border border-border px-1.5 text-xs text-fg-muted hover:bg-surface-2 max-[767px]:min-h-11 max-[767px]:px-2.5"
          title="ดูประวัติการแก้ไขของสัญญานี้"
        >
          <HistoryIcon name="history" /> ประวัติ
        </Link>
      ) : null}
      <small className="mt-0.5 block text-xs text-fg-muted">
        {[row.customerTypeLabel, row.stationCount !== null ? `${row.stationCount} สถานี` : null].filter(Boolean).join(" · ")}
      </small>
    </>
  );
}

function SortTh({ col, sort, onSort, children, align }: { col: SortColumn; sort: SortKey; onSort: (s: SortKey) => void; children: React.ReactNode; align?: "right" }) {
  const dir = sortDirection(sort, col);
  return (
    <th scope="col" aria-sort={dir} className={cx("sticky top-0 z-10 border-b border-border bg-surface-2 px-3 py-2.5 text-xs font-semibold", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, col))}
        className={cx("inline-flex min-h-8 items-center gap-1 font-semibold hover:text-accent-strong", dir !== "none" && "text-accent-strong")}
        title="คลิกเรียง · คลิกซ้ำ = มาก→น้อย · คลิกครั้งที่ 3 = กลับลำดับเดิม"
      >
        {children}
        <span aria-hidden="true">{dir === "ascending" ? "▲" : dir === "descending" ? "▼" : "↕"}</span>
      </button>
    </th>
  );
}

const TH = "sticky top-0 z-10 border-b border-border bg-surface-2 px-3 py-2.5 text-xs font-semibold";

export function RegistryList({ rows, today, role, sort, onSort }: Props) {
  return (
    <>
      {/* ตาราง (เดสก์ท็อป/แท็บเล็ต) */}
      <div className="max-h-[calc(100vh-260px)] overflow-auto rounded-card border border-border bg-surface shadow-[var(--shadow)] max-[767px]:hidden">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">ทะเบียนลูกค้า/สัญญา</caption>
          <thead>
            <tr>
              <th scope="col" className={cx(TH, "w-12 text-center")}>#</th>
              <th scope="col" className={cx(TH, "text-left")}>ลูกค้า</th>
              <SortTh col="end" sort={sort} onSort={onSort}>สัญญา · ระยะเวลา</SortTh>
              <th scope="col" className={cx(TH, "text-left")}>สาขา · เขต</th>
              <SortTh col="value" sort={sort} onSort={onSort} align="right">มูลค่า</SortTh>
              <th scope="col" className={cx(TH, "text-center")}>
                Tier <span className="ml-1 rounded bg-accent-soft px-1 text-xs font-normal text-accent-strong">อัตโนมัติ</span>
              </th>
              <th scope="col" className={cx(TH, "text-center")}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.contractId} className={cx("border-b border-border hover:bg-surface-2", r.status === "near_end" && "shadow-[inset_3px_0_0_var(--warn)]")}>
                <td className="num px-3 py-2.5 text-center align-middle text-fg-muted">{i + 1}</td>
                <td className="px-3 py-2.5 align-middle">
                  <CustomerName row={r} role={role} />
                </td>
                <td className="px-3 py-2.5 align-middle">
                  <span className="num">{r.contractNo}</span>
                  <TimeBar row={r} today={today} />
                </td>
                <td className="px-3 py-2.5 align-middle">
                  {r.branchName} <span className="text-fg-muted">· {r.zoneName}</span>
                </td>
                <td className="num px-3 py-2.5 text-right align-middle">
                  <b>{fmtMoney(r.valueTotal)}</b>
                  <small className="mt-0.5 block text-xs text-fg-muted">{fmtMoney(r.annualValue)}/ปี</small>
                </td>
                <td className="px-3 py-2.5 text-center align-middle">
                  <TierCell row={r} />
                </td>
                <td className="px-3 py-2.5 text-center align-middle">
                  <StatusChip status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* การ์ด (มือถือ) */}
      <ul className="m-0 hidden list-none flex-col gap-2 p-0 max-[767px]:flex">
        {rows.map((r) => (
          <li key={r.contractId} className={cx("rounded-xl border border-border bg-surface p-3", r.status === "near_end" && "shadow-[inset_3px_0_0_var(--warn)]")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 break-words">
                <CustomerName row={r} role={role} />
              </div>
              <StatusChip status={r.status} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[13px]">
              <span className="num text-fg-muted">{r.contractNo}</span>
              <TierCell row={r} />
            </div>
            <TimeBar row={r} today={today} />
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
              <span>
                {r.branchName} <span className="text-fg-muted">· {r.zoneName}</span>
              </span>
              <span className="num">
                <b>{fmtMoney(r.valueTotal)}</b> <span className="text-xs text-fg-muted">({fmtMoney(r.annualValue)}/ปี)</span>
              </span>
            </div>
            <div className="mt-1 text-xs text-fg-muted">
              {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
