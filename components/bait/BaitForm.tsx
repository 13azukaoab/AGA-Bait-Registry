"use client";

/**
 * BaitForm — ฟอร์มงานกล่องเหยื่อ AG นอกรอบ ของสัญญา 1 ใบ (ฝั่งขวาของ /bait · mockup #bait FINAL)
 *
 * Logic summary:
 *   * กรอก: ทีม · วันที่เข้าจริง (ตามใบงาน) · เวลาเข้า–ออก · กล่อง AG (ติดตามผล F + ติดกล่องใหม่ S) — ไม่มีช่อง "ประเภทรอบ"
 *     (หน้านี้ตั้ง `visit_type = follow_up` เอง) · ตรรกะอยู่ใน `baitLogic.ts`
 *   * บันทึก 1 ครั้ง = `save_service_visit` 1 ครั้ง (1 transaction) · `visit_id` สร้างตอนเปิดฟอร์ม → กดซ้ำ = แก้ครั้งเดิม ไม่ซ้ำ
 *   * "บันทึกงานกล่อง" = บันทึกแล้วเริ่มฟอร์มใหม่ (วันที่เป็นวันนี้) · "บันทึกแล้วเพิ่มอีกวัน" = วันที่ว่าง ทีมคงเดิม
 *     (กรอกหลายวันที่เข้าจริงในรอบเดียว — กรอกเรียงจากเก่าไปใหม่ · F ฐานข้อมูลนับตามวันที่เข้าจริง)
 *   * วันที่เข้าอยู่ก่อนวันติดตั้งของจุดที่กรอกผลติดตาม → แถบเตือนสีส้ม + บันทึกไม่ได้
 *   * รายการ "การเข้านอกรอบที่บันทึกแล้ว" (จากฐานข้อมูล) แก้/ลบได้ · แก้การเข้าที่มี IG/IC หรืองานซ่อมปนอยู่ไม่ได้ที่นี่
 *   * ยังไม่ตั้งจำนวนสถานี (SV003) → ไม่ให้กรอก บอกให้ไปตั้งที่หน้า "ลงข้อมูลทำบริการประจำเดือน" ก่อน
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

import { AgSection } from "@/components/service/AgSection";
import { ConfirmDialog } from "@/components/service/ConfirmDialog";
import { deleteServiceVisit, saveServiceVisit } from "@/components/service/rpc";
import { HINT, SECTION } from "@/components/service/styles";
import type { ContractDetail, ContractListItem, FormState, LoadedVisit, TeamOption } from "@/components/service/types";
import { VisitHeader } from "@/components/service/VisitHeader";
import { Alert, Button, Chip, TierBadge } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import { isInUse } from "@/components/service/types";

import { buildBaitPayload, validateBait } from "./baitLogic";
import type { BaitVisitLogItem } from "./data";

export interface BaitSavedInfo {
  /** true = "บันทึกแล้วเพิ่มอีกวัน" */
  more: boolean;
}

const fmtDmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

export function BaitForm({
  supabase,
  item,
  detail,
  loadedVisit,
  form,
  log,
  teams,
  today,
  focusDateOnMount,
  onChange,
  onEditLog,
  onSaved,
  onDeleted,
  onCancel,
}: {
  supabase: SupabaseClient;
  item: ContractListItem;
  detail: ContractDetail;
  /** การเข้าที่กำลังแก้ (null = การเข้าใหม่) */
  loadedVisit: LoadedVisit | null;
  form: FormState;
  log: readonly BaitVisitLogItem[];
  teams: readonly TeamOption[];
  /** วันนี้ตามเวลาไทย 'YYYY-MM-DD' (แสดงเป็นวันที่ระบบบันทึกให้เอง) */
  today: string;
  /** true = โฟกัสช่องวันที่ตอนเปิดฟอร์ม (หลัง "บันทึกแล้วเพิ่มอีกวัน") */
  focusDateOnMount: boolean;
  onChange: (patch: Partial<FormState>) => void;
  onEditLog: (visitId: string) => void;
  onSaved: (info: BaitSavedInfo) => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (focusDateOnMount) document.getElementById("sv-date")?.focus();
    // เฉพาะตอนเปิดฟอร์ม (ClientBait remount ฟอร์มทุกครั้งที่เปลี่ยน key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canEditContract = item.status === "active" || item.status === "expired_pending_collection";
  const blockedUninitialized = !item.stationsInitialized;

  const savedWorks = useMemo(() => loadedVisit?.works ?? [], [loadedVisit]);
  const savedCheckKeys = useMemo(() => {
    const ids = new Set((loadedVisit?.checks ?? []).map((c) => c.stationId));
    const keys = new Set<string>();
    for (const s of detail.stations) if (ids.has(s.id) && s.no !== null) keys.add(`${s.type}-${s.no}`);
    return keys;
  }, [detail.stations, loadedVisit]);

  const issues = useMemo(
    () => validateBait(form, { stations: detail.stations, savedWorks, savedCheckKeys }),
    [form, detail.stations, savedWorks, savedCheckKeys],
  );

  const agPending = form.ag.filter((p) => p.statusChoice !== "removed").length;

  const scrollTo = (field: string) => {
    const el = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = el.matches("input,select,button") ? el : el.querySelector<HTMLElement>("input,select,button");
    window.setTimeout(() => focusable?.focus({ preventScroll: true }), 350);
  };

  async function save(more: boolean) {
    setShowIssues(true);
    setErrorMsg(null);
    if (issues.missing.length > 0 || saving || blockedUninitialized) return;
    setSaving(true);
    try {
      // สถานีที่ใช้ได้ตอนจับคู่ = ที่ใช้งานอยู่ + ที่มีผลตรวจในการเข้านี้อยู่แล้ว (ตรงกับ /service)
      const lookup = detail.stations.filter((s) => isInUse(s.status) || savedCheckKeys.has(`${s.type}-${s.no}`));
      const built = buildBaitPayload(form, item.contractId, lookup);
      if (!built.ok) {
        setErrorMsg(built.error);
        return;
      }
      const saved = await saveServiceVisit(supabase, built.payload);
      if (!saved.ok) {
        setErrorMsg(saved.error.message);
        return;
      }
      onSaved({ more });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setConfirmDelete(false);
    setSaving(true);
    setErrorMsg(null);
    const r = await deleteServiceVisit(supabase, form.visitId);
    setSaving(false);
    if (!r.ok) {
      setErrorMsg(r.error.message);
      return;
    }
    onDeleted();
  }

  const teamHint = loadedVisit ? "จากการบันทึกครั้งนี้" : detail.lastTeamIds.length ? "เติมจากครั้งก่อน" : "ยังไม่เคยเข้า — เลือกทีมเอง";
  const disabledForm = blockedUninitialized || !canEditContract;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-[12px] text-fg-muted">
          งานกล่องนอกรอบประจำเดือน{form.isExisting ? ` · แก้การเข้าวันที่ ${fmtDmy(form.visitDate)}` : log.length ? ` · รายการที่ ${log.length + 1}` : ""}
        </span>
        <b className="text-[16px]">{item.customerName}</b>
        <TierBadge tier={item.tier} years={item.termYears} />
        <Chip tone="na">สัญญา {item.contractNo}</Chip>
        <Chip tone={agPending ? "pend" : "na"}>
          <span className="inline-block rounded bg-surface-3 px-1.5 py-px text-[11px] font-semibold text-fg-muted">AG</span> {agPending}
          {agPending ? " ค้างติดตาม" : ""}
        </Chip>
      </div>

      <div className="flex flex-col gap-3 px-4 pb-2">
        {!canEditContract ? (
          <Alert variant="warn" title="สัญญานี้ปิดหรือยกเลิกแล้ว">
            เฉพาะ Host เท่านั้นที่แก้ได้ — บัญชีอื่นบันทึกไม่ได้
          </Alert>
        ) : null}
        {blockedUninitialized ? (
          <Alert variant="warn" title="สัญญานี้ยังไม่ได้ระบุจำนวนสถานี">
            ไปที่หน้า “ลงข้อมูลทำบริการประจำเดือน” ตั้งจำนวนสถานี IG/IC ของสัญญานี้ก่อน แล้วกลับมากรอกงานกล่อง AG ที่นี่
          </Alert>
        ) : null}
        {detail.stationsTruncated ? (
          <Alert variant="warn" title="รายการสถานีมากกว่า 1,000 แถว">
            หน้าจออ่านสถานีได้สูงสุด 1,000 แถว บางจุดอาจไม่แสดง — แจ้งผู้ดูแลระบบ
          </Alert>
        ) : null}

        <fieldset disabled={disabledForm} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <VisitHeader
            form={form}
            teams={teams}
            issues={issues}
            showIssues={showIssues}
            teamHint={teamHint}
            dateLabel="วันที่เข้าจริง (ตามใบงาน)"
            dateHint={`วันที่บันทึกระบบใส่ให้เอง (${fmtDmy(today)})`}
            showVisitTypeNote={false}
            onChange={onChange}
          />

          {issues.order.length > 0 ? (
            <div role="alert" className="rounded-lg border border-warn bg-warn-soft px-3 py-2 text-[13px] text-warn">
              {issues.order.map((m) => (
                <div key={m}>{m}</div>
              ))}
            </div>
          ) : null}

          <AgSection
            form={form}
            stations={detail.stations}
            history={detail.agHistory}
            issues={issues}
            showIssues={showIssues}
            mode="offround"
            onChange={onChange}
          />
        </fieldset>

        {log.length > 0 ? (
          <div className={cx(SECTION, "text-[13px]")} aria-label="การเข้านอกรอบที่บันทึกแล้ว">
            <div className="mb-1 text-[12px] text-fg-muted">กรอกแล้วของลูกค้ารายนี้ (นอกรอบประจำเดือน · ล่าสุด {log.length} รายการ)</div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {log.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b className="num">{fmtDmy(e.visitDate)}</b>
                  <span className="num text-fg-muted">
                    {e.startTime}–{e.endTime}
                  </span>
                  <span className="min-w-0 flex-1 text-fg-muted">{e.summary}</span>
                  {e.hasOther ? (
                    <small className="text-fg-muted">มีข้อมูล IG/IC — แก้ที่หน้า “ลงข้อมูลทำบริการประจำเดือน”</small>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => onEditLog(e.id)}
                      disabled={saving || form.visitId === e.id}
                      aria-label={`แก้การเข้าวันที่ ${fmtDmy(e.visitDate)}`}
                    >
                      {form.visitId === e.id ? "กำลังแก้" : "แก้"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className={HINT}>
          วันที่เข้าพร้อมรอบบริการประจำเดือน ให้กรอกที่หน้า “ลงข้อมูลทำบริการประจำเดือน” · กรอกเรียงจากวันที่เก่าไปใหม่
        </p>
      </div>

      <div className="sticky bottom-0 flex flex-col gap-2 rounded-b-xl border-t border-border bg-surface px-4 py-3">
        {showIssues && issues.missing.length > 0 ? (
          <div role="alert" className="rounded-lg border border-danger bg-danger-soft px-3 py-2 text-[13px]">
            <b>
              บันทึกไม่ได้ — ยังขาด <small className="font-normal text-fg-muted">(กดเพื่อไปที่ช่อง)</small>
            </b>
            <ul className="m-0 mt-1 list-disc pl-5">
              {issues.missing.map((m) => (
                <li key={m.message}>
                  <button type="button" onClick={() => scrollTo(m.field)} className="cursor-pointer text-left text-danger underline">
                    {m.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {errorMsg ? (
          <Alert variant="danger" title="บันทึกไม่สำเร็จ">
            {errorMsg}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void save(false)} loading={saving} disabled={disabledForm}>
            {form.isExisting ? "บันทึกการแก้ไข" : "บันทึกงานกล่อง"}
          </Button>
          {form.isExisting ? null : (
            <Button onClick={() => void save(true)} disabled={saving || disabledForm}>
              บันทึกแล้วเพิ่มอีกวัน
            </Button>
          )}
          <Button onClick={onCancel} disabled={saving}>
            {form.isExisting ? "เลิกแก้" : "ยกเลิก"}
          </Button>
          {form.isExisting ? (
            <Button variant="danger" className="ml-auto" onClick={() => setConfirmDelete(true)} disabled={saving || disabledForm}>
              ลบการเข้านี้
            </Button>
          ) : null}
        </div>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="ลบการเข้านอกรอบนี้?"
          message="ลบผลติดตาม ทีม และข้อมูลติดกล่องใหม่ของการเข้าครั้งนี้ทั้งหมด (กล่องที่ติดใหม่ในการเข้านี้จะถูกลบ · กล่องที่ถอดในการเข้านี้จะกลับเป็นสถานะเดิม) · ย้อนกลับไม่ได้ แต่ประวัติการแก้อยู่ในประวัติการแก้ไข"
          confirmLabel="ลบการเข้านี้"
          cancelLabel="ยกเลิก"
          danger
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
