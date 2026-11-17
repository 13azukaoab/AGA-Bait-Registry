"use client";

/**
 * แท็บ "ไฟล์แนบ" — ดู/ดาวน์โหลดไฟล์สัญญา + Site plan ทุกเวอร์ชัน (หน้านี้ดูอย่างเดียว)
 *
 * Logic summary:
 *   * ไฟล์อยู่ใน bucket private `contract-files` — สร้าง signed URL อายุสั้น "ตอนกด" เท่านั้น (ไม่ออกลิงก์ล่วงหน้า · ไม่มีลิงก์สาธารณะ PDPA)
 *   * ไฟล์แรก = PDF เดียว "สัญญา + Site plan" · "อัปเดต Site plan" = เวอร์ชันใหม่พร้อมเหตุผล เก็บทุกเวอร์ชัน
 *   * แนบ/อัปเดตทำที่หน้าเปิดงานที่เดียว: ปุ่มลิงก์ไปหน้านั้น (host/admin) · สัญญาปิดแล้วล็อกทุกคน · ยกเลิก = host เท่านั้น (canAttachContract)
 *   * ชื่อไฟล์/เหตุผลอยู่ใน data-clarity-mask (M36)
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, TierBadge } from "@/components/ui";
import { CONTRACT_FILES_BUCKET, openFile } from "@/components/customers-new/files";
import { createClient } from "@/lib/supabase/client";

import { bangkokDate, canAttachContract, CONTRACT_STATUS_LABEL, customerPermissions, filesOfContract, fmtDate, fmtSizeMb, sortContracts } from "../logic";
import { Hint, Tag } from "../parts";
import type { CustomerDetailData, FileRow } from "../types";

export function FilesTab({ data, onToast }: { data: CustomerDetailData; onToast: (msg: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const perm = customerPermissions(data.role);

  async function view(f: FileRow) {
    setBusy(f.id);
    const r = await openFile(supabase, f.storagePath);
    setBusy(null);
    if (!r.ok) onToast(r.error);
  }

  async function download(f: FileRow) {
    setBusy(f.id);
    const { data: d, error } = await supabase.storage.from(CONTRACT_FILES_BUCKET).createSignedUrl(f.storagePath, 60, { download: f.fileName });
    setBusy(null);
    if (error || !d?.signedUrl) return onToast("ดาวน์โหลดไม่ได้ (ไฟล์อาจถูกลบ หรือไม่มีสิทธิ์ดู)");
    const a = document.createElement("a");
    a.href = d.signedUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const acts = (f: FileRow) => (
    <span className="flex flex-none gap-2">
      <Button size="sm" className="max-md:min-h-11" loading={busy === f.id} onClick={() => void view(f)}>
        ดู
      </Button>
      <Button size="sm" className="max-md:min-h-11" disabled={busy === f.id} onClick={() => void download(f)}>
        ดาวน์โหลด
      </Button>
    </span>
  );

  return (
    <div>
      <Hint>
        ไฟล์เปิดผ่านลิงก์ชั่วคราว ไม่มีลิงก์สาธารณะ (PDPA) · หน้านี้<b>ดู/ดาวน์โหลดอย่างเดียว</b> — แนบ “สัญญา + Site plan” (PDF ไฟล์เดียว) และอัปเดต Site plan ที่<b>หน้าเปิดงาน</b>
        {perm.edit ? " (กดปุ่มในแต่ละสัญญา)" : ""}
      </Hint>
      <div className="grid gap-3">
        {sortContracts(data.contracts).map((k) => {
          const { pdf, sitePlans } = filesOfContract(data.files, k.id);
          const locked = !canAttachContract(data.role, k.status);
          const lockMsg = k.status === "closed" ? "สัญญาปิดแล้ว — ไฟล์ล็อกทุกคน (เปิดดูได้)" : "สัญญายกเลิก — แนบ/อัปเดตไฟล์ได้เฉพาะ host";
          const s = CONTRACT_STATUS_LABEL[k.status];
          return (
            <section key={k.id} className="rounded-xl border border-border bg-surface p-3.5" aria-label={`ไฟล์ของสัญญา ${k.no}`}>
              <h4 className="m-0 mb-3 flex flex-wrap items-center gap-2 text-[14px]">
                <span className="font-mono">{k.no}</span>
                <TierBadge tier={k.tier} termMonths={k.termMonths} />
                <Tag tone={s.tone}>{s.text}</Tag>
                {perm.edit || k.status === "closed" ? (
                  <span className="ml-auto">
                    {locked ? (
                      <span className="text-xs font-normal text-fg-muted">{lockMsg}</span>
                    ) : (
                      <Link
                        href={`/customers/new?month=${k.startDate.slice(0, 7)}`}
                        className="inline-flex items-center rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-normal text-fg no-underline hover:bg-surface-2 max-md:min-h-11 md:min-h-8"
                        title="ไปหน้าเปิดงานเพื่อแนบไฟล์ / อัปเดต Site plan"
                      >
                        แนบ / อัปเดตที่หน้าเปิดงาน
                      </Link>
                    )}
                  </span>
                ) : null}
              </h4>
              <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
                <div aria-hidden="true" className="flex size-10 flex-none items-center justify-center rounded-lg bg-danger-soft text-xs font-bold text-danger">
                  PDF
                </div>
                <div className="min-w-0 flex-1 text-[13px]" data-clarity-mask="True">
                  <b>สัญญา + Site plan (PDF ไฟล์เดียว)</b>
                  <span className="block break-all text-xs text-fg-muted">
                    {pdf ? `${pdf.fileName} · ${fmtSizeMb(pdf.sizeBytes)} · แนบ ${fmtDate(bangkokDate(pdf.uploadedAt))}${pdf.uploadedByName ? ` โดย ${pdf.uploadedByName}` : ""}` : "admin ยังไม่ได้แนบตอนเปิดงาน"}
                  </span>
                </div>
                {pdf ? acts(pdf) : <Tag tone="pend">ยังไม่แนบไฟล์</Tag>}
              </div>
              <div className="pt-3">
                <div className="mb-2 text-xs font-semibold text-fg-muted">อัปเดต Site plan ({sitePlans.length} ครั้ง)</div>
                {sitePlans.length === 0 ? (
                  <p className="m-0 text-xs text-fg-muted">ยังไม่มีการอัปเดต — Site plan ต้นฉบับอยู่ในไฟล์สัญญาด้านบนแล้ว</p>
                ) : (
                  [...sitePlans].reverse().map((v, i) => (
                    <div key={v.id} className="flex flex-wrap items-center gap-3 border-b border-border py-2 last:border-b-0">
                      <span className="flex size-8 flex-none items-center justify-center rounded-md bg-surface-3 text-xs font-bold">v{v.version}</span>
                      <div className="min-w-0 flex-1 text-[13px]" data-clarity-mask="True">
                        <b className="break-all">{v.fileName}</b> {i === 0 ? <Tag tone="info">ล่าสุด</Tag> : null}
                        <span className="block text-xs text-fg-muted">
                          {fmtDate(bangkokDate(v.uploadedAt))}
                          {v.uploadedByName ? ` · ${v.uploadedByName}` : ""}
                          {v.reason ? ` · ${v.reason}` : ""}
                        </span>
                      </div>
                      {acts(v)}
                    </div>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
