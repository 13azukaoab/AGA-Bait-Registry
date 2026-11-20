"use client";

/**
 * กล่องยืนยัน "ยกเลิกสัญญา" และ "เปิดสัญญากลับ" (DECISIONS 2.97 · M44)
 *
 * Logic summary:
 *   * ยกเลิก: เลือกประเภทเหตุผล (ลงข้อมูลผิด / ลูกค้ายกเลิกจริง / อื่นๆ) + พิมพ์เหตุผล (บังคับ ≤ 500) → ปุ่มแดงยืนยัน
 *     บอกผลที่ตามมา: มีผลวันที่กด (ไม่ย้อนวัน) · IG ที่ยังไม่เก็บขึ้น "รอเก็บสถานี" · "ลงข้อมูลผิด" ไม่นับในยอดขาย
 *   * เปิดกลับ: พิมพ์เหตุผล (บังคับ ≤ 500) · บอกผลที่ตามมา (เดือนช่วงที่ยกเลิกที่ไม่มีบริการจะขึ้นตกบริการ)
 *   * โฟกัสเริ่มที่ปุ่มปลอดภัย "ไม่ยกเลิก" / "ไม่เปิดกลับ" (กัน Enter พลาด) · Esc ปิดได้ (ไม่ได้ตอนกำลังบันทึก)
 *   * ล้มเหลว: แสดงข้อความไทยในกล่อง ไม่ปิด · ฐานข้อมูลบังคับสิทธิ์/เงื่อนไขจริง (ที่นี่แค่แปลผล)
 *   * ช่องกรอก 16px บนจอ ≤767px · ปุ่มสูง ≥44px บนมือถือ
 */
import { useEffect, useId, useRef, useState } from "react";

import { Dialog } from "@/components/todo/Dialog";
import { Button } from "@/components/ui";

import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_OPTIONS,
  validateCancelForm,
  validateReasonText,
  type CancelReasonCode,
} from "./cancelContract";

const INPUT_CLASS = "w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] text-fg max-md:text-base";
const SAFE_BTN = "max-md:min-h-11";

export function CancelContractDialog({
  contractNo,
  onClose,
  onSubmit,
}: {
  contractNo: string;
  onClose: () => void;
  /** คืนข้อความ error (null = สำเร็จ) */
  onSubmit: (reasonCode: CancelReasonCode, reason: string) => Promise<string | null>;
}) {
  const id = useId();
  const safeRef = useRef<HTMLButtonElement>(null);
  const [code, setCode] = useState<CancelReasonCode | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    safeRef.current?.focus();
  }, []);

  async function confirm() {
    const bad = validateCancelForm({ code, reason });
    if (bad) {
      setError(bad);
      return;
    }
    if (!code) return;
    setError(null);
    setBusy(true);
    const message = await onSubmit(code, reason);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <Dialog titleId={`${id}-t`} onClose={onClose} busy={busy}>
      <div className="grid gap-3 p-4">
        <h2 id={`${id}-t`} className="m-0 text-[16px] font-semibold">
          ยกเลิกสัญญา {contractNo}
        </h2>
        <ul className="m-0 list-disc pl-5 text-[12.5px] text-fg-muted">
          <li>มีผลตั้งแต่วันที่กดยืนยัน (ไม่ย้อนวัน) — ถ้าลูกค้าแจ้งช้า ให้เขียนวันที่จริงในเหตุผล</li>
          <li>สถานีไม่ถูกแตะ IG ที่ยังไม่เก็บจะขึ้น “รอเก็บสถานี”</li>
          <li>สัญญาที่ยกเลิกจะไม่ขึ้นตกบริการตั้งแต่เดือนที่ยกเลิก · เปิดกลับได้ภายหลัง (ถ้ายังไม่เก็บ IG)</li>
        </ul>

        <fieldset className="m-0 grid gap-1.5 border-0 p-0" disabled={busy}>
          <legend className="mb-1 p-0 text-[13px] font-semibold">เหตุผลที่ยกเลิก (เลือก 1 ข้อ)</legend>
          {CANCEL_REASON_OPTIONS.map((o) => (
            <label
              key={o.code}
              className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-border px-2.5 py-2 text-[13px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
            >
              <input type="radio" name={`${id}-code`} value={o.code} checked={code === o.code} onChange={() => setCode(o.code)} className="mt-0.5 size-4 flex-none" />
              <span>
                <b>{o.label}</b>
                <span className="block text-xs text-fg-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="grid gap-1 text-[13px]">
          <span className="font-semibold">อธิบายเหตุผล (บังคับ)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={CANCEL_REASON_MAX + 200}
            disabled={busy}
            aria-invalid={error !== null && validateReasonText(reason) !== null}
            className={INPUT_CLASS}
          />
          <span className={`text-xs ${reason.trim().length > CANCEL_REASON_MAX ? "text-danger" : "text-fg-muted"}`}>
            {reason.trim().length} / {CANCEL_REASON_MAX} ตัวอักษร
          </span>
        </label>

        {error ? (
          <p role="alert" className="m-0 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={safeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className={`${SAFE_BTN} rounded-md border border-border-strong bg-surface px-3.5 py-2 text-[13px] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent`}
          >
            ไม่ยกเลิก
          </button>
          <Button variant="danger" className={SAFE_BTN} onClick={confirm} loading={busy}>
            ยืนยันยกเลิกสัญญา
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function ReopenContractDialog({
  contractNo,
  onClose,
  onSubmit,
}: {
  contractNo: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<string | null>;
}) {
  const id = useId();
  const safeRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    safeRef.current?.focus();
  }, []);

  async function confirm() {
    const bad = validateReasonText(reason, "ที่เปิดสัญญากลับ");
    if (bad) {
      setError(bad);
      return;
    }
    setError(null);
    setBusy(true);
    const message = await onSubmit(reason);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <Dialog titleId={`${id}-t`} onClose={onClose} busy={busy}>
      <div className="grid gap-3 p-4">
        <h2 id={`${id}-t`} className="m-0 text-[16px] font-semibold">
          เปิดสัญญา {contractNo} กลับ
        </h2>
        <ul className="m-0 list-disc pl-5 text-[12.5px] text-fg-muted">
          <li>สัญญากลับมาใช้งานเหมือนเดิม สถานีอยู่ครบ · เดือนช่วงที่ยกเลิกที่ไม่มีบริการจะขึ้น “ตกบริการ” ให้ตัดสินชดเชย/ไม่ชดเชย</li>
          <li>เปิดกลับไม่ได้ถ้ามี IG ที่บันทึกเก็บคืน / ไม่เก็บ ไปแล้ว หรือสัญญาเก่ามีสัญญาต่อ (Renew) ตัวอื่นแล้ว</li>
          <li>ตัวเลขที่ส่ง Dashboard ของเดือนที่ปิดแล้วคงเดิมจนกว่าจะสั่งคำนวณใหม่</li>
        </ul>
        <label className="grid gap-1 text-[13px]">
          <span className="font-semibold">เหตุผลที่เปิดกลับ (บังคับ)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={CANCEL_REASON_MAX + 200}
            disabled={busy}
            className={INPUT_CLASS}
          />
          <span className={`text-xs ${reason.trim().length > CANCEL_REASON_MAX ? "text-danger" : "text-fg-muted"}`}>
            {reason.trim().length} / {CANCEL_REASON_MAX} ตัวอักษร
          </span>
        </label>
        {error ? (
          <p role="alert" className="m-0 rounded-md border border-danger bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={safeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className={`${SAFE_BTN} rounded-md border border-border-strong bg-surface px-3.5 py-2 text-[13px] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent`}
          >
            ไม่เปิดกลับ
          </button>
          <Button variant="primary" className={SAFE_BTN} onClick={confirm} loading={busy}>
            ยืนยันเปิดสัญญากลับ
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
