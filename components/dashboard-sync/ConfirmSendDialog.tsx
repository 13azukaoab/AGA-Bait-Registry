"use client";

/**
 * กล่องยืนยันก่อนส่งข้อมูลขึ้น Dashboard ผู้บริหาร (ใช้ร่วมกันที่หน้า Dashboard Sync และหน้าปิดเดือน)
 *
 * Logic summary:
 *   * ใช้ <dialog> + showModal() (เบราว์เซอร์จัดการ focus trap / พื้นหลังกดไม่ได้ให้)
 *   * บอกว่า "ส่งอะไร" (รายการ items) และ "ไปที่ไหน" (destination) ก่อนให้กดยืนยัน
 *   * focus เริ่มที่ปุ่ม "ยกเลิก" เสมอ · กด Esc = ยกเลิก · ระหว่างกำลังส่ง Esc/ยกเลิกใช้ไม่ได้
 *   * ถ้ากำหนด `phrase` ต้องพิมพ์คำนั้นให้ตรง (เช่น OCT.26) ปุ่ม "ยืนยันส่ง" จึงจะกดได้
 *   * state ของการเปิด/กดซ้ำอยู่ที่ `useConfirmFlow` (ใช้ createConfirmFlow จาก ./confirmFlow)
 *   * ไม่มีสีตายตัว — ใช้ token ใน app/globals.css เท่านั้น
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button, cx } from "@/components/ui";

import { createConfirmFlow, isConfirmPhraseOk, type ConfirmPhase } from "./confirmFlow";

/** hook: ผูก createConfirmFlow กับ React — `run` ใช้ค่าล่าสุดเสมอ (ไม่ค้าง closure เก่า) */
export function useConfirmFlow(run: () => Promise<void>) {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const [phase, setPhase] = useState<ConfirmPhase>("idle");
  const flow = useMemo(() => createConfirmFlow(() => runRef.current(), setPhase), []);
  return { phase, request: flow.request, cancel: flow.cancel, confirm: flow.confirm };
}

export type ConfirmItem = { label: string; value: React.ReactNode };

export type ConfirmSendDialogProps = {
  /** กล่องเปิดอยู่ (confirming หรือ running) */
  open: boolean;
  /** กำลังส่ง — ปุ่มทั้งสองกดไม่ได้ · Esc ไม่ปิด */
  running: boolean;
  title: string;
  /** รายการ "ส่งอะไร" (เดือน / ส่วน / ช่วงข้อมูล) */
  items: ConfirmItem[];
  /** "ไปที่ไหน" */
  destination: React.ReactNode;
  /** ข้อความเตือนเพิ่ม (ไม่บังคับ) */
  note?: React.ReactNode;
  /** ถ้ามี ต้องพิมพ์คำนี้ให้ตรงก่อนกดยืนยัน */
  phrase?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-5 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

export function ConfirmSendDialog(props: ConfirmSendDialogProps) {
  const { open, running, onCancel } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      // jsdom/เบราว์เซอร์เก่าที่ไม่มี showModal → ตกไปใช้ show() เพื่อไม่ให้ error
      if (typeof el.showModal === "function") el.showModal();
      else el.show();
      cancelRef.current?.focus(); // เริ่มที่ "ยกเลิก" เสมอ
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-send-title"
      onCancel={(e) => {
        // Esc: ห้ามให้เบราว์เซอร์ปิดเอง — ปิดผ่าน state เท่านั้น (ระหว่างส่งจะไม่ปิด)
        e.preventDefault();
        if (!running) onCancel();
      }}
      className={cx(
        "m-auto w-[min(92vw,30rem)] max-w-none rounded-card border border-border-strong bg-surface p-0 text-fg shadow-[var(--shadow)]",
        "backdrop:bg-[color-mix(in_srgb,var(--fg)_50%,transparent)]",
      )}
    >
      {open ? <DialogBody {...props} cancelRef={cancelRef} /> : null}
    </dialog>
  );
}

function DialogBody({
  running,
  title,
  items,
  destination,
  note,
  phrase,
  confirmLabel = "ยืนยันส่ง",
  onConfirm,
  onCancel,
  cancelRef,
}: ConfirmSendDialogProps & { cancelRef: React.RefObject<HTMLButtonElement | null> }) {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const phraseOk = phrase === undefined || isConfirmPhraseOk(typed, phrase);
  const MOBILE_BTN = "max-[767px]:min-h-11";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!running && phraseOk) onConfirm();
      }}
    >
      <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
        <span aria-hidden="true" className="mt-0.5 text-warn"><SendIcon /></span>
        <h2 id="confirm-send-title" className="m-0 text-[15px] font-semibold">{title}</h2>
      </div>

      <div className="space-y-3 px-4 py-3 text-[13px]">
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {items.map((it) => (
            <div key={it.label} className="contents">
              <dt className="text-fg-muted">{it.label}</dt>
              <dd className="m-0 break-words font-semibold">{it.value}</dd>
            </div>
          ))}
          <dt className="text-fg-muted">ส่งไปที่</dt>
          <dd className="m-0 break-words font-semibold">{destination}</dd>
        </dl>

        {note ? <p className="m-0 rounded-lg border-l-[3px] border-l-warn bg-warn-soft px-3 py-2">{note}</p> : null}

        {phrase !== undefined ? (
          <div>
            <label htmlFor={inputId} className="mb-1 block text-xs text-fg-muted">
              พิมพ์ <b className="tabular-nums text-fg">{phrase}</b> เพื่อยืนยันการส่ง
            </label>
            <input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={running}
              autoComplete="off"
              spellCheck={false}
              placeholder={phrase}
              className="w-52 max-w-full rounded-lg border border-border-strong bg-surface px-2.5 py-2 font-mono text-[15px] tracking-wider text-fg max-[767px]:min-h-11 max-[767px]:text-base"
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
        <Button ref={cancelRef} onClick={onCancel} disabled={running} className={MOBILE_BTN}>
          ยกเลิก
        </Button>
        <Button type="submit" variant="primary" loading={running} disabled={!phraseOk} className={MOBILE_BTN}>
          {running ? "กำลังส่ง…" : confirmLabel}
        </Button>
      </div>
    </form>
  );
}
