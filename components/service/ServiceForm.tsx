"use client";

/**
 * ServiceForm — ฟอร์มกรอกข้อมูลทำบริการของสัญญา 1 ใบ (ฝั่งขวา · SPEC v1.8 §8.1)
 *
 * Logic summary:
 *   * ลำดับบันทึก: (1) ถ้าสัญญายังไม่ตั้งสถานี → `initialize_contract_stations` (ครั้งเดียว · SV007 = ตั้งแล้ว ผ่าน)
 *     แล้วโหลดสถานีใหม่ (2) `save_service_visit` ครั้งเดียว (ผลตรวจ · ทีม · งานซ่อม · ป้าย/สถานะ AG)
 *     — 2 ขั้นไม่ atomic: ถ้าขั้น 2 ล้ม สัญญาถือว่าตั้งสถานีแล้ว ฟอร์มที่กรอกไว้ยังอยู่ กดบันทึกซ้ำได้
 *   * `visit_id` สร้างตอนเปิดฟอร์ม (formState.ts) → กดบันทึกซ้ำ/เน็ตสะดุดแล้วกดใหม่ = แก้ครั้งเดิม ไม่เกิดรายการซ้ำ
 *   * ถอดกล่อง AG พร้อมผลตรวจ และกล่อง AG ใหม่ (S) พร้อมเหยื่อ/ป้าย ส่งใน `save_service_visit` ครั้งเดียว (M13)
 *   * ตรวจฟอร์มก่อนบันทึก (validate.ts) · หลังกด "บันทึก" ครั้งแรกช่องที่ขาด/ผิดขึ้นกรอบแดง อัปเดตสดตามที่แก้ ·
 *     รายการ "บันทึกไม่ได้ — ยังขาด" กดแล้วเลื่อนไปที่ช่อง
 *   * F1–F10 ไม่ให้กรอก (แสดงจากฐานข้อมูล) · ข้อมูลทุกอย่างมาจากฐานข้อมูล ไม่มีตัวเลขสมมติ
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMemo, useState } from "react";

import { Alert, Button, Chip, TierBadge } from "@/components/ui";
import { cx } from "@/components/ui/cx";

import { AgSection } from "./AgSection";
import { buildPayload } from "./buildPayload";
import { ConfirmDialog } from "./ConfirmDialog";
import { loadStations } from "./data";
import { FindingsSection } from "./FindingsSection";
import { deleteServiceVisit, initializeStations, saveServiceVisit } from "./rpc";
import { buildInitPlan } from "./setup";
import { baselineIndex, inUseIndex } from "./stationIndex";
import { StationSetup } from "./StationSetup";
import { SECTION, STATION_TYPE_TAG } from "./styles";
import type {
  ContractDetail,
  ContractListItem,
  FormState,
  LoadedVisit,
  TeamOption,
  VisitSummary,
} from "./types";
import { isInUse } from "./types";
import { validateForm } from "./validate";
import { VisitHeader } from "./VisitHeader";
import { WorksSection } from "./WorksSection";


export interface SavedInfo {
  /** true = การเข้านี้เป็นรายการใหม่ (นับ "กรอกแล้ว" เพิ่ม) */
  created: boolean;
  /** การตั้งสถานีครั้งแรกเสร็จแล้ว */
  initialized: boolean;
  /** true = บันทึกหลักสำเร็จแต่ขั้นเปลี่ยนสถานะ "ถอดแล้ว" ยังไม่สำเร็จ → อยู่หน้าเดิม ไม่ไปรายถัดไป */
  stay?: boolean;
}

export function ServiceForm({
  supabase,
  item,
  detail,
  loadedVisit,
  form,
  teams,
  month,
  position,
  visitChoices,
  chosenVisitId,
  onChange,
  onChooseVisit,
  onDetail,
  onSaved,
  onDeleted,
  onPrev,
  onSkip,
}: {
  supabase: SupabaseClient;
  item: ContractListItem;
  detail: ContractDetail;
  loadedVisit: LoadedVisit | null;
  form: FormState;
  teams: readonly TeamOption[];
  month: string;
  position: { index: number; total: number };
  visitChoices: readonly VisitSummary[];
  /** "new" = การเข้าใหม่ */
  chosenVisitId: string;
  onChange: (patch: Partial<FormState>) => void;
  onChooseVisit: (id: string) => void;
  onDetail: (d: ContractDetail) => void;
  onSaved: (info: SavedInfo) => void;
  onDeleted: () => void;
  onPrev: () => void;
  onSkip: () => void;
}) {
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const needsSetup = !item.stationsInitialized;
  const isRenew = item.renewedFromContractId !== null;
  const canEditContract = item.status === "active" || item.status === "expired_pending_collection";

  const excluded = useMemo(() => new Set(form.setup.excludedOldIds), [form.setup.excludedOldIds]);
  // กล่อง AG ของสัญญาเก่าที่ผู้ใช้ติ๊กไม่ย้าย ไม่ต้องกรอกผลในครั้งนี้
  const effForm: FormState = useMemo(
    () => (needsSetup ? { ...form, ag: form.ag.filter((p) => !excluded.has(p.stationId)) } : form),
    [form, needsSetup, excluded],
  );

  const plan = useMemo(
    () => buildInitPlan(form.setup, isRenew, detail.oldStations),
    [form.setup, isRenew, detail.oldStations],
  );

  const savedWorks = useMemo(() => loadedVisit?.works ?? [], [loadedVisit]);
  const savedCheckIds = useMemo(() => new Set((loadedVisit?.checks ?? []).map((c) => c.stationId)), [loadedVisit]);
  const savedCheckKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const s of detail.stations) if (savedCheckIds.has(s.id) && s.no !== null) keys.add(`${s.type}-${s.no}`);
    return keys;
  }, [detail.stations, savedCheckIds]);

  const issues = useMemo(
    () =>
      validateForm(effForm, {
        stations: detail.stations,
        savedWorks,
        needsSetup,
        plan: needsSetup ? plan : null,
        month,
        savedCheckKeys,
      }),
    [effForm, detail.stations, savedWorks, needsSetup, plan, month, savedCheckKeys],
  );

  const baseline = needsSetup ? plan.index : baselineIndex(detail.stations, savedWorks);

  // เมื่อแก้ AG ผ่านหมวดกล่อง AG: รวมกับจุดที่ถูกติ๊กไม่ย้าย (ที่ซ่อนอยู่) เพื่อไม่ให้หาย
  const handleChange = (patch: Partial<FormState>) => {
    if (patch.ag && needsSetup) {
      const hidden = form.ag.filter((p) => excluded.has(p.stationId));
      onChange({ ...patch, ag: [...patch.ag, ...hidden] });
    } else onChange(patch);
  };

  const scrollTo = (field: string) => {
    const el = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = el.matches("input,select,button") ? el : el.querySelector<HTMLElement>("input,select,button");
    window.setTimeout(() => focusable?.focus({ preventScroll: true }), 350);
  };

  async function save() {
    setShowIssues(true);
    setErrorMsg(null);
    if (issues.missing.length > 0 || saving) return;
    setSaving(true);
    try {
      let stations = detail.stations;
      let initialized = false;

      if (needsSetup) {
        const init = await initializeStations(supabase, item.contractId, plan);
        if (!init.ok) {
          setErrorMsg(init.error.message);
          return;
        }
        const reloaded = await loadStations(supabase, item.contractId);
        if (reloaded.error) {
          setErrorMsg("ตั้งสถานีแล้ว แต่โหลดรายการสถานีไม่ได้ — รีเฟรชหน้าแล้วกดบันทึกอีกครั้ง");
          return;
        }
        stations = reloaded.stations;
        initialized = true;
        onDetail({ ...detail, stations, oldStations: [] });
      }

      // สถานีที่ใช้ได้ตอนจับคู่เลข = ที่ใช้งานอยู่ + ที่มีผลตรวจในการเข้านี้อยู่แล้ว
      const lookup = stations.filter((s) => isInUse(s.status) || savedCheckIds.has(s.id));
      const built = buildPayload(effForm, item.contractId, lookup);
      if (!built.ok) {
        setErrorMsg(built.error);
        if (initialized) onSaved({ created: false, initialized: true, stay: true });
        return;
      }
      const saved = await saveServiceVisit(supabase, built.payload);
      if (!saved.ok) {
        setErrorMsg(saved.error.message);
        if (initialized) onSaved({ created: false, initialized: true, stay: true });
        return;
      }
      onSaved({ created: !form.isExisting, initialized });
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
  const agCount = effForm.ag.filter((p) => p.statusChoice !== "removed").length;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface">
      {/* หัวฟอร์ม */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-[12px] text-fg-muted num">
          รายที่ {position.index} จาก {position.total}
        </span>
        {item.routineCountInMonth > 0 ? <Chip tone="ok">กรอกแล้ว · บันทึกซ้ำเพื่อแก้ไข</Chip> : null}
        <b className="text-[16px]">{item.customerName}</b>
        <TierBadge tier={item.tier} years={item.termYears} />
        <Chip tone="na">สัญญา {item.contractNo}</Chip>
        {needsSetup ? (
          <Chip tone="pend">ยังไม่ระบุจำนวนสถานี</Chip>
        ) : (
          <>
            <Chip tone="na">
              <span className={STATION_TYPE_TAG}>IG</span> {inUseIndex(detail.stations).IG.size}
            </Chip>
            <Chip tone="na">
              <span className={STATION_TYPE_TAG}>IC</span> {inUseIndex(detail.stations).IC.size}
            </Chip>
          </>
        )}
        <Chip tone={agCount ? "pend" : "na"}>
          <span className={STATION_TYPE_TAG}>AG</span> {agCount}
          {agCount ? " ค้างติดตาม" : ""}
        </Chip>
      </div>

      <div className="flex flex-col gap-3 px-4 pb-2">
        {!canEditContract ? (
          <Alert variant="warn" title="สัญญานี้ปิดหรือยกเลิกแล้ว">
            เฉพาะ Host เท่านั้นที่แก้ได้ — บัญชีอื่นบันทึกไม่ได้
          </Alert>
        ) : null}
        {detail.stationsTruncated ? (
          <Alert variant="warn" title="รายการสถานีมากกว่า 1,000 แถว">
            หน้าจออ่านสถานีได้สูงสุด 1,000 แถว บางเลขอาจไม่พบ — แจ้งผู้ดูแลระบบ
          </Alert>
        ) : null}

        {visitChoices.length > 0 ? (
          <div className={cx(SECTION, "flex flex-wrap items-center gap-2 py-2")} aria-label="การเข้าในเดือนนี้">
            <span className="text-[12.5px] text-fg-muted">การเข้าในเดือนนี้:</span>
            {visitChoices.map((v, i) => (
              <Chip key={v.id} tone="info" selected={chosenVisitId === v.id} onClick={() => onChooseVisit(v.id)}>
                ครั้งที่ {i + 1} · {v.visitDate.slice(8)}/{v.visitDate.slice(5, 7)}
              </Chip>
            ))}
            <Chip tone="na" selected={chosenVisitId === "new"} onClick={() => onChooseVisit("new")}>
              + การเข้าใหม่
            </Chip>
          </div>
        ) : null}

        {needsSetup ? (
          <StationSetup
            isRenew={isRenew}
            oldStations={detail.oldStations}
            setup={form.setup}
            plan={plan}
            showIssues={showIssues}
            onChange={(setup) => onChange({ setup })}
          />
        ) : null}

        <VisitHeader
          form={form}
          teams={teams}
          issues={issues}
          showIssues={showIssues}
          teamHint={teamHint}
          onChange={handleChange}
        />

        <button
          type="button"
          aria-pressed={form.normal}
          onClick={() => {
            if (!form.normal && (form.findings.length || form.timbers.length || form.works.some((w) => w.type !== "AG"))) {
              setErrorMsg("มีรายการพบปลวก/เปลี่ยนไม้/งานซ่อมอยู่ — ลบออกก่อนจึงกด “ปกติทั้งหมด” ได้");
              return;
            }
            setErrorMsg(null);
            onChange({ normal: !form.normal });
          }}
          className={cx(
            "flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 text-left",
            form.normal ? "border-ok bg-ok-soft" : "border-border-strong bg-surface hover:bg-surface-2",
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              "flex size-6 flex-none items-center justify-center rounded-md border-2 text-[14px] font-bold",
              form.normal ? "border-ok bg-ok text-accent-fg" : "border-border-strong text-transparent",
            )}
          >
            ✓
          </span>
          <span className="flex-1">
            <b className="block text-[15px]">IG / IC ปกติทั้งหมด</b>
            <small className="text-fg-muted">ไม่พบปลวก ไม่เปลี่ยนไม้ ไม่มีงานซ่อม · ไม่รวมกล่อง AG</small>
          </span>
          <span className={cx("text-[12.5px]", form.normal ? "font-semibold text-ok" : "text-fg-muted")}>
            {form.normal ? "กดแล้ว ✓" : "ยังไม่ได้กด"}
          </span>
        </button>

        <FindingsSection form={effForm} issues={issues} showIssues={showIssues} onChange={handleChange} />
        <WorksSection form={effForm} baseline={baseline} issues={issues} showIssues={showIssues} onChange={handleChange} />
        <AgSection
          form={effForm}
          stations={needsSetup ? detail.oldStations : detail.stations}
          history={detail.agHistory}
          issues={issues}
          showIssues={showIssues}
          onChange={handleChange}
        />
      </div>

      {/* แถบบันทึก */}
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
        {issues.warnings.map((w) => (
          <Alert key={w} variant="warn">
            {w}
          </Alert>
        ))}
        {errorMsg ? (
          <Alert variant="danger" title="บันทึกไม่สำเร็จ">
            {errorMsg}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onPrev} aria-label="รายก่อนหน้า" title="รายก่อนหน้า" className="min-w-14" disabled={saving}>
            ←
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            บันทึก + รายถัดไป
          </Button>
          <Button onClick={onSkip} disabled={saving}>
            ข้าม
          </Button>
          {form.isExisting ? (
            <Button variant="danger" className="ml-auto" onClick={() => setConfirmDelete(true)} disabled={saving}>
              ลบการเข้านี้
            </Button>
          ) : null}
        </div>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="ลบการเข้าบริการนี้?"
          message="ลบผลตรวจ ทีม และงานซ่อมของการเข้าครั้งนี้ทั้งหมด (สถานีที่ฝังใหม่ในการเข้านี้จะถูกลบ สถานีที่หาย/ถอนออกจะคืนสถานะเดิม) · ย้อนกลับไม่ได้ แต่ประวัติการแก้อยู่ในประวัติการแก้ไข"
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
