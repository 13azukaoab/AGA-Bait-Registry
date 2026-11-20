"use client";

/**
 * MissedBox — กล่อง "เรื่องตกบริการรอตัดสิน" + ส่วนพับ "เรื่องที่ปิดแล้ว" (mockup #todo · DECISIONS 2.45–2.48)
 *
 * Logic summary:
 *   * แต่ละแถว = 1 เดือนที่ตกของ 1 สัญญา · ปุ่ม "บันทึกบริการชดเชย" (ลิงก์ /service?contract=&makeup= เข้าโหมดชดเชยที่ผูกเดือนที่ตก · DECISIONS 2.96) / "ไม่ชดเชย" (กล่องเหตุผล)
 *   * ปุ่มไหนกดได้ ตัดสินจาก missedActionState(role, pastDeadline) — เลยเพดานชดเชย หัวหน้างานกดชดเชยไม่ได้ (Host ได้)
 *   * เรื่องที่ปิดแล้ว: "ไม่ชดเชย" มีปุ่มเปิดเรื่องกลับ · "ชดเชยแล้ว" ดูอย่างเดียว
 *   * ข้อมูลทั้งหมดมาจากฐานข้อมูล (data.ts) — ไม่คำนวณสูตรตกบริการในหน้านี้
 *   * ค้างเยอะ (F2): แสดง 50 เรื่องแรกตามลำดับเดิม (เดือนที่ตกเก่าสุดก่อน) + ปุ่ม "แสดงเพิ่ม" ครั้งละ 50 · ตัวเลขในหัวกล่อง/การ์ดนับจากทั้งหมดเสมอ
 *   * เรื่องที่ปิดแล้วเป็นรายการ "ล่าสุด" CLOSED_LIMIT รายการ — เต็มเพดานแล้วเขียนกำกับให้ผู้ใช้รู้ ไม่ใช่ทั้งหมด
 */
import Link from "next/link";
import { useState } from "react";

import { CustomerLink } from "@/components/links/CustomerLink";
import { makeupHref } from "@/components/service/makeup";
import { Button } from "@/components/ui";
import { customerLinkContexts } from "@/lib/links/customerLink";
import { monthLabel } from "@/lib/service/months";
import type { UserRole } from "@/lib/db/types";

import { CLOSED_LIMIT, MISSED_PAGE_SIZE, missedActionState, nextVisible, visibleSlice, type ClosedMissed, type PendingMissed } from "./logic";
import { StatusChip } from "./StatusChip";

export function MissedBox({
  pending,
  closed,
  role,
  currentMonth,
  onWaive,
  onReopen,
  initialVisible = MISSED_PAGE_SIZE,
}: {
  pending: readonly PendingMissed[];
  closed: readonly ClosedMissed[];
  role: UserRole;
  /** เดือนปัจจุบัน — บริการชดเชยบันทึกในเดือนที่ไปทำจริง */
  currentMonth: string;
  onWaive: (item: PendingMissed) => void;
  onReopen: (item: ClosedMissed) => void;
  /** จำนวนเรื่องที่แสดงตอนเริ่ม (ค่าเริ่มต้น 50 · ใช้ปรับในเทสต์) */
  initialVisible?: number;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const [visible, setVisible] = useState(initialVisible);
  const canDecide = role === "host" || role === "recorder";
  const need = pending.length;
  const shown = visibleSlice(pending, visible);

  return (
    <section
      aria-labelledby="missed-title"
      className={`mb-4 rounded-xl border bg-surface shadow-[var(--shadow)] ${need ? "border-danger" : "border-ok"}`}
    >
      <h2 id="missed-title" className="m-0 flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-[15px] font-semibold">
        <span aria-hidden className={`size-2.5 rounded-full ${need ? "bg-danger" : "bg-ok"}`} />
        เรื่องตกบริการรอตัดสิน
        <span className={`rounded-full px-2 text-xs ${need ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok"}`}>{need}</span>
        <span className="text-xs font-normal text-fg-muted">
          ค้างจากเดือนก่อน · ไปบริการชดเชยแล้วกด “บันทึกบริการชดเชย” หรือลูกค้ายินยอมกด “ไม่ชดเชย”
        </span>
        {need > shown.length ? (
          <span className="text-xs font-normal text-fg-muted">
            ค้าง {need.toLocaleString("th-TH")} เรื่อง · แสดง {shown.length.toLocaleString("th-TH")}
          </span>
        ) : null}
        {canDecide ? null : <span className="ml-auto text-xs font-normal text-fg-muted">ดูอย่างเดียว</span>}
      </h2>

      {need === 0 ? <p className="m-0 px-4 py-4 text-[13px] text-fg-muted">ไม่มีเรื่องตกบริการค้างตัดสิน</p> : null}

      <ul className="m-0 list-none p-0">
        {shown.map((it) => {
          const a = missedActionState(role, it.pastDeadline);
          const sub = it.pastDeadline
            ? `เลยเพดานชดเชยแล้ว (ครบ ${monthLabel(it.deadlineMonth)}) — ${
                role === "host"
                  ? "Host บันทึกบริการชดเชยได้เป็นกรณีพิเศษ (เกินเพดาน)"
                  : "หัวหน้างานบันทึกบริการชดเชยไม่ได้ (ต้องให้ Host) · กด “ไม่ชดเชย” เพื่อปิดเรื่องได้"
              }`
            : `ชดเชยได้ถึง ${monthLabel(it.deadlineMonth)}`;
          const record = (
            <Link
              href={makeupHref(it.contractId, it.missedMonth) ?? `/service?zone=${it.zoneId}&branch=${it.branchId}&month=${currentMonth}`}
              aria-disabled={!a.recordEnabled}
              tabIndex={a.recordEnabled ? undefined : -1}
              title={
                a.recordEnabled
                  ? "ไปหน้าลงข้อมูลบริการ เพื่อบันทึกการเข้าชดเชย"
                  : canDecide
                    ? "เลยเพดานชดเชย — หัวหน้างานบันทึกไม่ได้ ต้องให้ Host"
                    : "ดูอย่างเดียว"
              }
              className={`inline-flex items-center justify-center rounded-md border px-2.5 py-1 text-xs max-md:min-h-11 md:min-h-10 ${
                a.recordEnabled
                  ? a.primary === "record"
                    ? "border-accent bg-accent text-accent-fg hover:bg-accent-strong"
                    : "border-border-strong bg-surface text-fg hover:bg-surface-2"
                  : "pointer-events-none border-border bg-surface-3 text-fg-faint"
              }`}
            >
              บันทึกบริการชดเชย{a.recordOverCapSuffix ? " (เกินเพดาน)" : ""}
            </Link>
          );
          return (
            <li key={`${it.contractId}-${it.missedMonth}`} className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[1fr_1.2fr_auto] md:items-center">
              <div>
                <b className="text-[13px]">
                  <CustomerLink customerId={it.customerId} context={customerLinkContexts.missed(it.contractId)} role={role}>
                    {it.customerName}
                  </CustomerLink>
                </b>
                <small className="block text-[12.5px] text-fg-muted">
                  สาขา{it.branchName} · {it.contractNo} · ตกบริการ {monthLabel(it.missedMonth)}
                </small>
              </div>
              <div>
                <StatusChip tone="miss">รอตัดสิน</StatusChip>
                {it.pastDeadline ? <StatusChip tone="na">เลยเพดาน</StatusChip> : null}
                <small className="mt-1 block text-[12.5px] text-fg-muted">{sub}</small>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={a.primary === "waive" ? "primary" : "secondary"}
                  className="max-md:min-h-11 md:min-h-10"
                  disabled={!a.waiveEnabled}
                  title={a.waiveEnabled ? undefined : "ดูอย่างเดียว — หัวหน้างาน/Host เท่านั้นที่ตัดสินได้"}
                  onClick={() => onWaive(it)}
                >
                  ไม่ชดเชย
                </Button>
                {record}
              </div>
            </li>
          );
        })}
      </ul>

      {need > shown.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span aria-live="polite" className="text-[13px] text-fg-muted">
            แสดง {shown.length.toLocaleString("th-TH")} จาก {need.toLocaleString("th-TH")} เรื่อง (เรียงเดือนที่ตกเก่าสุดก่อน)
          </span>
          <Button className="max-md:min-h-11 md:min-h-10" onClick={() => setVisible((v) => nextVisible(v, need))}>
            แสดงเพิ่ม (อีก {Math.min(MISSED_PAGE_SIZE, need - shown.length)} เรื่อง)
          </Button>
        </div>
      ) : null}

      {closed.length > 0 ? (
        <div className="border-t border-border px-4 py-2">
          <button
            type="button"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((v) => !v)}
            className="flex min-h-11 w-full items-center gap-2 text-left text-[13px] font-semibold text-fg-muted hover:text-fg md:min-h-10"
          >
            <svg viewBox="0 0 24 24" aria-hidden className={`size-4 fill-none stroke-current stroke-2 transition-transform ${showClosed ? "rotate-90" : ""}`}>
              <path d="M9 6l6 6-6 6" />
            </svg>
            {closed.length >= CLOSED_LIMIT
              ? `เรื่องที่ปิดล่าสุด ${CLOSED_LIMIT} รายการ (ไม่ชดเชย · ชดเชยแล้ว · แสดงเฉพาะล่าสุด)`
              : `เรื่องที่ปิดแล้ว ${closed.length} ราย (ไม่ชดเชย · ชดเชยแล้ว)`}
          </button>
          {showClosed ? (
            <ul className="m-0 list-none p-0">
              {closed.map((it) => (
                <li key={`${it.contractId}-${it.missedMonth}`} className="grid gap-2 border-t border-border py-3 md:grid-cols-[1fr_1.2fr_auto] md:items-center">
                  <div>
                    <b className="text-[13px]">
                      <CustomerLink customerId={it.customerId} context={customerLinkContexts.missed(it.contractId)} role={role}>
                        {it.customerName}
                      </CustomerLink>
                    </b>
                    <small className="block text-[12.5px] text-fg-muted">
                      สาขา{it.branchName} · {it.contractNo} · ตกบริการ {monthLabel(it.missedMonth)}
                    </small>
                  </div>
                  <div>
                    <StatusChip tone={it.kind === "waived" ? "na" : "ok"}>{it.kind === "waived" ? "ไม่ชดเชย" : "ชดเชยแล้ว"}</StatusChip>
                    <small className="mt-1 block text-[12.5px] text-fg-muted">
                      {it.kind === "waived" ? `เหตุผล: ${it.reason ?? "-"}` : `บันทึกบริการชดเชย${it.decidedOn ? ` ${it.decidedOn}` : ""}`}
                    </small>
                  </div>
                  <div>
                    {it.kind === "waived" ? (
                      <Button
                        size="sm"
                        className="max-md:min-h-11 md:min-h-10"
                        disabled={!canDecide}
                        title={canDecide ? undefined : "ดูอย่างเดียว"}
                        onClick={() => onReopen(it)}
                      >
                        เปิดเรื่องกลับ
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
