"use client";

/**
 * แท็บ "สัญญา" — ตารางสัญญาของลูกค้า + การ์ดรายละเอียดของสัญญาที่เลือก
 *
 * Logic summary:
 *   * Tier = ป้ายของสัญญา (TierBadge · เกณฑ์เดือนเริ่ม จาก lib/rules) · ระยะ = termMonths (M30) · วันสิ้นสุด/เดือนบริการ จาก lib/rules
 *   * วันสิ้นสุดที่เก็บไว้ไม่ตรงกฎ (เริ่ม + N เดือน − 1 วัน) → ป้ายเตือน "ไม่ตรงกฎ"
 *   * Renew: บอกว่าต่อจากสัญญาไหน/ย้ายสถานีมากี่จุด และสัญญาเก่าชี้ไปสัญญาใหม่ · ดูประวัติสัญญาเก่าได้เสมอ
 *   * หมดสัญญารอเก็บ: แถบความคืบหน้าเก็บสถานี IG (IC มอบลูกค้า · AG ที่ค้างไม่ต้องเก็บ)
 *   * "แก้สัญญานี้" เป็นลิงก์ไปหน้าเปิดงาน (host/admin · admin แก้สัญญาปิดแล้ว/ยกเลิกไม่ได้)
 *   * ปุ่ม "ยกเลิกสัญญา" / "เปิดสัญญากลับ" (DECISIONS 2.97 · M44 · host + admin) — เรียก RPC cancel_contract / reopen_contract ผ่านกล่องยืนยัน
 *     เงื่อนไขปุ่มอยู่ที่ cancelContract.ts (ซ่อนตามสถานะ · ฐานข้อมูลตรวจซ้ำ) · สัญญาที่ยกเลิกแสดงเหตุผล/ผู้ยกเลิก/วันที่
 */
import Link from "next/link";
import { useState } from "react";

import { TierBadge } from "@/components/ui";
import { serviceMonthsForTerm } from "@/lib/rules";
import { createClient } from "@/lib/supabase/client";

import { CANCEL_REASON_LABEL, canShowCancel, canShowReopen, cancelContract, isCancelReasonCode, reopenContract } from "../cancelContract";
import { CancelContractDialog, ReopenContractDialog } from "../ContractCancelDialogs";
import type { GotoOpts, TabKey } from "../Header";
import {
  canEditContract,
  collectProgress,
  contractEnd,
  CONTRACT_STATUS_LABEL,
  customerPermissions,
  fmtDate,
  fmtNum,
  monthStates,
  monthTh,
  ruleEnd,
  sortContracts,
  stationCounts,
  termText,
} from "../logic";
import { Hint, Icon, TABLE_WRAP, TD_CLASS, TH_CLASS, Tag } from "../parts";
import type { ContractRow, CustomerDetailData } from "../types";

const BTN = "inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs text-fg hover:bg-surface-2 max-md:min-h-11 md:min-h-8";

export function ContractsTab({
  data,
  selected,
  onPick,
  onGoto,
  onToast,
  onChanged,
}: {
  data: CustomerDetailData;
  selected: string | null;
  onPick: (contractId: string) => void;
  onGoto: (tab: TabKey, opts?: GotoOpts) => void;
  /** แสดงข้อความแจ้งผลมุมจอ */
  onToast: (message: string) => void;
  /** โหลดข้อมูลหน้าใหม่หลังยกเลิก/เปิดกลับสำเร็จ */
  onChanged: () => void;
}) {
  const cs = sortContracts(data.contracts);
  const sel = cs.find((c) => c.id === selected) ?? cs[0];
  if (!sel) return <p className="m-0 text-[13px] text-fg-muted">ลูกค้ารายนี้ยังไม่มีสัญญา</p>;

  return (
    <div>
      <Hint>1 ลูกค้ามีได้หลายสัญญา — ต่อสัญญา (Renew) = สัญญาใหม่ต่อจากสัญญาเดิม · Tier คิดจากมูลค่าต่อปีตามเกณฑ์ที่ตั้งไว้ · กดเลขสัญญาเพื่อดูรายละเอียดด้านล่าง</Hint>
      <div className={TABLE_WRAP}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className={TH_CLASS}>สัญญา</th>
              <th scope="col" className={TH_CLASS}>Tier</th>
              <th scope="col" className={TH_CLASS}>ช่วงสัญญา</th>
              <th scope="col" className={`${TH_CLASS} text-right`}>มูลค่า (บาท)</th>
              <th scope="col" className={TH_CLASS}>ทีม</th>
            </tr>
          </thead>
          <tbody>
            {cs.map((k) => {
              const s = CONTRACT_STATUS_LABEL[k.status];
              return (
                <tr key={k.id} className={k.id === sel.id ? "bg-accent-soft" : undefined}>
                  <td className={TD_CLASS}>
                    <button
                      type="button"
                      aria-pressed={k.id === sel.id}
                      onClick={() => onPick(k.id)}
                      className="min-h-11 font-mono text-[13px] font-semibold text-accent-strong underline md:min-h-8"
                    >
                      {k.no}
                    </button>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Tag tone={s.tone}>{s.text}</Tag>
                      <span className="text-xs text-fg-muted">
                        {k.saleType === "renew" ? "Renew" : "New"} · {termText(k.termMonths)}
                      </span>
                    </div>
                  </td>
                  <td className={TD_CLASS}>
                    <TierBadge tier={k.tier} termMonths={k.termMonths} />
                  </td>
                  <td className={TD_CLASS}>
                    {fmtDate(k.startDate)} – {fmtDate(contractEnd(k))}
                  </td>
                  <td className={`${TD_CLASS} text-right tabular-nums`}>{fmtNum(k.valueTotal)}</td>
                  <td className={TD_CLASS}>{k.teamCodes.join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ContractDetail data={data} k={sel} onPick={onPick} onGoto={onGoto} onToast={onToast} onChanged={onChanged} />
    </div>
  );
}

function ContractDetail({
  data,
  k,
  onPick,
  onGoto,
  onToast,
  onChanged,
}: {
  data: CustomerDetailData;
  k: ContractRow;
  onPick: (id: string) => void;
  onGoto: (tab: TabKey, opts?: GotoOpts) => void;
  onToast: (message: string) => void;
  onChanged: () => void;
}) {
  const perm = customerPermissions(data.role);
  const [dialog, setDialog] = useState<"cancel" | "reopen" | null>(null);
  const showCancel = canShowCancel(data.role, k, data.contracts);
  const showReopen = canShowReopen(data.role, k);
  const ms = monthStates(k, data.visits, data.currentMonth);
  const cnt = { ok: ms.filter((x) => x.state === "ok").length, miss: ms.filter((x) => x.state === "miss").length, total: ms.length };
  const sc = stationCounts(data.stations.filter((s) => s.contractId === k.id));
  const end = contractEnd(k);
  const badEnd = !!k.endDate && k.endDate.slice(0, 10) !== ruleEnd(k);
  const months = serviceMonthsForTerm(k.startDate, k.termMonths);
  const st = CONTRACT_STATUS_LABEL[k.status];
  const old = k.renewedFromId ? data.contracts.find((c) => c.id === k.renewedFromId) : undefined;
  const succ = data.contracts.find((c) => c.renewedFromId === k.id);
  const sitePlans = data.files.filter((f) => f.contractId === k.id && f.kind === "site_plan");
  const steps = ["active", "expired_pending_collection", "closed"] as const;
  const idx = steps.indexOf(k.status as (typeof steps)[number]);
  const moved = { IG: 0, IC: 0, AG: 0 };
  if (old) for (const s of data.stations) if (s.contractId === k.id && s.movedFromContractNo === old.no) moved[s.type] += 1;
  const leftAtOld = old ? data.stations.filter((s) => s.contractId === old.id).length : 0;
  const editable = perm.edit && canEditContract(data.role, k.status);
  const lockedForAdmin = perm.edit && !editable;
  const collect = k.status === "expired_pending_collection" ? collectProgress(data.stations, k.id) : null;
  const pc = collect && collect.total ? Math.round(((collect.done + collect.waived) / collect.total) * 100) : 0;

  const item = (label: string, body: React.ReactNode) => (
    <div className="min-w-0">
      <span className="block text-xs text-fg-muted">{label}</span>
      {body}
    </div>
  );

  return (
    <section className="mt-3 rounded-xl border border-border bg-surface p-3.5" aria-label={`รายละเอียดสัญญา ${k.no}`}>
      <h3 className="m-0 mb-3 flex flex-wrap items-center gap-2 text-[15px]">
        <span className="font-mono">{k.no}</span>
        <TierBadge tier={k.tier} termMonths={k.termMonths} />
        <Tag tone={st.tone}>{st.text}</Tag>
        <Tag tone={k.saleType === "renew" ? "na" : "info"}>{k.saleType === "renew" ? "Renew" : "New"}</Tag>
      </h3>
      <div className="grid gap-x-4 gap-y-3 text-[13px] [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {item("ลูกค้า / ทีม", <span data-clarity-mask="True">{data.customer.name}</span>)}
        {item(
          "วันเริ่ม – วันสิ้นสุด",
          <span>
            {fmtDate(k.startDate)} – {fmtDate(end)}
            {badEnd ? (
              <span className="ml-1.5" title={`ควรเป็น ${fmtDate(ruleEnd(k))}`}>
                <Tag tone="pend">
                  <Icon name="alertc" className="size-3.5" /> ไม่ตรงกฎ
                </Tag>
              </span>
            ) : null}
          </span>,
        )}
        {item("ทีมที่ดูแล", k.teamCodes.join(", ") || "—")}
        {item(
          "เดือนบริการ",
          <span>
            {monthTh(months[0] ?? "")} – {monthTh(months[months.length - 1] ?? "")} · {months.length} เดือน
          </span>,
        )}
        {item("มูลค่าสัญญา", <span>{fmtNum(k.valueTotal)} บาท · {termText(k.termMonths)}</span>)}
        {item("Site plan", <span>อยู่ในไฟล์สัญญา · {sitePlans.length ? `อัปเดต ${sitePlans.length} ครั้ง` : "ยังไม่มีอัปเดต"}</span>)}
        {item("ปิดสัญญา / ยกเลิก", k.closedAt ? `ปิดเมื่อ ${fmtDate(k.closedAt.slice(0, 10))}` : k.cancelledAt ? `ยกเลิก ${fmtDate(k.cancelledAt.slice(0, 10))}` : "—")}
        {item("สถานี", <span>{sc.total} จุด ({sc.IG} IG · {sc.IC} IC · {sc.AG} AG)</span>)}
        {item(
          "บริการประจำเดือน",
          <span>
            ครบ {cnt.ok} · <span className={cnt.miss ? "text-danger" : undefined}>ตกบริการ {cnt.miss}</span> / {cnt.total} เดือน
          </span>,
        )}
      </div>

      {old ? (
        <div className="mt-3 rounded-lg border-l-4 border-l-accent bg-accent-soft px-3 py-2 text-[13px]">
          <b>สัญญาต่อเนื่อง (Renew)</b> — ต่อจากสัญญา <span className="font-mono">{old.no}</span>
          <br />
          ย้ายสถานีมาจากสัญญาเก่า <b>{moved.IG} IG · {moved.IC} IC</b> (F นับต่อจากเดิม) · ไม่ย้าย {leftAtOld} จุด{leftAtOld ? " (อยู่กับสัญญาเก่า / รอเก็บสถานี)" : ""} · ประวัติผลบริการของสัญญาเก่าเปิดดูได้เสมอ
        </div>
      ) : null}
      {succ ? (
        <div className="mt-3 rounded-lg border-l-4 border-l-accent bg-accent-soft px-3 py-2 text-[13px]">
          <b>ต่อสัญญาแล้ว</b> — สัญญาใหม่ <span className="font-mono">{succ.no}</span> · สถานีที่ยังใช้งานย้ายไปสัญญาใหม่ · ผลบริการของสัญญานี้เปิดดูอ้างอิงได้เสมอ
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => onGoto("stations", { contractId: k.id })}>
          <Icon name="pin" /> สถานี
        </button>
        <button type="button" className={BTN} onClick={() => onGoto("visits", { contractId: k.id })}>
          <Icon name="history" /> ประวัติทำบริการ
        </button>
        <button type="button" className={BTN} onClick={() => onGoto("files", { contractId: k.id })}>
          <Icon name="file" /> ไฟล์
        </button>
        {old ? (
          <button type="button" className={BTN} onClick={() => onPick(old.id)}>
            <Icon name="back" /> สัญญาเก่า {old.no}
          </button>
        ) : null}
        {succ ? (
          <button type="button" className={BTN} onClick={() => onPick(succ.id)}>
            <Icon name="moved" /> สัญญาใหม่ {succ.no}
          </button>
        ) : null}
        {showCancel ? (
          <button type="button" className={`${BTN} text-danger`} onClick={() => setDialog("cancel")}>
            <Icon name="lock" /> ยกเลิกสัญญา
          </button>
        ) : null}
        {showReopen ? (
          <button type="button" className={BTN} onClick={() => setDialog("reopen")}>
            <Icon name="back" /> เปิดสัญญากลับ
          </button>
        ) : null}
        {editable ? (
          <Link href={`/customers/new?month=${k.startDate.slice(0, 7)}`} className={`${BTN} ml-auto no-underline`} title="ไปหน้าเปิดงานเพื่อแก้สัญญานี้ (ทุกการแก้ลงประวัติ)">
            <Icon name="pencil" /> แก้สัญญานี้
          </Link>
        ) : lockedForAdmin ? (
          <span className="ml-auto" title="admin แก้ไม่ได้ — ถ้าพิมพ์ผิดจริงให้แจ้ง host">
            <Tag tone="na">
              <Icon name="lock" className="size-3.5" /> สัญญา{k.status === "closed" ? "ปิดแล้ว" : "ยกเลิก"} · แก้ได้เฉพาะ host
            </Tag>
          </span>
        ) : null}
      </div>

      {k.status === "cancelled" ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-full bg-danger-soft px-2.5 py-1 font-semibold text-danger">ยกเลิก</span>
          {k.cancelledAt ? <span className="text-fg-muted">เมื่อ {fmtDate(k.cancelledAt)}</span> : null}
          {isCancelReasonCode(k.cancelReasonCode) ? (
            <span className="rounded-full bg-surface-3 px-2.5 py-1 text-fg">เหตุผล: {CANCEL_REASON_LABEL[k.cancelReasonCode]}</span>
          ) : null}
          {k.cancelledByName ? <span className="text-fg-muted">โดย {k.cancelledByName}</span> : null}
          {k.cancelReason ? <p className="m-0 w-full text-fg-muted">{k.cancelReason}</p> : null}
        </div>
      ) : (
        <ol aria-label="สถานะสัญญา" className="m-0 mt-3 flex list-none flex-wrap items-center gap-1.5 p-0 text-xs">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true">›</span> : null}
              <span className={`rounded-full px-2.5 py-1 ${i === idx ? "bg-accent font-semibold text-accent-fg" : i < idx ? "bg-surface-3 text-fg-muted" : "border border-border text-fg-muted"}`}>
                {CONTRACT_STATUS_LABEL[s].text}
              </span>
            </li>
          ))}
        </ol>
      )}

      {collect ? (
        <div className="mt-3">
          <div className="flex flex-wrap justify-between gap-x-3 text-xs text-fg-muted">
            <span>เก็บสถานี IG คืนบริษัท (IC มอบให้ลูกค้า · AG ที่ค้างไม่ต้องเก็บ)</span>
            <b className="text-fg">
              เก็บแล้ว {collect.done}
              {collect.waived ? ` · ไม่เก็บ ${collect.waived}` : ""} · รอเก็บ {collect.pending} / {collect.total} จุด
            </b>
          </div>
          <div role="progressbar" aria-valuenow={pc} aria-valuemin={0} aria-valuemax={100} aria-label="ความคืบหน้าการเก็บสถานีคืน" className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
            <i className="block h-full bg-ok" style={{ width: `${pc}%` }} />
          </div>
          <p className="m-0 mt-1 text-xs text-fg-muted">
            {collect.pending
              ? `ปิดสัญญาได้แม้ยังเหลือ IG ${collect.pending} จุด — จุดที่ค้างยังขึ้น “รอเก็บ” จนกด “เก็บแล้ว” หรือ “ไม่เก็บ” (ไม่เก็บต้องระบุเหตุผล + ยืนยัน)`
              : "IG จัดการครบทุกจุดแล้ว (เก็บแล้ว / ไม่เก็บ)"}
          </p>
        </div>
      ) : null}

      {dialog === "cancel" ? (
        <CancelContractDialog
          contractNo={k.no}
          onClose={() => setDialog(null)}
          onSubmit={async (reasonCode, reason) => {
            const r = await cancelContract(createClient(), { contractId: k.id, reasonCode, reason });
            if (!r.ok) return r.message;
            setDialog(null);
            onToast(`ยกเลิกสัญญา ${k.no} แล้ว (ลงประวัติการแก้ไข)`);
            onChanged();
            return null;
          }}
        />
      ) : null}
      {dialog === "reopen" ? (
        <ReopenContractDialog
          contractNo={k.no}
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const r = await reopenContract(createClient(), { contractId: k.id, reason });
            if (!r.ok) return r.message;
            setDialog(null);
            onToast(`เปิดสัญญา ${k.no} กลับแล้ว (ลงประวัติการแก้ไข)`);
            onChanged();
            return null;
          }}
        />
      ) : null}
    </section>
  );
}
