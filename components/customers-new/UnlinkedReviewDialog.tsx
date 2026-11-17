"use client";

/**
 * UnlinkedReviewDialog — กล่อง "เชื่อมสัญญาเก่า (Renew)" ของแถวที่บันทึกแล้วและยังไม่ผูกสัญญาเก่า (M28b · mockup FINAL)
 * (host + admin) · สองมุมมอง:
 *   1) แสดงสัญญาอื่นของลูกค้านี้ทันที (กรองด้วยเลขที่สัญญา) → เลือกสัญญาเก่าของ "ลูกค้าคนเดียวกัน" แล้วเชื่อม (RPC link_renewal_contract) · ใบที่เกินช่วง Renew 2 เดือนกดไม่ได้
 *   2) "ไม่มีสัญญาเก่าในระบบ" → หมายเหตุ (ไม่บังคับ + คำเตือนห้ามใส่ข้อมูลส่วนตัว) → ปิดรายการ (RPC close_unlinked_renewal)
 * สิทธิ์จริงอยู่ที่ DB (admin นอกขอบเขต = 42501 แปลเป็นไทยใน errors.ts) · สำเร็จแล้วเรียก `onDone` ให้หน้าโหลดแถวใหม่
 * ห้าม log หมายเหตุ/ข้อมูลลูกค้า
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { Alert, Button } from "@/components/ui";

import { describeDbError } from "./errors";
import { Modal } from "./Modal";
import { loadCustomerOtherContracts } from "./renewal";
import { renewGapBlockReason } from "./renewRules";
import type { RenewalLink, SavedContract } from "./types";
import {
  CLOSE_NOTE_MAX,
  CLOSE_NOTE_WARNING,
  closeUnlinkedRenewal,
  filterByContractNo,
  linkRenewalContract,
  unlinkedStateOf,
} from "./unlinkedReview";

export function UnlinkedReviewDialog({
  supabase,
  contract,
  branchNameOf,
  onDone,
  onClose,
}: {
  supabase: SupabaseClient;
  contract: SavedContract;
  branchNameOf: (branchId: string) => string;
  /** สำเร็จ (เชื่อม/ปิด) — หน้าจอโหลดแถวใหม่แล้วปิดกล่อง */
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const closed = unlinkedStateOf(contract) === "closed";
  const [view, setView] = useState<"search" | "close">("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RenewalLink[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // โหลดสัญญาอื่นของลูกค้าคนนี้ทันทีที่เปิดกล่อง (ไม่ค้นด้วยชื่อ — ชื่อมีวงเล็บแล้วค้นไม่เจอ)
  useEffect(() => {
    let cancelled = false;
    void loadCustomerOtherContracts(supabase, contract.customerId, contract.contractId).then((res) => {
      if (cancelled) return;
      setSearchError(res.error);
      setResults(res.results);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, contract.customerId, contract.contractId]);

  const shown = results ? filterByContractNo(results, q) : null;

  async function link(r: RenewalLink) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const res = await linkRenewalContract(supabase, contract.contractId, r.contractId);
    setBusy(false);
    if (!res.ok) {
      setActionError(describeDbError(res.error, "link"));
      return;
    }
    onDone(`เชื่อมสัญญา ${contract.contractNo} กับสัญญาเก่า ${r.contractNo} แล้ว`);
  }

  async function close() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const res = await closeUnlinkedRenewal(supabase, contract.contractId, note);
    setBusy(false);
    if (!res.ok) {
      setActionError(describeDbError(res.error, "close"));
      return;
    }
    onDone(`ปิดรายการสัญญา ${contract.contractNo} แล้ว (ไม่มีสัญญาเก่าในระบบ)`);
  }

  return (
    <Modal
      title={view === "close" ? "ไม่มีสัญญาเก่าในระบบ" : "เชื่อมสัญญาเก่า (Renew)"}
      subtitle={`สัญญา ${contract.contractNo} · ${branchNameOf(contract.branchId)}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3 text-[13px]">
        {contract.renewUnlinkedReason ? (
          <p className="m-0 rounded-lg bg-surface-2 px-3 py-2">
            <b>เหตุผลที่บันทึกไว้:</b> {contract.renewUnlinkedReason}
          </p>
        ) : null}
        {closed ? (
          <Alert variant="info">รายการนี้ปิดแล้ว (ไม่มีสัญญาเก่าในระบบ) — ถ้าเจอสัญญาเก่าทีหลัง เชื่อมได้จากกล่องนี้</Alert>
        ) : null}

        {view === "search" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">สัญญาอื่นของลูกค้ารายนี้ · กรองด้วยเลขที่สัญญา</span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
                placeholder="กรองด้วยเลขที่สัญญา"
                className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            {searchError ? <Alert variant="danger">{searchError}</Alert> : null}
            {results === null && !searchError ? <p className="m-0 text-fg-muted">กำลังโหลด…</p> : null}
            {results && results.length === 0 ? (
              <p className="m-0 text-fg-muted">ลูกค้ารายนี้ไม่มีสัญญาอื่นในระบบ</p>
            ) : null}
            {shown && results && results.length > 0 && shown.length === 0 ? (
              <p className="m-0 text-fg-muted">ไม่พบเลขที่สัญญาที่ตรงกับ “{q.trim()}”</p>
            ) : null}
            {shown && shown.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {shown.map((r) => {
                  const blocked = renewGapBlockReason(r, contract.startDate);
                  return (
                    <li key={r.contractId}>
                      <button
                        type="button"
                        disabled={blocked !== null || busy}
                        onClick={() => void link(r)}
                        className="flex w-full cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint disabled:hover:bg-surface-2"
                      >
                        <span className="num font-semibold">{r.contractNo}</span>
                        <span className="min-w-0 flex-1 break-words">{r.customerName}</span>
                        <span className="text-fg-muted">{branchNameOf(r.branchId)}</span>
                        {blocked ? <span className="w-full text-[12px] text-danger">🔒 {blocked}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="close-note" className="text-[11px] text-fg-muted">
              หมายเหตุ (ไม่บังคับ)
            </label>
            <textarea
              id="close-note"
              autoFocus
              value={note}
              maxLength={CLOSE_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              aria-describedby="close-note-warn"
              placeholder="เช่น สัญญาเก่าอยู่ในไฟล์ Excel เดิม ยังไม่นำเข้าระบบ"
              className="min-h-20 w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-accent"
            />
            <p id="close-note-warn" className="m-0 text-[12px] text-danger">
              ⚠ {CLOSE_NOTE_WARNING}
            </p>
            <p className="m-0 text-[12px] text-fg-muted">
              ตรวจแล้วว่าไม่มีสัญญาเก่าจริง → รายการจะถูกปิด (ยังเป็น Renew ตามเดิม) · ถ้าเริ่มเกิน 2 เดือนหลังสัญญาเก่าจบ ให้เปลี่ยนเป็น New แทน
            </p>
          </div>
        )}

        {actionError ? <Alert variant="danger">{actionError}</Alert> : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          {view === "close" ? (
            <>
              <Button size="sm" onClick={() => setView("search")} disabled={busy}>
                ← กลับไปค้นหา
              </Button>
              <span className="flex-1" />
              <Button size="sm" variant="primary" loading={busy} onClick={() => void close()}>
                ยืนยัน ปิดรายการ
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1" />
              {closed ? null : (
                <Button size="sm" onClick={() => setView("close")} disabled={busy}>
                  ไม่มีสัญญาเก่าในระบบ
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
