"use client";

/**
 * InfoPanel — แผง "ข้อมูลลูกค้า" ซ้ายมือ + แก้ข้อมูลติดต่อทีละแถว (ผู้ติดต่อ · เบอร์โทรหลายเบอร์ · หมายเหตุ)
 *
 * Logic summary:
 *   * สิทธิ์แก้ = host · admin · หัวหน้างาน (customerPermissions.editContact) — ด่านจริงคือ RPC `save_customer_contact` (ทุก role ผ่าน RPC)
 *   * แก้ทีละช่อง: กดดินสอแถวไหน แถวนั้นเป็นช่องพิมพ์ในที่เดิม · Enter บันทึก (หมายเหตุใช้ Ctrl+Enter) · Esc ยกเลิก
 *   * ส่งเฉพาะช่องที่เปลี่ยน (buildContactPayload) — ไม่เปลี่ยน = ไม่เรียก RPC แจ้ง "ไม่มีการเปลี่ยนแปลง"
 *   * หัวหน้างานแก้ลูกค้าทีมอื่น: ถามยืนยัน 1 ครั้งต่อลูกค้า (customer_contact_is_cross_team ก่อนเปิดช่องแก้ · CC001 เป็นด่านสำรองตอนบันทึก)
 *   * ลบเบอร์: ยืนยันก่อน (ปุ่มเริ่มต้น = ไม่ลบ) · ลบเบอร์สุดท้ายไม่ได้ (CC004)
 *   * ลูกค้าที่ยังไม่มีเบอร์ในตารางใหม่ แต่มีเบอร์เดิม (customers.phone) → แสดงเบอร์เดิมแบบอ่านอย่างเดียว (รอ M19c ย้ายข้อมูล)
 *   * ข้อมูลทั้งแผงอยู่ใน data-clarity-mask (M36) · ไม่ log ค่าที่พิมพ์
 */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/service/ConfirmDialog";
import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { Button, Toast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

import { checkCrossTeam, saveCustomerContact } from "./contactRpc";
import {
  bangkokDate,
  buildContactPayload,
  buildPhoneDeletePayload,
  customerPermissions,
  fmtDate,
  latestVisit,
  sortPhones,
  validateContactName,
  validateNote,
  validatePhone,
  CONTACT_NAME_MAX,
  NOTE_MAX,
  PHONE_LABEL_MAX,
  type ContactEdit,
} from "./logic";
import { Icon } from "./parts";
import type { CustomerDetailData } from "./types";
import { isContactDraftDirty } from "./unsavedContact";

type EditKey = { kind: "contact" } | { kind: "note" } | { kind: "phone"; id: string | null };
type Pending = { type: "edit"; key: EditKey } | { type: "delete"; phoneId: string } | { type: "save"; edit: ContactEdit };

const sameKey = (a: EditKey | null, b: EditKey): boolean =>
  !!a && a.kind === b.kind && (a.kind !== "phone" || (b.kind === "phone" && a.id === b.id));

const INPUT = "w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg max-md:min-h-11 max-md:text-base";
const ICON_BTN =
  "inline-flex size-8 flex-none items-center justify-center rounded-md border border-transparent text-fg-muted hover:border-border-strong hover:bg-surface-2 hover:text-fg max-md:size-11";

export function InfoPanel({ data }: { data: CustomerDetailData }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const perm = customerPermissions(data.role);
  const c = data.customer;
  const phones = sortPhones(data.phones);

  const [edit, setEdit] = useState<EditKey | null>(null);
  const [draft, setDraft] = useState({ value: "", phone: "", label: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [xteamOk, setXteamOk] = useState(false);
  const [ask, setAsk] = useState<{ pending: Pending; teams: string[] } | null>(null);
  const [delPhone, setDelPhone] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const lastVisit = latestVisit(data.visits);

  /**
   * สถานะ "มีการแก้ที่ยังไม่บันทึก" — จุดเดียวของหน้านี้ (M34): ช่องที่เปิดแก้อยู่และค่าที่พิมพ์ต่างจากค่าเดิม
   * ส่งเข้า `useUnsavedWork` ด้านล่าง → แถบแจ้งเวอร์ชันใหม่จะไม่รีโหลดทับของที่พิมพ์ค้าง (ห้ามสร้าง hook ซ้ำ)
   */
  const original =
    edit?.kind === "contact"
      ? { value: c.contactName ?? "", phone: "", label: "" }
      : edit?.kind === "note"
        ? { value: c.note ?? "", phone: "", label: "" }
        : edit?.kind === "phone"
          ? { value: "", phone: phones.find((x) => x.id === edit.id)?.phone ?? "", label: phones.find((x) => x.id === edit.id)?.label ?? "" }
          : null;
  const hasUnsavedChanges = isContactDraftDirty(original, draft);
  useUnsavedWork(hasUnsavedChanges);

  /** เปิดช่องแก้จริง (หลังผ่านด่านข้ามทีมแล้ว) */
  function openEditor(key: EditKey) {
    setDelPhone(null);
    setError(null);
    if (key.kind === "contact") setDraft({ value: c.contactName ?? "", phone: "", label: "" });
    else if (key.kind === "note") setDraft({ value: c.note ?? "", phone: "", label: "" });
    else {
      const p = phones.find((x) => x.id === key.id);
      setDraft({ value: "", phone: p?.phone ?? "", label: p?.label ?? "" });
    }
    setEdit(key);
  }

  /** ด่านข้ามทีมก่อนเริ่มแก้/ลบ — หัวหน้างานเท่านั้น · ถามครั้งเดียวต่อลูกค้า */
  async function gate(pending: Pending): Promise<void> {
    if (data.role === "recorder" && !xteamOk) {
      const cross = await checkCrossTeam(supabase, c.id);
      if (cross === true) {
        setAsk({ pending, teams: [...new Set(data.contracts.flatMap((k) => k.teamCodes))] });
        return;
      }
    }
    run(pending);
  }

  function run(p: Pending, confirmed = xteamOk) {
    if (p.type === "edit") openEditor(p.key);
    else if (p.type === "delete") {
      setEdit(null);
      setDelPhone(p.phoneId);
    } else void doSave(p.edit, confirmed);
  }

  async function doSave(e: ContactEdit, confirmed: boolean) {
    const payload = buildContactPayload(c.id, e, { contactName: c.contactName, note: c.note, phones }, confirmed);
    if (!payload) {
      setEdit(null);
      setToast("ไม่มีการเปลี่ยนแปลง");
      return;
    }
    setBusy(true);
    const r = await saveCustomerContact(supabase, payload);
    setBusy(false);
    if (!r.ok) {
      if (r.error.needsCrossTeamConfirm) {
        setAsk({ pending: { type: "save", edit: e }, teams: r.error.teamCodes });
        return;
      }
      setError(r.error.message);
      return;
    }
    setEdit(null);
    setToast(e.field === "phone" && !e.id ? "เพิ่มเบอร์แล้ว (ลงประวัติการแก้ไข)" : "บันทึกแล้ว (ลงประวัติการแก้ไข)");
    router.refresh();
  }

  function submit() {
    if (!edit) return;
    let e: ContactEdit;
    if (edit.kind === "contact") {
      const bad = validateContactName(draft.value);
      if (bad) return setError(bad);
      e = { field: "contact", value: draft.value };
    } else if (edit.kind === "note") {
      const bad = validateNote(draft.value);
      if (bad) return setError(bad);
      e = { field: "note", value: draft.value };
    } else {
      const bad = validatePhone(draft.phone, draft.label, phones, edit.id);
      if (bad) return setError(bad);
      e = { field: "phone", id: edit.id, phone: draft.phone, label: draft.label };
    }
    setError(null);
    void doSave(e, xteamOk);
  }

  async function confirmDelete(phoneId: string) {
    setBusy(true);
    const r = await saveCustomerContact(supabase, buildPhoneDeletePayload(c.id, phoneId, xteamOk));
    setBusy(false);
    setDelPhone(null);
    if (!r.ok) {
      if (r.error.needsCrossTeamConfirm) {
        setAsk({ pending: { type: "delete", phoneId }, teams: r.error.teamCodes });
        return;
      }
      setToast(r.error.message);
      return;
    }
    setToast("ลบเบอร์แล้ว (ลงประวัติการแก้ไข)");
    router.refresh();
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setEdit(null);
    } else if (e.key === "Enter" && ((e.target as HTMLElement).tagName === "INPUT" || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  const editorButtons = (
    <span className="flex flex-none gap-1">
      <button type="button" className={`${ICON_BTN} text-ok`} onClick={submit} disabled={busy} aria-label="บันทึก" title="บันทึก (Enter)">
        <Icon name="check" />
      </button>
      <button type="button" className={ICON_BTN} onClick={() => setEdit(null)} disabled={busy} aria-label="ยกเลิก" title="ยกเลิก (Esc)">
        <Icon name="x" />
      </button>
    </span>
  );

  const pen = (key: EditKey, label: string) =>
    perm.editContact ? (
      <button type="button" className={ICON_BTN} onClick={() => void gate({ type: "edit", key })} aria-label={`แก้${label}`} title={`แก้${label} — ลูกค้าเปลี่ยนผู้ดูแลระหว่างทำบริการได้`}>
        <Icon name="pencil" />
      </button>
    ) : null;

  const errNode = error ? (
    <p role="alert" className="m-0 mt-1 text-xs text-danger">
      {error}
    </p>
  ) : null;

  const row = (label: string, body: React.ReactNode) => (
    <div className="grid grid-cols-[96px_1fr] gap-x-2 border-b border-border py-2 text-[13px] last:border-b-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{body}</dd>
    </div>
  );

  return (
    <aside aria-label="ข้อมูลลูกค้า" className="rounded-xl border border-border bg-surface lg:sticky lg:top-3 lg:self-start" data-clarity-mask="True" data-unsaved={hasUnsavedChanges ? "true" : undefined}>
      <h2 className="m-0 flex items-center gap-2 border-b border-border px-3.5 py-3 text-[15px] font-semibold">
        ข้อมูลลูกค้า
        <span title="ข้อมูลส่วนบุคคล — viewer อ่านไม่ได้ (PDPA)" className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-normal text-fg-muted">
          <Icon name="lock" className="size-3.5" />
          PDPA
        </span>
      </h2>
      <dl className="m-0 px-3.5 py-1" onKeyDown={onKey}>
        {row("สาขา", `${c.branchName} · ${c.zoneName}`)}
        {row(
          "ทีมที่เข้าล่าสุด",
          lastVisit ? (
            <>
              {lastVisit.teamCodes.join(", ") || "—"} <span className="text-xs text-fg-muted">· {fmtDate(lastVisit.date)}</span>
            </>
          ) : (
            <span className="text-xs text-fg-muted">ยังไม่เคยเข้า</span>
          ),
        )}
        {row("ประเภท", c.customerTypeLabel ?? "—")}

        {row(
          "ผู้ติดต่อ",
          sameKey(edit, { kind: "contact" }) ? (
            <>
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  className={INPUT}
                  value={draft.value}
                  maxLength={CONTACT_NAME_MAX}
                  autoComplete="off"
                  aria-label="ผู้ติดต่อ"
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                />
                {editorButtons}
              </div>
              {errNode}
            </>
          ) : (
            <span className="flex items-start justify-between gap-1">
              <span>{c.contactName || <span className="text-fg-muted">—</span>}</span>
              {pen({ kind: "contact" }, "ผู้ติดต่อ")}
            </span>
          ),
        )}

        {row(
          "โทร",
          <div className="grid gap-1">
            {phones.map((p) =>
              sameKey(edit, { kind: "phone", id: p.id }) ? (
                <PhoneEditor key={p.id} draft={draft} setDraft={setDraft} buttons={editorButtons} error={errNode} />
              ) : delPhone === p.id ? (
                <div key={p.id} role="alertdialog" aria-label={`ยืนยันการลบเบอร์ ${p.phone}`} className="rounded-md border border-danger bg-danger-soft p-2 text-[13px]">
                  <p className="m-0 mb-2">
                    ลบเบอร์ <b>{p.phone}</b>
                    {p.label ? <span className="text-xs text-fg-muted"> ({p.label})</span> : null} ?
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" className="max-md:min-h-11" autoFocus onClick={() => setDelPhone(null)} disabled={busy}>
                      ไม่ลบ
                    </Button>
                    <Button size="sm" variant="danger" className="max-md:min-h-11" loading={busy} onClick={() => void confirmDelete(p.id)}>
                      ลบเบอร์
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={p.id} className="flex items-start justify-between gap-1">
                  <span>
                    {p.phone}
                    {p.label ? <span className="text-xs text-fg-muted"> · {p.label}</span> : null}
                  </span>
                  <span className="flex flex-none">
                    {pen({ kind: "phone", id: p.id }, `เบอร์ ${p.phone}`)}
                    {perm.editContact && phones.length > 1 ? (
                      <button type="button" className={ICON_BTN} aria-label={`ลบเบอร์ ${p.phone}`} title="ลบเบอร์นี้" onClick={() => void gate({ type: "delete", phoneId: p.id })}>
                        <Icon name="trash" />
                      </button>
                    ) : null}
                  </span>
                </div>
              ),
            )}
            {/* ทางสำรองเบอร์เดิม (รอ M19c ย้ายเข้า customer_phones) — ลบบล็อกนี้ได้เมื่อ M19c มา */}
            {phones.length === 0 && c.legacyPhone ? (
              <div className="text-[13px]">
                {c.legacyPhone}
                <span className="block text-xs text-fg-muted">เบอร์เดิมจากทะเบียนเก่า (ดูอย่างเดียว) · เพิ่มเบอร์ใหม่ด้านล่างได้</span>
              </div>
            ) : null}
            {phones.length === 0 && !c.legacyPhone ? <span className="text-fg-muted">—</span> : null}
            {sameKey(edit, { kind: "phone", id: null }) ? (
              <PhoneEditor draft={draft} setDraft={setDraft} buttons={editorButtons} error={errNode} />
            ) : perm.editContact ? (
              <button
                type="button"
                onClick={() => void gate({ type: "edit", key: { kind: "phone", id: null } })}
                className="inline-flex min-h-11 items-center gap-1 self-start text-xs font-semibold text-accent-strong md:min-h-8"
              >
                <Icon name="plus" />
                เพิ่มเบอร์
              </button>
            ) : null}
          </div>,
        )}

        {row("ที่อยู่", c.address || <span className="text-fg-muted">—</span>)}

        {row(
          "หมายเหตุ",
          sameKey(edit, { kind: "note" }) ? (
            <>
              <div className="flex items-start gap-1">
                <textarea
                  autoFocus
                  className={INPUT}
                  rows={3}
                  value={draft.value}
                  maxLength={NOTE_MAX}
                  aria-label="หมายเหตุ"
                  placeholder="เช่น สะดวกทุกวันจันทร์"
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                />
                {editorButtons}
              </div>
              {errNode}
            </>
          ) : (
            <span className="flex items-start justify-between gap-1">
              <span className="whitespace-pre-wrap">{c.note || <span className="text-fg-muted">—</span>}</span>
              {pen({ kind: "note" }, "หมายเหตุ")}
            </span>
          ),
        )}
      </dl>
      <p className="m-0 border-t border-border px-3.5 py-2.5 text-xs text-fg-muted">
        {c.contactUpdatedAt
          ? `แก้ข้อมูลติดต่อล่าสุด ${fmtDate(bangkokDate(c.contactUpdatedAt))}${c.contactUpdatedByName ? ` โดย ${c.contactUpdatedByName}` : ""}${c.contactCrossTeam ? " (ข้ามทีม)" : ""}`
          : "ยังไม่เคยแก้ข้อมูลติดต่อในระบบนี้"}
      </p>

      {ask ? (
        <ConfirmDialog
          title="ลูกค้าของทีมอื่น"
          message={`ลูกค้ารายนี้เป็นของทีม ${ask.teams.length ? ask.teams.join(", ") : "อื่น"} — คุณเป็นทีม ${data.myTeamCode ?? "—"} ต้องการแก้ข้อมูลติดต่อของลูกค้าทีมอื่นใช่ไหม ระบบจะบันทึกว่าแก้ข้ามทีม (ถามครั้งเดียวต่อลูกค้า)`}
          confirmLabel="ยืนยัน แก้ไข"
          cancelLabel="ยกเลิก"
          onConfirm={() => {
            const p = ask.pending;
            setAsk(null);
            setXteamOk(true);
            if (p.type === "delete") void confirmDeleteAfterAsk(p.phoneId);
            else run(p, true);
          }}
          onCancel={() => setAsk(null)}
        />
      ) : null}
      <Toast message={toast} onClose={() => setToast("")} />
    </aside>
  );

  /** ผู้ใช้ยืนยันข้ามทีมแล้วกดลบ → เปิดกล่องยืนยันลบเบอร์ตามปกติ (ไม่ลบทันที) */
  async function confirmDeleteAfterAsk(phoneId: string) {
    setEdit(null);
    setDelPhone(phoneId);
  }
}

function PhoneEditor({
  draft,
  setDraft,
  buttons,
  error,
}: {
  draft: { value: string; phone: string; label: string };
  setDraft: (d: { value: string; phone: string; label: string }) => void;
  buttons: React.ReactNode;
  error: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start gap-1">
        <span className="grid min-w-0 flex-1 gap-1">
          <input
            autoFocus
            className={INPUT}
            type="tel"
            inputMode="tel"
            value={draft.phone}
            maxLength={40}
            autoComplete="off"
            placeholder="เบอร์โทร"
            aria-label="เบอร์โทร"
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
          <input
            className={INPUT}
            value={draft.label}
            maxLength={PHONE_LABEL_MAX}
            autoComplete="off"
            placeholder="ชื่อ/หน้าที่ (ไม่บังคับ) เช่น ฝ่ายบัญชี"
            aria-label="ชื่อหรือหน้าที่ของเบอร์นี้"
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </span>
        {buttons}
      </div>
      {error}
    </div>
  );
}
