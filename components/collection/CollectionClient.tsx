"use client";

/**
 * หน้า "ลูกค้ารอเก็บสถานี" (/collection) — mockup FINAL `docs/mockup/aga-bait-registry-prototype.html#collect` (15 พ.ย. 2026)
 *
 * Logic summary:
 *   * แสดงสัญญาที่หมดแล้วและมี IG ต้องจัดการ · เก็บคืนเฉพาะ IG (IC มอบลูกค้า · กล่อง AG ไม่ต้องเก็บ — DECISIONS 2.42)
 *   * ตัวกรอง: เดือนที่หมดสัญญา (รวมกำหนดช่วงเอง) · สถานะ · ค้นหาชื่อลูกค้า/เลขที่สัญญา — กรองฝั่ง client
 *   * การ์ดสรุป 2 ใบ "ค้างทั้งหมด + ทำเดือนนี้" นับจากทุกแถว ไม่ขึ้นกับตัวกรอง
 *   * ปุ่ม "เก็บแล้ว" / "ไม่เก็บ": host ทุกแถว · recorder เฉพาะสาขาในขอบเขต · admin ดูอย่างเดียว (ไม่มีปุ่ม) — DB ตรวจซ้ำ
 *   * บันทึกแล้วอัปเดตแถวทันทีจากผล RPC แล้ว refresh ข้อมูลจริง · IG ที่ยังไม่จัดการคงอยู่ในรายการจนเก็บ/กด "ไม่เก็บ"
 *   * ไม่มีปุ่ม "ปิดสัญญา" (รอ HQ ตัดสิน: ยังไม่มี RPC ปิดสัญญา — ดูรายงานงาน)
 *   * PDPA: ชื่อลูกค้าลิงก์ด้วย customerLink (ไม่มีชื่อ/เบอร์ใน URL) · log เฉพาะ code
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { Alert, Button, Chip, Toast, cx } from "@/components/ui";
import type { UserRole } from "@/lib/db/types";
import { customerDetailHref, customerLinkContexts } from "@/lib/links/customerLink";
import { monthLabel } from "@/lib/service/months";
import { createClient } from "@/lib/supabase/client";

import { CollectDialog, ReasonDialog, type DialogKind, type DialogSubmit } from "./CollectDialog";
import { applyActionResult, canCloseContract, canRecordRow, closeBlockReason, computeStats, endMonths, filterRows, igBase, isClosable } from "./collectionRules";
import { CLOSE_CONTRACT_AVAILABLE, CLOSE_NOTE_MAX, closeContract, closeSuccessMessage, collectIgStations, skipIgCollection } from "./collectionRpc";
import type { CollectionRow, HeldContract, MonthFilter, StatusFilter, TeamOption } from "./collectionTypes";

const CONTROL =
  "min-h-10 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-[767px]:min-h-11 max-[767px]:text-base";
const LABEL = "text-[12px] font-semibold text-fg-muted";

const fmtDate = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function Bar({ got, skip, rest, total, label, small }: { got: number; skip: number; rest: number; total: number; label: string; small?: boolean }) {
  const t = total || 1;
  return (
    <div role="img" aria-label={label} className={cx("mt-1.5 flex overflow-hidden rounded-full bg-surface-3", small ? "h-1.5" : "h-2.5")}>
      <i className="block h-full bg-ok" style={{ width: `${(got * 100) / t}%` }} />
      <i className="block h-full bg-fg-faint" style={{ width: `${(skip * 100) / t}%` }} />
      <i className="block h-full bg-danger" style={{ width: `${(rest * 100) / t}%` }} />
    </div>
  );
}

function Legend({ a, b, c }: { a: string; b: string; c: string }) {
  const dot = (cls: string) => <i aria-hidden="true" className={cx("mr-1.5 inline-block size-2.5 rounded-sm align-baseline", cls)} />;
  return (
    <div className="mt-2 flex flex-col gap-0.5 text-[12px] text-fg-muted">
      <span>
        {dot("bg-ok")}
        {a}
      </span>
      <span>
        {dot("bg-fg-faint")}
        {b}
      </span>
      <span>
        {dot("bg-danger")}
        {c}
      </span>
    </div>
  );
}

export function CollectionClient({
  rows: initialRows,
  teams,
  held,
  truncated,
  role,
  divisionScope,
  currentMonth,
  today,
}: {
  rows: CollectionRow[];
  teams: TeamOption[];
  held: HeldContract[];
  truncated: boolean;
  role: UserRole;
  divisionScope: string[];
  currentMonth: string;
  today: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  useEffect(() => setRows(initialRows), [initialRows]);

  const [monthSel, setMonthSel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [query, setQuery] = useState("");

  const [dialog, setDialog] = useState<{ kind: DialogKind; id: string } | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const teamCode = useCallback((id: string | null) => (id ? (teams.find((t) => t.id === id)?.code ?? null) : null), [teams]);

  const monthFilter: MonthFilter = monthSel === "" ? { kind: "all" } : monthSel === "custom" ? { kind: "range", from, to } : { kind: "month", month: monthSel };
  const shown = useMemo(
    () => filterRows(rows, { month: monthFilter, status, query, currentMonth }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, monthSel, from, to, status, query, currentMonth],
  );
  const stats = useMemo(() => computeStats(rows, currentMonth), [rows, currentMonth]);
  const months = useMemo(() => endMonths(rows), [rows]);

  const target = dialog ? (rows.find((r) => r.contractId === dialog.id) ?? null) : null;
  const reasonRow = reasonFor ? (rows.find((r) => r.contractId === reasonFor) ?? null) : null;

  async function submit(s: DialogSubmit) {
    if (!dialog || !target) return;
    setBusy(true);
    setDialogError(null);
    const supabase = createClient();
    const res = dialog.kind === "collected" ? await collectIgStations(supabase, s.input) : await skipIgCollection(supabase, s.input, s.reason ?? "");
    setBusy(false);
    if (!res.ok) {
      setDialogError(res.error.message);
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.contractId === target.contractId
          ? applyActionResult(r, { kind: dialog.kind, count: res.result.count, remaining: res.result.remaining, date: s.input.date, teamId: s.input.teamId, reason: s.reason }, currentMonth)
          : r,
      ),
    );
    setToast(
      dialog.kind === "collected"
        ? `บันทึกเก็บ IG คืน ${res.result.count} สถานีแล้ว (${target.customerName})`
        : `บันทึก ไม่เก็บ IG ${res.result.count} สถานี แล้ว — นับเป็น “IG ที่ทิ้งไว้สะสม”`,
    );
    setDialog(null);
    router.refresh();
  }

  const closeRow = closeId ? (rows.find((r) => r.contractId === closeId) ?? null) : null;
  async function doClose(note: string) {
    if (!closeRow) return;
    setBusy(true);
    setCloseError(null);
    const res = await closeContract(createClient(), closeRow.contractId, note);
    setBusy(false);
    if (!res.ok) {
      setCloseError(res.error.message);
      return;
    }
    setToast(`${closeSuccessMessage(res.igRemaining)} (${closeRow.contractNo})`);
    setCloseId(null);
    router.refresh();
  }

  const canAny = role === "host" || role === "recorder";

  return (
    <div className="mx-auto max-w-[1200px] p-4 max-[767px]:p-3">
      <h1 className="m-0 text-[22px] font-bold max-[767px]:text-xl">ลูกค้ารอเก็บสถานี</h1>
      <p className="mb-3.5 mt-0.5 text-[13px] text-fg-muted">
        สัญญาหมดแล้ว — เก็บสถานี <b>IG</b> คืนบริษัท · IG ที่ยังไม่จัดการจะอยู่ในรายการนี้จนกด “เก็บแล้ว” หรือ “ไม่เก็บ” (ปิดสัญญาได้แม้ IG ยังเก็บไม่ครบ)
      </p>

      {role === "admin" ? (
        <Alert variant="info" className="mb-3">
          บัญชี Admin ดูข้อมูลได้อย่างเดียว — การบันทึกเก็บ/ไม่เก็บทำได้เฉพาะ Host และหัวหน้างาน (Recorder)
        </Alert>
      ) : null}
      {truncated ? (
        <Alert variant="warn" title="แสดงไม่ครบทุกสัญญา" className="mb-3">
          มีสัญญาที่หมดแล้วมากกว่าที่หน้านี้โหลดได้ — แสดงเฉพาะสัญญาที่หมดล่าสุด · ค้นหาสัญญาเก่าที่หน้าทะเบียนลูกค้า
        </Alert>
      ) : null}

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-[10px] border border-border bg-surface p-3 shadow-[var(--shadow)]">
        <div className="flex flex-col gap-1">
          <label htmlFor="cl-month" className={LABEL}>
            หมดสัญญาเดือน
          </label>
          <select id="cl-month" value={monthSel} onChange={(e) => setMonthSel(e.target.value)} className={CONTROL}>
            <option value="">ทุกเดือน</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
            <option value="custom">กำหนดช่วงเอง…</option>
          </select>
        </div>
        {monthSel === "custom" ? (
          <div className="flex flex-col gap-1">
            <span className={LABEL}>ช่วงเดือนที่หมดสัญญา</span>
            <div className="flex items-center gap-2 text-[13px]">
              <input type="month" aria-label="ตั้งแต่เดือน" value={from} onChange={(e) => setFrom(e.target.value)} className={CONTROL} />
              <span>ถึง</span>
              <input type="month" aria-label="ถึงเดือน" value={to} onChange={(e) => setTo(e.target.value)} className={CONTROL} />
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="cl-status" className={LABEL}>
            สถานะ
          </label>
          <select id="cl-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={CONTROL}>
            <option value="open">ค้าง + ปิดเรื่องเดือนนี้</option>
            <option value="wait">ยังเก็บไม่ครบ</option>
            <option value="done">เก็บครบแล้ว</option>
            <option value="skip">ลูกค้าไม่ให้เก็บ</option>
            <option value="all">ทั้งหมด</option>
          </select>
        </div>
        <div className="flex min-w-[180px] flex-1 flex-col gap-1">
          <label htmlFor="cl-q" className={LABEL}>
            ค้นหาลูกค้า
          </label>
          <input id="cl-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ชื่อลูกค้า / เลขที่สัญญา" autoComplete="off" className={cx(CONTROL, "w-full")} />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 max-[767px]:grid-cols-1" aria-label="สรุปการเก็บสถานี">
        <div className="rounded-[10px] border border-border bg-surface px-4 py-3.5 shadow-[var(--shadow)]">
          <div className="text-[12px] text-fg-muted">ลูกค้า (ราย) · {monthLabel(currentMonth)}</div>
          <div className="text-[26px] font-bold leading-tight tabular-nums">
            {stats.customersDone} <small className="text-[13px] font-medium text-fg-muted">/ {stats.customersDone + stats.customersSkip + stats.customersWait} ราย เก็บครบเดือนนี้</small>
          </div>
          <Bar
            got={stats.customersDone}
            skip={stats.customersSkip}
            rest={stats.customersWait}
            total={stats.customersDone + stats.customersSkip + stats.customersWait}
            label={`เก็บครบ ${stats.customersDone} · ลูกค้าไม่ให้เก็บ ${stats.customersSkip} · ยังต้องเข้าเก็บ ${stats.customersWait}`}
          />
          <Legend
            a={`เก็บครบเดือนนี้ ${stats.customersDone} ราย`}
            b={`ลูกค้าไม่ให้เก็บ (เดือนนี้) ${stats.customersSkip} ราย`}
            c={`ยังต้องเข้าเก็บ (ค้างทั้งหมด) ${stats.customersWait} ราย`}
          />
        </div>
        <div className="rounded-[10px] border border-border bg-surface px-4 py-3.5 shadow-[var(--shadow)]">
          <div className="text-[12px] text-fg-muted">สถานี IG · {monthLabel(currentMonth)}</div>
          <div className="text-[26px] font-bold leading-tight tabular-nums">
            {stats.stationsCollectedMonth}{" "}
            <small className="text-[13px] font-medium text-fg-muted">
              / {stats.stationsCollectedMonth + stats.stationsSkippedMonth + stats.stationsRemaining} สถานี เก็บคืนเดือนนี้
            </small>
          </div>
          <Bar
            got={stats.stationsCollectedMonth}
            skip={stats.stationsSkippedMonth}
            rest={stats.stationsRemaining}
            total={stats.stationsCollectedMonth + stats.stationsSkippedMonth + stats.stationsRemaining}
            label={`เก็บแล้ว ${stats.stationsCollectedMonth} · ไม่เก็บ ${stats.stationsSkippedMonth} · ยังไม่ได้เก็บ ${stats.stationsRemaining}`}
          />
          <Legend
            a={`เก็บแล้วเดือนนี้ ${stats.stationsCollectedMonth} สถานี`}
            b={`ไม่เก็บ (ลูกค้าไม่ให้) ${stats.stationsSkippedMonth} สถานี`}
            c={`ยังไม่ได้เก็บ (ค้างทั้งหมด) ${stats.stationsRemaining} สถานี`}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-border bg-surface shadow-[var(--shadow)] max-[767px]:overflow-visible max-[767px]:border-0 max-[767px]:bg-transparent max-[767px]:shadow-none">
        <table className="w-full border-collapse text-[13px] max-[767px]:block">
          <thead className="max-[767px]:hidden">
            <tr className="bg-surface-2 text-left text-[12px] text-fg-muted">
              <th className="w-[26%] px-3 py-2 font-semibold">ลูกค้า · สาขา</th>
              <th className="w-[24%] px-3 py-2 font-semibold">สัญญา</th>
              <th className="w-[20%] px-3 py-2 font-semibold">IG (เก็บแล้ว / ทั้งหมด)</th>
              <th className="w-[14%] px-3 py-2 font-semibold">วันที่เก็บ</th>
              <th className="px-3 py-2">
                <span className="sr-only">การทำงาน</span>
              </th>
            </tr>
          </thead>
          <tbody className="max-[767px]:block">
            {shown.length === 0 ? (
              <tr className="max-[767px]:block">
                <td colSpan={5} className="px-3 py-8 text-center text-fg-muted max-[767px]:block">
                  ไม่มีลูกค้าตามตัวกรองนี้
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <Row
                  key={r.contractId}
                  row={r}
                  canRecord={canRecordRow(role, divisionScope, r)}
                  showActions={canAny}
                  showClose={CLOSE_CONTRACT_AVAILABLE && canCloseContract(role, divisionScope, r) && isClosable(r.status)}
                  closeBlock={closeBlockReason(r, today)}
                  onClose={() => {
                    setCloseError(null);
                    setCloseId(r.contractId);
                  }}
                  teamCode={teamCode(r.last?.teamId ?? null)}
                  onOpen={(kind) => {
                    setDialogError(null);
                    setDialog({ kind, id: r.contractId });
                  }}
                  onReason={() => setReasonFor(r.contractId)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {held.length > 0 ? (
        <Alert variant="info" title={`ยังไม่ขึ้นรายการเก็บสถานี ${held.length} ราย (มีเรื่องรอชดเชย)`} className="mt-3">
          {held.map((h) => `${h.customerName} · รอชดเชย ${monthLabel(h.missedMonth)}`).join(" · ")} — จะขึ้นรายการหลังบันทึกบริการชดเชย หรือกดไม่ชดเชย
        </Alert>
      ) : null}

      <div className="mt-3 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] text-fg-muted">
        หมดสัญญาแล้วระบบ <b>ไม่ลบลูกค้าออกอัตโนมัติ</b> · เก็บคืนเฉพาะ <b>IG</b> (กล่อง AG ที่ค้างไม่ต้องเก็บและไม่ขวางการปิดสัญญา · IC มอบให้ลูกค้า) · IG ที่ “ไม่เก็บ” ต้องมีเหตุผล และนับเป็น “IG ที่ทิ้งไว้สะสม”
        เพื่อดูต้นทุน · หน้านี้เห็นเฉพาะภายใน (Admin / Recorder / Host) ไม่ส่งเข้า Dashboard สาธารณะ
      </div>

      {dialog && target ? (
        <CollectDialog
          key={`${dialog.kind}-${dialog.id}`}
          kind={dialog.kind}
          row={target}
          teams={teams}
          today={today}
          busy={busy}
          error={dialogError}
          onSubmit={submit}
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        />
      ) : null}
      {closeRow ? <ConfirmClose row={closeRow} busy={busy} error={closeError} onConfirm={doClose} onCancel={() => setCloseId(null)} /> : null}
      {reasonRow ? <ReasonDialog row={reasonRow} teamCode={teamCode(reasonRow.last?.teamId ?? null)} onClose={() => setReasonFor(null)} /> : null}
      <Toast message={toast} onClose={() => setToast("")} />
    </div>
  );
}

function Row({
  row: r,
  canRecord,
  showActions,
  teamCode,
  showClose,
  closeBlock,
  onClose,
  onOpen,
  onReason,
}: {
  row: CollectionRow;
  canRecord: boolean;
  showActions: boolean;
  teamCode: string | null;
  showClose: boolean;
  closeBlock: string | null;
  onClose: () => void;
  onOpen: (kind: DialogKind) => void;
  onReason: () => void;
}) {
  const base = igBase(r);
  const fin = r.remaining === 0;
  const href = customerDetailHref(r.customerId, customerLinkContexts.contract(r.contractId));
  const statusChip =
    r.status === "closed" ? <Chip tone="na">ปิดสัญญาแล้ว</Chip> : r.status === "cancelled" ? <Chip tone="na">สัญญายกเลิก</Chip> : <Chip tone="pend">หมดสัญญา · ยังไม่ปิด</Chip>;
  const finChip = fin ? (
    <Chip tone={r.notCollected ? "na" : "ok"}>
      {r.notCollected ? `ลูกค้าไม่ให้เก็บ ${r.notCollected} สถานี` : "เก็บครบแล้ว"}
      {r.finishMonth ? ` · ${monthLabel(r.finishMonth)}` : ""}
    </Chip>
  ) : null;
  const disabledTip = showActions && !canRecord ? "อยู่นอกขอบเขตสาขาของบัญชีนี้" : undefined;
  const cell = "px-3 py-2.5 align-top max-[767px]:flex max-[767px]:justify-between max-[767px]:gap-3 max-[767px]:px-0 max-[767px]:py-1.5 max-[767px]:before:shrink-0 max-[767px]:before:text-[12px] max-[767px]:before:text-fg-muted max-[767px]:before:content-[attr(data-label)]";

  return (
    <tr className={cx("border-t border-border max-[767px]:mb-3 max-[767px]:block max-[767px]:rounded-[10px] max-[767px]:border max-[767px]:bg-surface max-[767px]:p-3", fin && "bg-surface-2/50")}>
      <td className={cell} data-label="ลูกค้า · สาขา">
        <div className="min-w-0 max-[767px]:text-right">
          {href ? (
            <Link href={href} className="break-words font-semibold text-accent no-underline hover:underline focus-visible:outline-2 focus-visible:outline-accent">
              {r.customerName}
            </Link>
          ) : (
            <b>{r.customerName}</b>
          )}
          <small className="block text-[12px] text-fg-muted">{r.branchName}</small>
        </div>
      </td>
      <td className={cell} data-label="สัญญา">
        <div className="max-[767px]:text-right">
          <span className="tabular-nums">{r.contractNo}</span>
          <small className="block text-[12px] tabular-nums text-fg-muted">
            {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
          </small>
          <span className="mt-1 inline-block">{statusChip}</span>
        </div>
      </td>
      <td className={cell} data-label="IG (เก็บแล้ว / ทั้งหมด)">
        <div className="min-w-[140px] max-[767px]:text-right">
          <span className="tabular-nums">
            <b>{r.collected}</b> / {base} สถานี
          </span>
          <Bar got={r.collected} skip={r.notCollected} rest={r.remaining} total={base} small label={`เก็บแล้ว ${r.collected} · ไม่เก็บ ${r.notCollected} · เหลือ ${r.remaining}`} />
          <small className="mt-1 block text-[12px] text-fg-muted">
            {r.remaining > 0 ? (
              <>
                <span className="font-semibold text-danger">เหลือ {r.remaining}</span>
                {r.notCollected ? ` · ไม่เก็บ ${r.notCollected}` : ""}
              </>
            ) : r.notCollected ? (
              `ไม่เหลือให้เก็บ · ไม่เก็บ ${r.notCollected}`
            ) : (
              "เก็บครบ"
            )}
            {r.moved ? ` · ย้ายไปสัญญาใหม่ ${r.moved}` : ""}
          </small>
        </div>
      </td>
      <td className={cell} data-label="วันที่เก็บ">
        <div className="tabular-nums max-[767px]:text-right">
          {r.last ? (
            <>
              {fmtDate(r.last.date)}
              <small className="block text-[12px] text-fg-muted">
                {teamCode ? `ทีม ${teamCode}` : "ไม่ระบุทีม"}
                {r.last.kind === "not_collected" ? " · ลูกค้าไม่ให้เก็บ" : ""}
                {r.last.kind === "not_collected" && r.last.reasons.length > 0 ? (
                  <button
                    type="button"
                    onClick={onReason}
                    aria-label={`ดูเหตุผลที่ลูกค้าไม่ให้เก็บ ${r.customerName}`}
                    className="ml-1.5 min-h-6 cursor-pointer rounded border border-border-strong bg-surface px-1.5 text-[12px] text-accent hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent max-[767px]:min-h-11 max-[767px]:px-3"
                  >
                    เหตุผล
                  </button>
                ) : null}
              </small>
            </>
          ) : (
            <span className="text-fg-faint">-</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right align-top max-[767px]:px-0 max-[767px]:pb-0 max-[767px]:pt-2 max-[767px]:text-left">
        {showActions && (r.remaining > 0 || showClose) ? (
          <div className="flex flex-wrap justify-end gap-1.5 max-[767px]:justify-start">
            {r.remaining > 0 ? (
              <>
                <Button size="sm" variant="primary" disabled={!canRecord} title={disabledTip} className="max-[767px]:min-h-11 max-[767px]:px-4" onClick={() => onOpen("collected")}>
                  เก็บแล้ว
                </Button>
                <Button size="sm" disabled={!canRecord} title={disabledTip} className="max-[767px]:min-h-11 max-[767px]:px-4" onClick={() => onOpen("not_collected")}>
                  ไม่เก็บ
                </Button>
              </>
            ) : null}
            {showClose ? (
              <Button size="sm" disabled={closeBlock !== null} title={closeBlock ?? undefined} className="max-[767px]:min-h-11 max-[767px]:px-4" onClick={onClose}>
                ปิดสัญญา
              </Button>
            ) : null}
          </div>
        ) : null}
        {finChip ? <div className={cx(showActions && (r.remaining > 0 || showClose) && "mt-1.5")}>{finChip}</div> : null}
      </td>
    </tr>
  );
}

function ConfirmClose({ row, busy, error, onConfirm, onCancel }: { row: CollectionRow; busy: boolean; error: string | null; onConfirm: (note: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  useUnsavedWork(note !== "");
  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="collect-close-title"
      className="m-auto w-[min(480px,calc(100vw-24px))] rounded-xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow)] backdrop:bg-black/40"
    >
      <div className="px-4 py-4">
        <h2 id="collect-close-title" className="m-0 text-base font-semibold">
          ปิดสัญญา {row.contractNo}
        </h2>
        <p className="m-0 mt-1 text-[13px] text-fg-muted">
          {row.customerName}
          {row.remaining > 0
            ? ` · มี IG ยังไม่เก็บ ${row.remaining} สถานี — ปิดสัญญาได้ และ IG เหล่านี้ยังอยู่ในรายการรอเก็บจนกด “เก็บแล้ว” หรือ “ไม่เก็บ”`
            : " · IG เก็บครบแล้ว"}
        </p>
        <label htmlFor="cl-close-note" className="mt-3 block text-[12px] font-semibold text-fg-muted">
          หมายเหตุ (ไม่บังคับ)
        </label>
        <textarea
          id="cl-close-note"
          rows={2}
          maxLength={CLOSE_NOTE_MAX}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full min-w-0 resize-y rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-[767px]:text-base"
        />
        {error ? (
          <p role="alert" className="m-0 mt-3 rounded-lg border-l-4 border-l-danger bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button className="max-[767px]:min-h-11" disabled={busy} onClick={() => ref.current?.close()}>
          ยกเลิก
        </Button>
        <Button className="max-[767px]:min-h-11" variant="primary" loading={busy} onClick={() => onConfirm(note)}>
          ยืนยัน ปิดสัญญา
        </Button>
      </div>
    </dialog>
  );
}
