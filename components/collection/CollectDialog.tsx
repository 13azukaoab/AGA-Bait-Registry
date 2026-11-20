"use client";

/**
 * กล่องบันทึก "เก็บแล้ว" / "ไม่เก็บ" IG ของสัญญาหนึ่ง (mockup #collect FINAL · `clOpen`)
 *
 * Logic summary:
 *   * ช่อง: จำนวน IG (1…ที่ค้าง) · วันที่ (ไม่เกินวันนี้ · ไม่ก่อนวันถัดจากสัญญาสิ้นสุด = ตรง CL005) · ทีมที่เข้า (เฉพาะทีมบริการ/ติดตั้งที่เปิดใช้งาน)
 *     · เหตุผล (เฉพาะ "ไม่เก็บ" · บังคับ · ไม่เกิน 300 ตัวอักษร)
 *   * "ไม่เก็บ" ต้องยืนยันซ้ำอีกขั้น (mockup: "ไม่เก็บ IG N สถานีนี้อีก?")
 *   * ค่าเริ่มต้นทีม = ทีมประจำสัญญาที่ยังเลือกได้ · วันที่ = วันนี้
 *   * มีข้อมูลค้างในฟอร์ม (แก้จากค่าเริ่มต้น) → `useUnsavedWork` กันรีโหลดทับ
 *   * ผล error แสดงเป็นข้อความไทยในกล่อง (ไม่โชว์ข้อความดิบ)
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { Button, cx } from "@/components/ui";
import { isTeamAssignableToVisit } from "@/lib/service/teamKind";

import { minActionDate } from "./collectionRules";
import type { CollectionRow, TeamOption } from "./collectionTypes";
import { REASON_MAX, type ActionInput } from "./collectionRpc";

export type DialogKind = "collected" | "not_collected";

export interface DialogSubmit {
  input: ActionInput;
  reason: string | null;
}

const FIELD_LABEL = "text-[12px] font-semibold text-fg-muted";
const FIELD_CONTROL =
  "min-h-10 w-full min-w-0 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-[767px]:min-h-11 max-[767px]:text-base";

/** ตรวจค่าในฟอร์ม — pure (export ให้ทดสอบ) · คืนข้อความผิดพลาดภาษาไทย หรือ null ถ้าผ่าน */
export function validateForm(args: {
  kind: DialogKind;
  countText: string;
  remaining: number;
  date: string;
  minDate: string;
  maxDate: string;
  teamId: string;
  reason: string;
}): string | null {
  const t = args.countText.trim();
  const n = /^[0-9]+$/.test(t) ? Number(t) : NaN;
  if (!(n >= 1 && n <= args.remaining)) return `ใส่จำนวนตั้งแต่ 1 ถึง ${args.remaining} สถานี`;
  if (!args.date) return "กรุณาเลือกวันที่";
  if (args.date > args.maxDate) return "วันที่ต้องไม่เกินวันนี้";
  if (args.date < args.minDate) return "วันที่ต้องไม่ก่อนวันที่สัญญาสิ้นสุด";
  if (!args.teamId) return "กรุณาเลือกทีมที่เข้า";
  if (args.kind === "not_collected") {
    const r = args.reason.trim();
    if (!r) return "กรุณาพิมพ์เหตุผลที่ไม่เก็บ";
    if (r.length > REASON_MAX) return `เหตุผลยาวเกิน ${REASON_MAX} ตัวอักษร`;
  }
  return null;
}

export function CollectDialog({
  kind,
  row,
  teams,
  today,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  kind: DialogKind;
  row: CollectionRow;
  teams: readonly TeamOption[];
  today: string;
  busy: boolean;
  error: string | null;
  onSubmit: (s: DialogSubmit) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pickable = useMemo(() => teams.filter((t) => isTeamAssignableToVisit(t)), [teams]);
  const defaultTeam = useMemo(
    () => pickable.find((t) => row.teamIds.includes(t.id))?.id ?? "",
    [pickable, row.teamIds],
  );
  const minDate = minActionDate(row);
  const initialDate = today < minDate ? minDate : today;

  const [countText, setCountText] = useState(String(row.remaining));
  const [date, setDate] = useState(initialDate);
  const [teamId, setTeamId] = useState(defaultTeam);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const dirty = countText !== String(row.remaining) || date !== initialDate || teamId !== defaultTeam || reason !== "";
  useUnsavedWork(dirty);

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  const isSkip = kind === "not_collected";
  const count = Number(countText.trim());
  const shown = localError ?? error;

  function check(): boolean {
    const msg = validateForm({ kind, countText, remaining: row.remaining, date, minDate, maxDate: today, teamId, reason });
    setLocalError(msg);
    return msg === null;
  }

  function submit() {
    onSubmit({
      input: { contractId: row.contractId, count, date, teamId },
      reason: isSkip ? reason.trim() : null,
    });
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      aria-labelledby="collect-dialog-title"
      className="m-auto w-[min(520px,calc(100vw-24px))] rounded-xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow)] backdrop:bg-black/40"
    >
      <div className="px-4 pb-1 pt-4">
        <h2 id="collect-dialog-title" className="m-0 text-base font-semibold">
          {isSkip ? "ไม่เก็บ IG" : "เก็บ IG คืนแล้ว"}
        </h2>
        <p className="m-0 mt-1 text-[13px] text-fg-muted">
          {row.customerName} · สัญญา {row.contractNo} · IG คงเหลือ <b className="tabular-nums text-fg">{row.remaining}</b> สถานี
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 px-4 py-3 max-[560px]:grid-cols-1">
        <div className="flex flex-col gap-1">
          <label htmlFor="cl-count" className={FIELD_LABEL}>
            จำนวน IG (สถานี)
          </label>
          <input
            id="cl-count"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            value={countText}
            disabled={busy || confirming}
            onChange={(e) => setCountText(e.target.value)}
            className={cx(FIELD_CONTROL, "tabular-nums")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cl-date" className={FIELD_LABEL}>
            {isSkip ? "วันที่เข้าไป (ลูกค้าไม่ให้เก็บ)" : "วันที่เก็บ"}
          </label>
          <input
            id="cl-date"
            type="date"
            value={date}
            min={minDate}
            max={today}
            disabled={busy || confirming}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD_CONTROL}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cl-team" className={FIELD_LABEL}>
            ทีมที่เข้า
          </label>
          <select
            id="cl-team"
            value={teamId}
            disabled={busy || confirming}
            onChange={(e) => setTeamId(e.target.value)}
            className={FIELD_CONTROL}
          >
            <option value="">— เลือกทีม —</option>
            {pickable.map((t) => (
              <option key={t.id} value={t.id}>
                ทีม {t.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isSkip ? (
        <div className="flex flex-col gap-1 px-4 pb-3">
          <label htmlFor="cl-reason" className={FIELD_LABEL}>
            เหตุผล (บังคับ)
          </label>
          <textarea
            id="cl-reason"
            rows={3}
            maxLength={REASON_MAX}
            value={reason}
            disabled={busy || confirming}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ลูกค้าไม่สะดวกให้เข้าพื้นที่ / ฝังใต้พื้นคอนกรีต"
            className={cx(FIELD_CONTROL, "resize-y")}
          />
          <span className="text-right text-[12px] tabular-nums text-fg-muted">
            {reason.length}/{REASON_MAX}
          </span>
        </div>
      ) : null}

      {shown ? (
        <p role="alert" className="m-0 mx-4 mb-3 rounded-lg border-l-4 border-l-danger bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {shown}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        {confirming ? (
          <>
            <span className="mr-auto text-[13px]">ไม่เก็บ IG {count} สถานีนี้อีก?</span>
            <Button className="max-[767px]:min-h-11" disabled={busy} onClick={() => setConfirming(false)}>
              กลับไปแก้
            </Button>
            <Button className="max-[767px]:min-h-11" variant="danger" loading={busy} onClick={submit}>
              ยืนยัน ไม่เก็บ
            </Button>
          </>
        ) : (
          <>
            <Button className="max-[767px]:min-h-11" disabled={busy} onClick={() => ref.current?.close()}>
              ยกเลิก
            </Button>
            <Button
              className="max-[767px]:min-h-11"
              variant="primary"
              loading={busy && !isSkip}
              onClick={() => {
                if (!check()) return;
                if (isSkip) setConfirming(true);
                else submit();
              }}
            >
              {isSkip ? "ไม่เก็บ" : "บันทึก เก็บแล้ว"}
            </Button>
          </>
        )}
      </div>
    </dialog>
  );
}

/** กล่องอ่านเหตุผลที่ไม่เก็บ (ปุ่ม "เหตุผล" ในแถว) */
export function ReasonDialog({ row, teamCode, onClose }: { row: CollectionRow; teamCode: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);
  const reasons = row.last?.reasons ?? [];
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      aria-labelledby="collect-reason-title"
      className="m-auto w-[min(480px,calc(100vw-24px))] rounded-xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow)] backdrop:bg-black/40"
    >
      <div className="px-4 py-4">
        <h2 id="collect-reason-title" className="m-0 text-base font-semibold">
          เหตุผลที่ลูกค้าไม่ให้เก็บ
        </h2>
        <p className="m-0 mt-1 text-[13px] text-fg-muted">
          {row.customerName} · สัญญา {row.contractNo}
          {teamCode ? ` · ทีม ${teamCode}` : ""}
        </p>
        {reasons.length ? (
          <ul className="m-0 mt-3 list-disc whitespace-pre-wrap pl-5 text-[14px]">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-3 text-[13px] text-fg-muted">ไม่มีเหตุผลบันทึกไว้</p>
        )}
      </div>
      <div className="flex justify-end border-t border-border px-4 py-3">
        <Button className="max-[767px]:min-h-11" variant="primary" onClick={() => ref.current?.close()}>
          ปิด
        </Button>
      </div>
    </dialog>
  );
}
