"use client";

/**
 * FileDialog — กล่องจัดการไฟล์แนบของ 1 สัญญา
 *
 * 2 โหมด:
 *   * "draft" (แถวยังไม่บันทึก): เลือก PDF สัญญาไว้ก่อน (เก็บในหน่วยความจำ) อัปโหลดหลังบันทึกแถว
 *   * "saved" (บันทึกแล้ว): PDF สัญญา (แนบ/เปลี่ยน/ลบ/เปิดดู) + Site plan หลายเวอร์ชัน
 *     (ต้องกรอกเหตุผลก่อนเลือกไฟล์ · ต้องมี PDF สัญญาก่อน · เก็บทุกเวอร์ชัน)
 *
 * กฎไฟล์: PDF สัญญารับ PDF อย่างเดียว · Site plan รับ PDF/PNG/JPG · ≤5 MB รับเลย ·
 *   5–10 MB บีบก่อน · >10 MB ปฏิเสธ (fileRules.ts) · สิทธิ์ตัดสินที่ RLS ของ DB/Storage
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";

import { Alert, Button } from "@/components/ui";

import { fetchContractFiles } from "./data";
import {
  addSitePlan,
  deleteContractFile,
  openFile,
  prepareFile,
  putContractPdf,
} from "./files";
import { MB } from "./fileRules";
import { Modal } from "./Modal";
import type { ContractFileRow, PendingFile } from "./types";

type Props = {
  supabase: SupabaseClient;
  title: string;
  subtitle: string;
  onClose: () => void;
} & (
  | {
      mode: "draft";
      pending: PendingFile | null;
      onPick: (file: PendingFile | null) => void;
    }
  | {
      mode: "saved";
      contractId: string;
      files: ContractFileRow[];
      /** เรียกหลังไฟล์เปลี่ยน เพื่อให้หน้าโหลดข้อมูลใหม่ */
      onChanged: () => void;
    }
);

const sizeText = (bytes: number) => `${(bytes / MB).toFixed(2)} MB`;
const dateText = (iso: string) => iso.slice(0, 10);

export function FileDialog(props: Props) {
  const { supabase, title, subtitle, onClose } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<ContractFileRow[]>(
    props.mode === "saved" ? props.files : [],
  );

  const pdf = files.find((f) => f.kind === "contract_pdf") ?? null;
  const sitePlans = files.filter((f) => f.kind === "site_plan");

  async function refresh(contractId: string) {
    const res = await fetchContractFiles(supabase, contractId);
    if (!res.error) setFiles(res.files);
    if (props.mode === "saved") props.onChanged();
  }

  /** รันงานไฟล์พร้อมสถานะ busy/error รวมที่เดียว */
  async function run(job: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    setError(null);
    setInfo(null);
    const res = await job();
    setBusy(false);
    if (!res.ok) setError(res.error ?? "ทำรายการไม่สำเร็จ");
    else setInfo(done);
    return res.ok;
  }

  async function pickPdf(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const prep = await prepareFile("contract_pdf", file);
    if (!prep.ok) {
      setBusy(false);
      setError(prep.error);
      return;
    }
    if (props.mode === "draft") {
      setBusy(false);
      props.onPick(prep.pending);
      setInfo(
        prep.pending.wasCompressed
          ? "บีบไฟล์แล้ว จะอัปโหลดตอนกด บันทึกเข้าทะเบียน"
          : "เลือกไฟล์แล้ว จะอัปโหลดตอนกด บันทึกเข้าทะเบียน",
      );
      return;
    }
    const contractId = props.contractId;
    const ok = await run(
      () =>
        putContractPdf(
          supabase,
          contractId,
          prep.pending,
          pdf ? { id: pdf.id, storagePath: pdf.storagePath } : null,
        ),
      pdf ? "เปลี่ยนไฟล์สัญญาแล้ว" : "แนบไฟล์สัญญาแล้ว",
    );
    if (ok) await refresh(contractId);
  }

  async function pickSitePlan(file: File | undefined) {
    if (!file || props.mode !== "saved") return;
    const contractId = props.contractId;
    setBusy(true);
    setError(null);
    setInfo(null);
    const prep = await prepareFile("site_plan", file);
    if (!prep.ok) {
      setBusy(false);
      setError(prep.error);
      return;
    }
    const ok = await run(
      () => addSitePlan(supabase, contractId, reason, prep.pending),
      "เพิ่ม Site plan เวอร์ชันใหม่แล้ว",
    );
    if (ok) {
      setReason("");
      await refresh(contractId);
    }
  }

  async function remove(file: ContractFileRow) {
    if (props.mode !== "saved") return;
    const label = file.kind === "contract_pdf" ? "ไฟล์สัญญา" : `Site plan v${file.version}`;
    if (!window.confirm(`ลบ${label} (${file.fileName}) ?\nลบแล้วเอากลับคืนไม่ได้`)) return;
    const contractId = props.contractId;
    const ok = await run(() => deleteContractFile(supabase, file), `ลบ${label}แล้ว`);
    if (ok) await refresh(contractId);
  }

  async function view(file: ContractFileRow) {
    const res = await openFile(supabase, file.storagePath);
    if (!res.ok) setError(res.error);
  }

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <div className="flex flex-col gap-4 text-[13px]">
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {info ? <Alert variant="ok">{info}</Alert> : null}

        <section aria-labelledby="fd-pdf" className="flex flex-col gap-2">
          <h3 id="fd-pdf" className="m-0 text-[13px] font-semibold">
            PDF สัญญา + Site plan <span className="font-normal text-fg-muted">(ไฟล์เดียว · PDF เท่านั้น)</span>
          </h3>

          {props.mode === "draft" ? (
            props.pending ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="num">
                  {props.pending.file.name} · {sizeText(props.pending.file.size)}
                  {props.pending.wasCompressed ? " · บีบแล้ว" : ""}
                </span>
                <Button size="sm" variant="danger" onClick={() => props.onPick(null)}>
                  เอาออก
                </Button>
              </div>
            ) : (
              <p className="m-0 text-fg-muted">ยังไม่ได้เลือกไฟล์ — แนบทีหลังได้ ไม่บล็อกการบันทึกแถว</p>
            )
          ) : pdf ? (
            <FileLine file={pdf} onView={view} onRemove={remove} busy={busy} />
          ) : (
            <p className="m-0 text-fg-muted">ยังไม่ได้แนบไฟล์สัญญา</p>
          )}

          <label className="inline-flex w-fit cursor-pointer items-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[12.5px] hover:bg-surface-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
            {props.mode === "draft"
              ? props.pending
                ? "เลือกไฟล์ใหม่"
                : "เลือกไฟล์ PDF"
              : pdf
                ? "เปลี่ยนไฟล์ PDF"
                : "เลือกไฟล์ PDF"}
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                void pickPdf(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <p className="m-0 text-[11.5px] text-fg-muted">
            ไม่เกิน 5 MB รับเลย · 5–10 MB ระบบบีบให้ · เกิน 10 MB ไม่รับ
          </p>
        </section>

        {props.mode === "saved" ? (
          <section aria-labelledby="fd-sp" className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 id="fd-sp" className="m-0 text-[13px] font-semibold">
              อัปเดต Site plan <span className="font-normal text-fg-muted">(แก้ตอนติดตั้ง · เก็บทุกเวอร์ชัน)</span>
            </h3>

            {sitePlans.length === 0 ? (
              <p className="m-0 text-fg-muted">ยังไม่มีการอัปเดต Site plan</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {sitePlans.map((f) => (
                  <li key={f.id} className="rounded-lg border border-border px-3 py-2">
                    <FileLine file={f} onView={view} onRemove={remove} busy={busy} />
                  </li>
                ))}
              </ul>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-fg-muted">เหตุผลที่แก้ Site plan (จำเป็น)</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={120}
                placeholder="เช่น แก้ตอนติดตั้ง — เพิ่มจุด AG หน้าโถง"
                disabled={!pdf || busy}
                className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            <label className="inline-flex w-fit cursor-pointer items-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[12.5px] hover:bg-surface-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
              เลือกไฟล์ Site plan (PDF / PNG / JPG)
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="sr-only"
                disabled={!pdf || busy || reason.trim() === ""}
                onChange={(e) => {
                  void pickSitePlan(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {!pdf ? (
              <p className="m-0 text-[11.5px] text-fg-muted">ต้องแนบ PDF สัญญาก่อน จึงจะอัปเดต Site plan ได้</p>
            ) : reason.trim() === "" ? (
              <p className="m-0 text-[11.5px] text-fg-muted">กรอกเหตุผลก่อน จึงจะเลือกไฟล์ได้</p>
            ) : null}
          </section>
        ) : null}

        {busy ? (
          <p role="status" className="m-0 text-fg-muted">
            กำลังดำเนินการ…
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function FileLine({
  file,
  onView,
  onRemove,
  busy,
}: {
  file: ContractFileRow;
  onView: (f: ContractFileRow) => void;
  onRemove: (f: ContractFileRow) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {file.kind === "site_plan" ? (
          <span className="font-semibold">
            v{file.version}
            {file.isCurrent ? " (ปัจจุบัน)" : ""}
          </span>
        ) : null}
        <span className="num min-w-0 break-all">{file.fileName}</span>
        <span className="num text-fg-muted">
          {sizeText(file.sizeBytes)}
          {file.wasCompressed ? " · บีบแล้ว" : ""} · {dateText(file.uploadedAt)}
        </span>
        <span className="flex-1" />
        <Button size="sm" onClick={() => onView(file)} disabled={busy}>
          เปิดดู
        </Button>
        <Button size="sm" variant="danger" onClick={() => onRemove(file)} disabled={busy}>
          ลบ
        </Button>
      </div>
      {file.reason ? <p className="m-0 text-[12px] text-fg-muted">เหตุผล: {file.reason}</p> : null}
    </div>
  );
}
