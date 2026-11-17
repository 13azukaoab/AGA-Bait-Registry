"use client";

/**
 * WaiveDialog — "ไม่ชดเชย" เดือนที่ตกบริการ (2 ขั้น: กรอกเหตุผล/หลักฐาน → ยืนยันอีกครั้งด้วยปุ่มแดง)
 *
 * Logic summary:
 *   * เหตุผลบังคับ ≤ 300 ตัวอักษร · หลักฐาน (PDF/PNG/JPG ≤ 5 MB) ไม่บังคับ — ตรวจที่ logic.ts
 *   * บันทึกผ่าน RPC resolve_missed_service (rpc.ts) · สำเร็จ → onDone() · ล้มเหลว → แสดงข้อความไทยในกล่อง ไม่ปิด
 *   * ฐานข้อมูลบังคับสิทธิ์/เงื่อนไขจริง (หัวหน้างานในขอบเขต · Host) — ที่นี่แค่แปลผล
 */
import { useId, useState } from "react";

import { Button } from "@/components/ui";

import { REASON_MAX, validateEvidenceFile, validateReason, type PendingMissed } from "./logic";
import { Dialog } from "./Dialog";

const INPUT_CLASS =
  "w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] text-fg max-md:text-base";

export function WaiveDialog({
  item,
  monthText,
  onClose,
  onSubmit,
}: {
  item: PendingMissed;
  /** ข้อความเดือนที่ตก เช่น "พฤษภาคม 2026" */
  monthText: string;
  onClose: () => void;
  onSubmit: (reason: string, file: File | null) => Promise<string | null>;
}) {
  const id = useId();
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function next() {
    const bad = validateReason(reason) ?? (file ? validateEvidenceFile(file) : null);
    if (bad) {
      setError(bad);
      return;
    }
    setError(null);
    setStep("confirm");
  }

  async function confirm() {
    setBusy(true);
    const message = await onSubmit(reason, file);
    setBusy(false);
    if (message) {
      setError(message);
      setStep("form");
    }
  }

  return (
    <Dialog titleId={`${id}-t`} onClose={onClose} busy={busy}>
      <div className="px-4 py-3">
        <h2 id={`${id}-t`} className="m-0 text-base font-semibold">
          ไม่ชดเชย {monthText}
        </h2>
        <p className="m-0 mt-1 text-xs text-fg-muted">
          {item.customerName} · สัญญา {item.contractNo} · เดือนนี้ยังนับเป็นตกบริการในประวัติ แต่ปิดเรื่องไม่ต้องตามต่อ
        </p>

        <div className="mt-3">
          <label htmlFor={`${id}-r`} className="mb-1 block text-xs font-semibold text-fg-muted">
            เหตุผล (บังคับ)
          </label>
          <textarea
            id={`${id}-r`}
            value={reason}
            maxLength={REASON_MAX}
            rows={3}
            disabled={step === "confirm" || busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ลูกค้ายินยอม ปิดอาคารทั้งเดือน"
            className={INPUT_CLASS}
          />
        </div>
        <div className="mt-3">
          <label htmlFor={`${id}-f`} className="mb-1 block text-xs font-semibold text-fg-muted">
            หลักฐาน (ไม่บังคับ · PDF / PNG / JPG ไม่เกิน 5 MB)
          </label>
          <input
            id={`${id}-f`}
            type="file"
            accept=".pdf,image/png,image/jpeg"
            disabled={step === "confirm" || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={INPUT_CLASS}
          />
        </div>
        {error ? (
          <p role="alert" className="m-0 mt-3 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        {step === "form" ? (
          <>
            <Button className="max-md:min-h-11" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button variant="primary" className="max-md:min-h-11" onClick={next}>
              ไม่ชดเชย
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto text-[13px] text-fg-muted">ปิดเรื่องเดือนนี้โดยไม่ชดเชย?</span>
            <Button className="max-md:min-h-11" disabled={busy} onClick={() => setStep("form")}>
              กลับไปแก้
            </Button>
            <Button variant="danger" className="max-md:min-h-11" loading={busy} onClick={confirm}>
              ยืนยัน ไม่ชดเชย
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
