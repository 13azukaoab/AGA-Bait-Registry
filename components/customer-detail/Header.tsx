"use client";

/**
 * Header — ส่วนบนของหน้ารายละเอียดลูกค้า: ชื่อ + ปุ่มลัด · การ์ดตัวเลข 5 ใบ · แถบเตือน (mockup FINAL)
 *
 * Logic summary:
 *   * ปุ่มตามสิทธิ์ (customerPermissions): ลงข้อมูลบริการ/กล่อง AG = host+หัวหน้างาน · แก้ข้อมูลลูกค้า = host+admin · ประวัติแก้ไข = host
 *   * การ์ดตัวเลข: สัญญาปัจจุบัน → เหลือในสัญญา/รอเก็บ → สถานะกล่อง AG → เดือนตกบริการ → เข้าบริการล่าสุด
 *   * แถบเตือนเหลือเฉพาะเรื่องที่ไม่มีการ์ด: สัญญาใกล้หมด · วันสิ้นสุดผิดกฎ · รอเก็บสถานี · ลูกค้าทีมอื่น
 *   * ชื่อลูกค้าอยู่ใน data-clarity-mask (M36) · ไม่ใส่ชื่อลูกค้าใน title/URL
 */
import Link from "next/link";

import { cx } from "@/components/ui";
import { TierBadge } from "@/components/ui";

import {
  agCardState,
  agNames,
  buildAlerts,
  collectProgress,
  contractEnd,
  customerPermissions,
  fmtDate,
  fmtNum,
  inArea,
  latestVisit,
  missedCounts,
  primaryContract,
  stationCounts,
  termText,
  CONTRACT_STATUS_LABEL,
  type MissedItem,
} from "./logic";
import { Icon, Tag } from "./parts";
import { serviceMonthsForTerm } from "@/lib/rules";
import type { CustomerDetailData } from "./types";

const LINK_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md border px-3.5 py-2 text-[13px] no-underline max-md:min-h-11 md:min-h-9";
const LINK_PRIMARY = `${LINK_BASE} border-accent bg-accent text-accent-fg hover:border-accent-strong hover:bg-accent-strong`;
const LINK_SECONDARY = `${LINK_BASE} border-border-strong bg-surface text-fg hover:bg-surface-2`;

export type TabKey = "dash" | "contracts" | "stations" | "visits" | "files" | "timeline";

export interface GotoOpts {
  contractId?: string;
  status?: string;
  type?: string;
}

export function Header({
  data,
  onGoto,
}: {
  data: CustomerDetailData;
  onGoto: (tab: TabKey, opts?: GotoOpts) => void;
}) {
  const perm = customerPermissions(data.role);
  const c = data.customer;
  const hasActive = data.contracts.some((k) => k.status === "active");
  const hasPending = data.contracts.some((k) => k.status === "expired_pending_collection");
  const serviceHref = `/service?zone=${c.zoneId}&branch=${c.branchId}&month=${data.currentMonth}`;
  const baitHref = `/bait?zone=${c.zoneId}&branch=${c.branchId}&month=${data.currentMonth}`;
  const primary = primaryContract(data.contracts);
  const editHref = `/customers/new?month=${(primary?.startDate ?? data.today).slice(0, 7)}`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="m-0 text-xl font-bold" data-clarity-mask="True">
        {c.name}
      </h1>
      {hasActive ? <Tag tone="ok">มีสัญญาใช้งาน</Tag> : hasPending ? <Tag tone="pend">หมดสัญญา · รอเก็บสถานี</Tag> : <Tag tone="na">ไม่มีสัญญาใช้งาน</Tag>}
      <div className="ml-auto flex flex-wrap gap-2">
        {perm.entry ? (
          <>
            <Link href={serviceHref} className={LINK_PRIMARY} title="ไปหน้าลงข้อมูลทำบริการประจำเดือน">
              <Icon name="pencil" />
              ลงข้อมูลทำบริการประจำเดือน
            </Link>
            <Link href={baitHref} className={LINK_SECONDARY} title="ไปหน้ากล่อง AG นอกรอบประจำเดือน">
              <Icon name="box" />
              กล่อง AG นอกรอบประจำเดือน
            </Link>
          </>
        ) : null}
        {perm.edit ? (
          <Link href={editHref} className={perm.entry ? LINK_SECONDARY : LINK_PRIMARY} title="ไปหน้าเปิดงานเพื่อแก้ข้อมูลลูกค้า (แก้สัญญา/สถานีดูที่แท็บสัญญา)">
            <Icon name="pencil" />
            แก้ข้อมูลลูกค้า
          </Link>
        ) : null}
        {perm.timeline ? (
          <button type="button" onClick={() => onGoto("timeline")} className={LINK_SECONDARY} title="ดูประวัติการแก้ไขของลูกค้ารายนี้ (เฉพาะ host)">
            <Icon name="history" />
            ประวัติการแก้ไข
          </button>
        ) : null}
        {!perm.entry && !perm.edit ? <span className="self-center text-xs text-fg-muted">ดูอย่างเดียว</span> : null}
      </div>
    </div>
  );
}

const KP_BASE = "flex min-h-[88px] flex-col gap-0.5 rounded-xl border bg-surface px-3.5 py-3 text-left";
const KP_TONE = {
  plain: "border-border",
  good: "border-ok",
  warn: "border-warn bg-warn-soft",
  info: "border-accent",
  bad: "border-danger bg-danger-soft",
} as const;

function Kp({
  tone,
  label,
  children,
  sub,
  go,
  onClick,
  title,
}: {
  tone: keyof typeof KP_TONE;
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  go?: string;
  onClick?: () => void;
  title?: string;
}) {
  const body = (
    <>
      <span className="text-xs text-fg-muted">{label}</span>
      <span className="text-[22px] font-bold leading-tight">{children}</span>
      {sub ? <span className="text-xs text-fg-muted">{sub}</span> : null}
      {go ? <span className="mt-auto pt-1 text-xs font-semibold text-accent-strong">{go} →</span> : null}
    </>
  );
  if (onClick)
    return (
      <button type="button" onClick={onClick} title={title} className={cx(KP_BASE, KP_TONE[tone], "cursor-pointer hover:shadow-[var(--shadow)] max-md:min-h-11")}>
        {body}
      </button>
    );
  return <div className={cx(KP_BASE, KP_TONE[tone])}>{body}</div>;
}

export function Kpis({
  data,
  missed,
  onGoto,
}: {
  data: CustomerDetailData;
  missed: readonly MissedItem[];
  onGoto: (tab: TabKey, opts?: GotoOpts) => void;
}) {
  const k = primaryContract(data.contracts);
  if (!k) return null;
  const area = stationCounts(data.stations.filter(inArea));
  const last = latestVisit(data.visits);
  const mc = missedCounts(missed);
  const ag = agCardState(data.stations);
  const leftMonths = serviceMonthsForTerm(k.startDate, k.termMonths).filter((m) => m > data.currentMonth).length;

  return (
    <div role="group" aria-label="ตัวเลขสำคัญของลูกค้ารายนี้" className="mb-3 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
      <Kp
        tone="plain"
        label={k.status === "active" ? "สัญญาปัจจุบัน" : "สัญญาล่าสุด"}
        sub={`${termText(k.termMonths)} · ${k.saleType === "renew" ? "Renew" : "New"} · ${area.total} สถานีในพื้นที่`}
      >
        <span className="inline-flex items-center gap-1.5">
          <TierBadge tier={k.tier} termMonths={k.termMonths} /> {fmtNum(k.valueTotal)} <span className="text-xs font-normal text-fg-muted">บาท</span>
        </span>
      </Kp>

      {k.status === "active" ? (
        <Kp tone="plain" label="เหลือในสัญญา" sub={`หมด ${fmtDate(contractEnd(k))}`}>
          {leftMonths} <span className="text-xs font-normal text-fg-muted">เดือน</span>
        </Kp>
      ) : k.status === "expired_pending_collection" ? (
        (() => {
          const p = collectProgress(data.stations, k.id);
          return (
            <Kp tone="bad" label="หมดสัญญา · IG รอเก็บ" sub={`เก็บแล้ว ${p.done}${p.waived ? ` · ไม่เก็บ ${p.waived}` : ""} จาก ${p.total} · IC มอบให้ลูกค้า`}>
              {p.pending} <span className="text-xs font-normal text-fg-muted">จุด</span>
            </Kp>
          );
        })()
      ) : (
        <Kp tone="plain" label="สถานะสัญญา" sub={k.closedAt ? `ปิดเมื่อ ${fmtDate(k.closedAt)}` : undefined}>
          <span className="text-base">{CONTRACT_STATUS_LABEL[k.status].text}</span>
        </Kp>
      )}

      {ag.kind === "pending" ? (
        <Kp
          tone="warn"
          label="สถานะกล่อง AG"
          sub={`${agNames(ag.list)} · พบปลวกตาย ยังไม่ได้ถอด`}
          go="ดูรายการ"
          onClick={() => onGoto("stations", { type: "AG", status: "pending_removal" })}
          title="ดูรายการกล่อง AG ที่รอถอด"
        >
          <span className="inline-flex items-center gap-1.5">
            <Icon name="alertc" className="size-5" />
            รอถอด {ag.list.length} จุด
          </span>
        </Kp>
      ) : ag.kind === "tracking" ? (
        <Kp
          tone="info"
          label="สถานะกล่อง AG"
          sub={`${agNames(ag.list)} · ยังไม่มีจุดรอถอด`}
          go="ดูรายการ"
          onClick={() => onGoto("stations", { type: "AG", status: "active" })}
          title="ดูกล่อง AG ที่กำลังติดตามผล"
        >
          {ag.list.length} <span className="text-xs font-normal text-fg-muted">จุดติดตามผล</span>
        </Kp>
      ) : (
        <Kp tone="good" label="สถานะกล่อง AG" sub="ไม่มี AG ที่ต้องติดตาม">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="check" className="size-5" />
            ไม่มีปัญหา
          </span>
        </Kp>
      )}

      {mc.total > 0 ? (
        <Kp
          tone={mc.pending ? "bad" : "info"}
          label="เดือนตกบริการ"
          sub={mc.pending ? `รอตัดสิน ${mc.pending}` : "ตัดสินครบแล้ว"}
          go="จัดการเดือนที่ตก"
          onClick={() => onGoto("visits")}
          title="จัดการเดือนที่ตกบริการ"
        >
          {mc.total}
        </Kp>
      ) : (
        <Kp tone="good" label="เดือนตกบริการ" sub="บริการครบทุกเดือน">
          0
        </Kp>
      )}

      <Kp
        tone="plain"
        label="เข้าบริการล่าสุด"
        go={`${last && last.teamCodes.length ? `ทีม ${last.teamCodes.join(", ")} · ` : ""}ดูทั้งหมด ${data.visits.length} ครั้ง`}
        onClick={() => onGoto("visits")}
        title="เปิดแท็บประวัติทำบริการทั้งหมด"
      >
        <span className="text-lg">{last ? fmtDate(last.date) : "—"}</span>
      </Kp>
    </div>
  );
}

export function AlertsBar({
  data,
  onGoto,
}: {
  data: CustomerDetailData;
  onGoto: (tab: TabKey, opts?: GotoOpts) => void;
}) {
  const perm = customerPermissions(data.role);
  const teams = [...new Set(data.contracts.flatMap((k) => k.teamCodes))];
  const alerts = buildAlerts({
    contracts: data.contracts,
    stations: data.stations,
    today: data.today,
    role: data.role,
    customerTeamCodes: teams,
    myTeamCode: data.myTeamCode,
    canGoCollect: perm.collect,
  });
  if (!alerts.length) return null;
  return (
    <div role="region" aria-label="งานที่ต้องทำ" className="mb-3 grid gap-2">
      {alerts.map((a, i) => (
        <div
          key={i}
          className={cx(
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border-l-4 px-3 py-2 text-[13px]",
            a.tone === "warn" ? "border-l-warn bg-warn-soft" : "border-l-accent bg-accent-soft",
          )}
        >
          <Icon name={a.tone === "warn" ? "alertc" : "info"} className={a.tone === "warn" ? "text-warn" : "text-accent-strong"} />
          <b>{a.title}</b>
          <span className="text-fg-muted">{a.body}</span>
          {a.action?.kind === "contract" ? (
            <button type="button" className="min-h-11 text-xs font-semibold text-accent-strong underline md:min-h-8" onClick={() => onGoto("contracts", { contractId: contractIdByNo(data, (a.action as { contractNo: string }).contractNo) })}>
              {a.action.label}
            </button>
          ) : null}
          {a.action?.kind === "collect" ? (
            <Link href="/collection" className="inline-flex min-h-11 items-center text-xs font-semibold text-accent-strong underline md:min-h-8">
              {a.action.label}
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function contractIdByNo(data: CustomerDetailData, no: string): string | undefined {
  return data.contracts.find((c) => c.no === no)?.id;
}
