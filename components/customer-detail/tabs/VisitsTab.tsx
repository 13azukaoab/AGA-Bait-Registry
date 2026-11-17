"use client";

/**
 * แท็บ "ประวัติทำบริการ" — เดือนที่ตกบริการ (ตัดสินได้) + แถบเดือนบริการ + ตารางการเข้าบริการทุกครั้ง
 *
 * Logic summary:
 *   * กล่อง "เดือนที่ตกบริการ" อยู่บนสุด: สถานะ 4 แบบ (รอตัดสิน · ชดเชยแล้ว · ไม่ชดเชย · โมฆะ) คำ/สีตรงกับหน้า /todo
 *       - สถานะคำนวณจาก lib/rules (computeMissed) · เพดานชดเชยอ่านจากฐานข้อมูล (ไม่ฮาร์ดโค้ด 12 เดือน)
 *       - "ไม่ชดเชย" = WaiveDialog + RPC resolve_missed_service (ใช้ร่วมกับ /todo) · "เปิดเรื่องกลับ" = reopen_missed_service
 *       - "บันทึกบริการชดเชย" = ลิงก์ไปหน้าลงข้อมูลบริการ (/service) เหมือน /todo — ไม่ทำแบบฟอร์มซ้ำในหน้านี้
 *       - ปุ่มตามสิทธิ์ (missedActions): admin ดูอย่างเดียว (2.57) · เลยเพดาน หัวหน้างานชดเชยไม่ได้ · สัญญายกเลิกไม่มีปุ่ม
 *   * แถบเดือน: ✓ ครบ · ตก (+สถานะตัดสิน) · … เดือนนี้ · – ยังไม่ถึง · ก่อนเริ่มนับ (ยังไม่ตั้งสถานี) — กรองได้ (ทุกเดือน/ครบ/ตก)
 *   * ตารางการเข้า: วันที่+ประเภท · ทีม+เวลา · เหยื่อ IG/IC·AG · ไม้ล่อ/S · พบปลวก · หมายเหตุ · กางแถวดูรายสถานีที่พบปลวก
 *   * ป้าย "ปิดเดือนแล้ว" = เดือนนั้นอยู่ใน month_closures (ไม่ล็อกข้อมูล — host/หัวหน้างานยังแก้ย้อนหลังได้ ลง audit)
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/service/ConfirmDialog";
import { Button, Pager, TierBadge } from "@/components/ui";
import { reopenMissedService, waiveMissedService } from "@/components/todo/rpc";
import { WaiveDialog } from "@/components/todo/WaiveDialog";
import type { PendingMissed } from "@/components/todo/logic";
import { monthLabel } from "@/lib/service/months";
import { createClient } from "@/lib/supabase/client";

import {
  fmtDate,
  missedActions,
  missedCounts,
  MISSED_STATUS_LABEL,
  monthShortTh,
  monthStates,
  monthTh,
  paginate,
  sortContracts,
  VISIT_TYPE_LABEL,
  type MissedItem,
  type MonthState,
} from "../logic";
import { CONTROL_CLASS, Empty, FilterChip, FilterField, Hint, Icon, TABLE_WRAP, TD_CLASS, TH_CLASS, Tag } from "../parts";
import type { CustomerDetailData, VisitType } from "../types";

export const PAGE_VI = 8;

export interface VisitUi {
  contractId: string;
  type: VisitType | "all";
  month: "all" | "ok" | "miss";
  page: number;
  open: Record<string, boolean>;
}

export const initialVisitUi: VisitUi = { contractId: "all", type: "all", month: "all", page: 1, open: {} };

const CELL: Record<MonthState, string> = {
  ok: "border-ok bg-ok-soft text-ok",
  miss: "border-danger bg-danger-soft text-danger",
  now: "border-warn bg-warn-soft text-warn",
  fut: "border-border bg-surface text-fg-faint",
  cx: "border-border bg-surface-3 text-fg-muted",
  pre: "border-border bg-surface text-fg-faint",
};
const CELL_SYM: Record<MonthState, string> = { ok: "✓", miss: "ตก", now: "…", fut: "–", cx: "ยก", pre: "–" };

const miniBtn = "inline-flex items-center justify-center rounded-md border px-2.5 py-1 text-xs max-md:min-h-11 md:min-h-8";

export function VisitsTab({
  data,
  ui,
  onUi,
  missed,
  onToast,
  onChanged,
}: {
  data: CustomerDetailData;
  ui: VisitUi;
  onUi: (next: VisitUi) => void;
  missed: readonly MissedItem[];
  onToast: (msg: string) => void;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [waiving, setWaiving] = useState<MissedItem | null>(null);
  const [reopening, setReopening] = useState<MissedItem | null>(null);
  const [reopenError, setReopenError] = useState<string | null>(null);

  const multi = data.contracts.length > 1;
  const contractById = new Map(data.contracts.map((c) => [c.id, c]));
  const stationById = new Map(data.stations.map((s) => [s.id, s]));
  const checksByVisit = useMemo(() => {
    const m = new Map<string, typeof data.checks>();
    for (const c of data.checks) m.set(c.visitId, [...(m.get(c.visitId) ?? []), c]);
    return m;
  }, [data]);

  const rows = data.visits.filter((v) => (ui.contractId === "all" || v.contractId === ui.contractId) && (ui.type === "all" || v.type === ui.type));
  const pg = paginate(rows, ui.page, PAGE_VI);
  const set = (patch: Partial<VisitUi>) => onUi({ ...ui, page: 1, ...patch });
  const scs = sortContracts(data.contracts).filter((k) => ui.contractId === "all" || k.id === ui.contractId);
  const mlist = missed.filter((m) => scs.some((k) => k.id === m.contractId));
  const mc = missedCounts(mlist);
  const closed = new Set(data.closedMonths);
  const canDecide = data.role === "host" || data.role === "recorder";

  const toPending = (m: MissedItem): PendingMissed => ({
    contractId: m.contractId,
    customerName: data.customer.name,
    branchName: data.customer.branchName,
    branchId: data.customer.branchId,
    zoneId: data.customer.zoneId,
    contractNo: m.contractNo,
    missedMonth: m.month,
    lastServiceMonth: m.month,
    deadlineMonth: m.deadlineMonth,
    pastDeadline: m.pastDeadline,
  });

  async function submitWaive(reason: string, file: File | null): Promise<string | null> {
    if (!waiving) return "ไม่พบรายการ";
    const r = await waiveMissedService(supabase, { contractId: waiving.contractId, missedMonth: waiving.month, reason, file });
    if (!r.ok) return r.error.message;
    onToast(`บันทึก “ไม่ชดเชย” ${monthLabel(waiving.month)} แล้ว (ลงประวัติการแก้ไข)`);
    setWaiving(null);
    onChanged();
    return null;
  }

  async function confirmReopen() {
    if (!reopening) return;
    const t = reopening;
    const r = await reopenMissedService(supabase, { contractId: t.contractId, missedMonth: t.month });
    setReopening(null);
    if (!r.ok) {
      setReopenError(r.error.message);
      return;
    }
    setReopenError(null);
    onToast(`เปิดเรื่อง ${monthLabel(t.month)} กลับเป็นรอตัดสินแล้ว (ลงประวัติการแก้ไข)`);
    onChanged();
  }

  const serviceHref = `/service?zone=${data.customer.zoneId}&branch=${data.customer.branchId}&month=${data.currentMonth}`;

  return (
    <div>
      <Hint>
        1 แถว = 1 ครั้งที่เข้าบริการ (เข้าหลายวันในเดือนเดียว = หลายแถว) · ตกบริการ = เดือนในช่วงสัญญาที่ไม่มีรอบประจำเดือน (นับตั้งแต่เดือนที่ตั้งสถานีในระบบ) · ป้าย “ปิดเดือนแล้ว” = ส่งสรุปเดือนนั้นแล้ว แต่ host/หัวหน้างานยังแก้ย้อนหลังได้ (มีบันทึกการแก้ทุกครั้ง · ตัวเลขที่ส่ง Dashboard คงเดิมจนกว่าจะสั่งคำนวณใหม่)
      </Hint>

      {reopenError ? (
        <p role="alert" className="mb-2 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          เปิดเรื่องกลับไม่สำเร็จ: {reopenError}
        </p>
      ) : null}

      {mlist.length > 0 ? (
        <section aria-label="เดือนที่ตกบริการ" className={`mb-3 rounded-xl border bg-surface ${mc.pending ? "border-danger" : "border-border"}`}>
          <h3 className="m-0 flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5 text-[14px] font-semibold">
            <Icon name="alert" className="text-danger" />
            เดือนที่ตกบริการ
            <span className="text-xs font-normal text-fg-muted">
              {mlist.length} เดือน · {mc.pending ? `รอตัดสิน ${mc.pending} เดือน` : "ตัดสินครบแล้ว"}
              {mc.voided ? ` · โมฆะ (ต่อสัญญาแล้ว) ${mc.voided} เดือน` : ""}
            </span>
            {canDecide ? null : <span className="ml-auto text-xs font-normal text-fg-muted">ดูอย่างเดียว</span>}
          </h3>
          <ul className="m-0 list-none p-0">
            {[...mlist].reverse().map((m) => {
              const k = contractById.get(m.contractId);
              const a = missedActions({ role: data.role, contractStatus: k?.status ?? "active", item: m });
              const lab = MISSED_STATUS_LABEL[m.status];
              const sub =
                m.status === "pending"
                  ? k?.status === "cancelled"
                    ? "สัญญายกเลิก — ไม่มีการชดเชย"
                    : `ยังไม่ได้ชดเชย · ไปชดเชยได้ถึง ${monthLabel(m.deadlineMonth)}${m.pastDeadline ? (data.role === "host" ? " · เลยกำหนดแล้ว — host บันทึกเป็นกรณีพิเศษได้" : " · เลยกำหนดแล้ว — หัวหน้างานบันทึกชดเชยไม่ได้ ให้ host บันทึก หรือกด “ไม่ชดเชย”") : ""}`
                  : m.status === "made_up"
                    ? `ไปบริการชดเชยแล้ว ${fmtDate(m.makeupDate)}${m.makeupTeams.length ? ` · ทีม ${m.makeupTeams.join(", ")}` : ""}`
                    : m.status === "void_renewed"
                      ? `ต่อสัญญาแล้ว${m.supersededByNo ? ` (${m.supersededByNo})` : ""} — นับกันที่สัญญาใหม่ ไม่ต้องชดเชย`
                      : `${m.reason ?? "—"}${m.decidedByName ? ` · โดย ${m.decidedByName}` : ""}`;
              return (
                <li key={`${m.contractId}-${m.month}`} className="grid gap-2 border-b border-border px-3.5 py-2.5 last:border-b-0 md:grid-cols-[110px_1fr_auto] md:items-center">
                  <div>
                    <b className="text-[13px]">{monthTh(m.month)}</b>
                    {scs.length > 1 ? <div className="font-mono text-xs text-fg-muted">{m.contractNo}</div> : null}
                  </div>
                  <div className="text-[13px]">
                    <Tag tone={lab.tone}>{lab.text}</Tag>{" "}
                    <span className="text-xs text-fg-muted" data-clarity-mask={m.status === "waived" ? "True" : undefined}>
                      {sub}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {m.status === "pending" && canDecide && k?.status !== "cancelled" ? (
                      <>
                        <Button size="sm" className="max-md:min-h-11" disabled={!a.waive} onClick={() => setWaiving(m)}>
                          ไม่ชดเชย
                        </Button>
                        <Link
                          href={serviceHref}
                          aria-disabled={!a.record}
                          tabIndex={a.record ? undefined : -1}
                          title={a.record ? "ไปหน้าลงข้อมูลบริการ เพื่อบันทึกการเข้าชดเชย" : "เลยเพดานชดเชย — หัวหน้างานบันทึกไม่ได้ ต้องให้ Host"}
                          className={`${miniBtn} no-underline ${a.record ? "border-accent bg-accent text-accent-fg hover:bg-accent-strong" : "pointer-events-none border-border bg-surface-3 text-fg-faint"}`}
                        >
                          บันทึกบริการชดเชย{a.recordOverCap ? " (เกินเพดาน)" : ""}
                        </Link>
                      </>
                    ) : null}
                    {a.reopen ? (
                      <Button size="sm" className="max-md:min-h-11" onClick={() => setReopening(m)}>
                        เปิดเรื่องกลับ
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div role="group" aria-label="กรองแถบเดือนบริการ" className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">แถบเดือน:</span>
        {(
          [
            ["all", "ทุกเดือน", "na"],
            ["ok", "บริการครบ", "ok"],
            ["miss", "ตกบริการ", "miss"],
          ] as const
        ).map(([key, text, tone]) => (
          <FilterChip key={key} tone={tone} on={ui.month === key} onClick={() => onUi({ ...ui, month: key })}>
            {text}
          </FilterChip>
        ))}
        <span className="text-xs text-fg-muted">· ตารางด้านล่างคือทุกครั้งที่เข้าบริการ (ไม่ขึ้นกับตัวกรองนี้)</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-fg-muted" aria-label="คำอธิบายแถบเดือนบริการ">
        {(["ok", "miss", "now", "fut", "pre"] as MonthState[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <i className={`inline-block size-3 rounded-sm border ${CELL[s]}`} aria-hidden="true" />
            {{ ok: "บริการครบ", miss: "ตกบริการ", now: "เดือนนี้ยังไม่เข้า", fut: "ยังไม่ถึง", pre: "ก่อนเริ่มนับ (ยังไม่ตั้งสถานี)", cx: "ยกเลิก" }[s]}
          </span>
        ))}
      </div>

      {scs.map((k) => {
        const ms = monthStates(k, data.visits, data.currentMonth);
        const miss = ms.filter((x) => x.state === "miss").length;
        const shown = ms.filter((x) => ui.month === "all" || (ui.month === "miss" && x.state === "miss") || (ui.month === "ok" && x.state === "ok"));
        const makeupOf = new Map<string, string>();
        for (const v of data.visits) if (v.contractId === k.id && v.makeupForMonth) makeupOf.set(v.date.slice(0, 7), monthTh(v.makeupForMonth.slice(0, 7)));
        return (
          <div key={k.id} className="mb-3 rounded-lg border border-border bg-surface-2 p-2.5">
            <h4 className="m-0 mb-2 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-mono">{k.no}</span>
              <TierBadge tier={k.tier} termMonths={k.termMonths} />
              <span className="text-xs font-normal text-fg-muted">
                {ms.length} เดือนบริการ · {miss ? <b className="text-danger">ตกบริการ {miss} เดือน</b> : "ไม่มีตกบริการ"}
              </span>
            </h4>
            {shown.length === 0 ? <p className="m-0 text-xs text-fg-muted">ไม่มีเดือนตามตัวกรองในสัญญานี้</p> : null}
            <div className="flex flex-wrap gap-1.5">
              {shown.map((x) => {
                const res = x.state === "miss" ? missed.find((m) => m.contractId === k.id && m.month === x.month) : undefined;
                const resText = res ? (res.status === "void_renewed" ? "โมฆะ" : MISSED_STATUS_LABEL[res.status].text) : null;
                const mk = makeupOf.get(x.month);
                return (
                  <div
                    key={x.month}
                    title={`${monthTh(x.month)}${resText ? ` · ตกบริการ · ${resText}` : ""}${mk ? ` · มีบริการชดเชยของ ${mk}` : ""}`}
                    className={`min-w-[62px] rounded-md border px-1.5 py-1 text-center text-xs ${CELL[x.state]}${mk ? " ring-1 ring-warn" : ""}`}
                  >
                    <b className="block">
                      {monthShortTh(x.month)} {x.month.slice(2, 4)}
                    </b>
                    {resText ?? CELL_SYM[x.state]}
                    {mk ? " +ชดเชย" : ""}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="mb-3 flex flex-wrap gap-3">
        <FilterField label="สัญญา" htmlFor="f-vi-contract">
          <select id="f-vi-contract" className={CONTROL_CLASS} value={ui.contractId} onChange={(e) => set({ contractId: e.target.value })}>
            <option value="all">ทุกสัญญา</option>
            {sortContracts(data.contracts).map((k) => (
              <option key={k.id} value={k.id}>
                {k.no}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="ประเภทการเข้า" htmlFor="f-vi-type">
          <select id="f-vi-type" className={CONTROL_CLASS} value={ui.type} onChange={(e) => set({ type: e.target.value as VisitUi["type"] })}>
            <option value="all">ทุกประเภท</option>
            {(Object.keys(VISIT_TYPE_LABEL) as VisitType[]).map((t) => (
              <option key={t} value={t}>
                {VISIT_TYPE_LABEL[t].text}
              </option>
            ))}
          </select>
        </FilterField>
      </div>

      {data.truncated ? (
        <p role="alert" className="mb-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ประวัติของลูกค้ารายนี้มากเกินที่หน้านี้อ่านได้ในครั้งเดียว — รายการอาจไม่ครบ แจ้งผู้ดูแลระบบ
        </p>
      ) : null}

      {rows.length === 0 ? (
        <Empty>ไม่พบการเข้าบริการตามเงื่อนไข</Empty>
      ) : (
        <>
          <div className={TABLE_WRAP}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={TH_CLASS}>วันที่ / ประเภท</th>
                  <th scope="col" className={TH_CLASS}>ทีม / เวลาเข้า–ออก</th>
                  <th scope="col" className={TH_CLASS}>เหยื่อ (ก.) IG/IC · AG</th>
                  <th scope="col" className={TH_CLASS}>ไม้ล่อ / S</th>
                  <th scope="col" className={TH_CLASS}>พบปลวก</th>
                  <th scope="col" className={TH_CLASS}>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {pg.slice.map((v) => {
                  const open = !!ui.open[v.id];
                  const lab = VISIT_TYPE_LABEL[v.type];
                  const isClosed = closed.has(v.date.slice(0, 7));
                  const cks = checksByVisit.get(v.id) ?? [];
                  const k = contractById.get(v.contractId);
                  return (
                    <VisitRows
                      key={v.id}
                      open={open}
                      main={
                        <>
                          <td className={TD_CLASS}>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-expanded={open}
                                aria-label={`รายละเอียดการเข้าวันที่ ${fmtDate(v.date)}`}
                                onClick={() => onUi({ ...ui, open: { ...ui.open, [v.id]: !open } })}
                                className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 max-md:size-11"
                              >
                                {open ? "▾" : "▸"}
                              </button>
                              <b>{fmtDate(v.date)}</b>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              <Tag tone={lab.tone}>{lab.text}</Tag>
                              {v.makeupForMonth ? <Tag tone="pend">ชดเชย {monthTh(v.makeupForMonth.slice(0, 7))}</Tag> : null}
                              {isClosed ? (
                                <Tag tone="na" title="เดือนนี้ปิดแล้ว — host/หัวหน้างานยังแก้ผลย้อนหลังได้ (ลงประวัติ) · ค่าที่ส่ง Dashboard คงเดิมจนกว่าสั่งคำนวณใหม่">
                                  ปิดเดือนแล้ว
                                </Tag>
                              ) : null}
                              {multi && k ? <span className="font-mono text-xs text-fg-muted">{k.no}</span> : null}
                            </div>
                          </td>
                          <td className={TD_CLASS}>
                            ทีม {v.teamCodes.join(", ") || "—"}
                            <div className="text-xs tabular-nums text-fg-muted">
                              {v.startTime ?? "—"}–{v.endTime ?? "—"}
                              {v.durationMin !== null ? ` · ${v.durationMin} นาที` : ""}
                            </div>
                          </td>
                          <td className={`${TD_CLASS} tabular-nums`}>
                            <div>
                              <span className="text-xs text-fg-muted">IG/IC</span> <b>{v.baitIgIcG || "—"}</b>
                            </div>
                            <div>
                              <span className="text-xs text-fg-muted">AG</span> <b>{v.baitAgG || "—"}</b>
                            </div>
                          </td>
                          <td className={`${TD_CLASS} tabular-nums`}>
                            <div>
                              <span className="text-xs text-fg-muted">ไม้ล่อ</span> <b>{v.timberPcs || "—"}</b>
                            </div>
                            <div>{v.firstInstall ? <Tag tone="info">S ติดกล่อง</Tag> : <span className="text-xs text-fg-muted">S —</span>}</div>
                          </td>
                          <td className={`${TD_CLASS} tabular-nums`}>{cks.length ? `${cks.length} จุด` : <span className="text-xs text-fg-muted">ไม่พบ</span>}</td>
                          <td className={TD_CLASS} data-clarity-mask="True">
                            <div className="max-w-[240px] truncate" title={v.note ?? undefined}>
                              {v.note || <span className="text-fg-muted">—</span>}
                            </div>
                          </td>
                        </>
                      }
                      detail={
                        <div data-clarity-mask="True">
                          <p className="m-0 mb-2 text-xs text-fg-muted">
                            บันทึกโดย {v.createdByName ?? "—"} · {v.internalInspection ? "ตรวจภายใน" : "ไม่ตรวจภายใน"} · {v.signedByProxy ? "เซ็นแทน" : "ลูกค้าเซ็นเอง"} · เคมีผง {v.powderPoints ?? 0} จุด
                          </p>
                          {v.note ? (
                            <p className="m-0 mb-2 text-[13px]">
                              <span className="text-xs text-fg-muted">หมายเหตุ:</span> {v.note}
                            </p>
                          ) : null}
                          {cks.length === 0 ? (
                            <span className="text-xs text-fg-muted">{v.type === "routine" ? "ทุกสถานีปกติ — ไม่มีจุดที่พบปลวก (exception entry)" : "ไม่มีจุดที่พบปลวกในครั้งนี้"}</span>
                          ) : (
                            <table className="w-full border-collapse">
                              <thead>
                                <tr>
                                  <th className={TH_CLASS}>สถานี</th>
                                  <th className={TH_CLASS}>จุดที่ติด (ป้ายกำกับ)</th>
                                  <th className={TH_CLASS}>ชนิด</th>
                                  <th className={TH_CLASS}>F / ครั้งที่</th>
                                  <th className={TH_CLASS}>สัดส่วนปลวก (เฉพาะ AG)</th>
                                  <th className={`${TH_CLASS} text-right`}>เหยื่อเติม (ก.)</th>
                                  <th className={TH_CLASS}>หมายเหตุ</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cks.map((x) => {
                                  const s = stationById.get(x.stationId);
                                  return (
                                    <tr key={x.stationId}>
                                      <td className={`${TD_CLASS} font-mono`}>{s?.code ?? "—"}</td>
                                      <td className={TD_CLASS}>{s?.pointLabel || <span className="text-fg-muted">—</span>}</td>
                                      <td className={TD_CLASS}>{s?.type ?? "—"}</td>
                                      <td className={TD_CLASS}>{s?.type === "AG" && x.followUpNo ? <b>F{x.followUpNo}</b> : <span className="text-xs text-fg-muted">—</span>}</td>
                                      <td className={TD_CLASS}>{s?.type !== "AG" ? <span className="text-fg-muted">—</span> : x.caste === "ปลวกตาย" ? <Tag tone="ok">ปลวกตาย</Tag> : x.caste}</td>
                                      <td className={`${TD_CLASS} text-right tabular-nums`}>{x.baitAddedG ?? 0}</td>
                                      <td className={TD_CLASS}>{x.note || <span className="text-fg-muted">—</span>}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} pageSize={PAGE_VI} total={rows.length} onPageChange={(p) => onUi({ ...ui, page: p })} className="mt-2" />
        </>
      )}

      {waiving ? <WaiveDialog item={toPending(waiving)} monthText={monthLabel(waiving.month)} onClose={() => setWaiving(null)} onSubmit={submitWaive} /> : null}
      {reopening ? (
        <ConfirmDialog
          title={`เปิดเรื่องกลับ — ตกบริการ ${monthLabel(reopening.month)}`}
          message={`สัญญา ${reopening.contractNo} · เรื่องนี้ปิดไว้เป็น “ไม่ชดเชย” — เปิดกลับแล้วจะเป็นรอตัดสิน และขึ้นแถว “รอชดเชย” ในหน้าลงข้อมูลบริการอีกครั้ง · เหตุผลเดิมเก็บไว้ในประวัติการแก้ไข`}
          confirmLabel="ยืนยัน เปิดเรื่องกลับ"
          cancelLabel="ยกเลิก"
          danger
          onConfirm={confirmReopen}
          onCancel={() => setReopening(null)}
        />
      ) : null}
    </div>
  );
}

function VisitRows({ main, detail, open }: { main: React.ReactNode; detail: React.ReactNode; open: boolean }) {
  return (
    <>
      <tr>{main}</tr>
      {open ? (
        <tr className="bg-surface-2">
          <td colSpan={6} className="px-2.5 py-2">
            {detail}
          </td>
        </tr>
      ) : null}
    </>
  );
}
