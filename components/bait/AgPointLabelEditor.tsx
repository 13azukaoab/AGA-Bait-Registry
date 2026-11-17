"use client";

/**
 * AgPointLabelEditor — ชื่อจุดกล่อง AG + ไอคอนดินสอแก้ inline ข้างชื่อจุด (หน้า /bait · M37 · DECISIONS 2.60 / 2.65)
 *
 * Logic summary:
 *   * ใช้เป็น `renderPointLabel` ของ AgSection (เฉพาะ /bait — /service ยังใช้ปุ่ม "ป้ายกำกับ" เดิม)
 *   * ดินสอแสดงเฉพาะ host/recorder + กล่อง AG ที่ active/รอถอด (`canEditPointLabel`) — บทบาทอื่น/สถานะอื่นเห็นแค่ชื่อ
 *   * กดดินสอ → ช่องกรอก: Enter = บันทึก · Esc = ยกเลิก · ตัดช่องว่างหน้า-หลัง · ไม่เกิน 40 ตัวอักษร
 *     บันทึกผ่าน RPC `set_station_point_label` อย่างเดียว **ไม่สร้างการเข้าบริการ** (DB เป็นด่านจริง)
 *   * เว้นว่าง = ลบชื่อจุด → ถามยืนยันก่อน · ไม่เปลี่ยนจากเดิม = ปิดช่องเฉยๆ ไม่เรียก RPC
 *   * ระหว่างแก้ค้าง = `useUnsavedWork` + `onDirtyChange(stationId, dirty)` ให้ /bait เตือนก่อนออกจากรายนี้
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/service/ConfirmDialog";
import { ERROR_TEXT, INPUT } from "@/components/service/styles";
import type { AgPointState } from "@/components/service/types";
import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { Button } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import type { UserRole } from "@/lib/db/types";

import { canEditPointLabel, isPointLabelDirty, planPointLabelEdit, POINT_LABEL_MAX } from "./pointLabelLogic";
import { setStationPointLabel } from "./pointLabelRpc";

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function AgPointLabelEditor({
  supabase,
  role,
  point,
  onSaved,
  onDirtyChange,
}: {
  supabase: SupabaseClient;
  role: UserRole | null | undefined;
  point: AgPointState;
  /** newLabel = ชื่อที่ DB เก็บจริง (null = ลบชื่อแล้ว) */
  onSaved: (stationId: string, newLabel: string | null) => void;
  onDirtyChange: (stationId: string, dirty: boolean) => void;
}) {
  const current = point.labelDb;
  const canEdit = canEditPointLabel(role, { type: "AG", status: point.statusDb });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);

  const dirty = editing && isPointLabelDirty(value, current);
  useUnsavedWork(dirty);
  useEffect(() => {
    onDirtyChange(point.stationId, dirty);
    return () => onDirtyChange(point.stationId, false);
    // onDirtyChange เป็นตัวตั้งค่าของแม่ (ไม่เปลี่ยนความหมาย)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, point.stationId]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const stop = () => {
    setEditing(false);
    setValue("");
    setError(null);
    setConfirmClear(false);
    window.setTimeout(() => pencilRef.current?.focus(), 0);
  };

  async function commit(label: string | null) {
    setConfirmClear(false);
    setSaving(true);
    setError(null);
    const r = await setStationPointLabel(supabase, point.stationId, label);
    setSaving(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    onSaved(point.stationId, r.pointLabel);
    stop();
  }

  function submit() {
    if (saving) return;
    const plan = planPointLabelEdit(value, current);
    if (plan.kind === "invalid") {
      setError(plan.message);
      return;
    }
    if (plan.kind === "unchanged") {
      stop();
      return;
    }
    if (plan.needsConfirm) {
      setConfirmClear(true);
      return;
    }
    void commit(plan.value);
  }

  if (editing) {
    return (
      <form
        className="flex w-full flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={`pl-${point.stationId}`} className="sr-only">
          ชื่อจุดที่ {point.no} (เว้นว่าง = ลบชื่อจุด)
        </label>
        <input
          id={`pl-${point.stationId}`}
          ref={inputRef}
          value={value}
          maxLength={POINT_LABEL_MAX + 10}
          autoComplete="off"
          disabled={saving}
          placeholder="ชื่อจุด เช่น ห้องนอน (เว้นว่าง = ลบ)"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `pl-err-${point.stationId}` : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              stop();
            }
          }}
          className={cx(INPUT, "w-[240px] max-w-full max-[640px]:min-h-11 max-[640px]:text-[16px]")}
        />
        <Button type="submit" size="sm" variant="primary" loading={saving} className="max-[640px]:min-h-11">
          บันทึกชื่อจุด
        </Button>
        <Button type="button" size="sm" onClick={stop} disabled={saving} className="max-[640px]:min-h-11">
          ยกเลิก
        </Button>
        {error ? (
          <p id={`pl-err-${point.stationId}`} role="alert" className={cx(ERROR_TEXT, "w-full")}>
            {error}
          </p>
        ) : null}
        {confirmClear ? (
          <ConfirmDialog
            title="ลบชื่อจุดนี้?"
            message={`ชื่อจุดที่ ${point.no} (“${current}”) จะถูกลบ เหลือแค่เลขจุด — ประวัติการแก้ไขยังเก็บไว้ในระบบ`}
            confirmLabel="ลบชื่อจุด"
            cancelLabel="ยกเลิก"
            danger
            onConfirm={() => void commit(null)}
            onCancel={() => setConfirmClear(false)}
          />
        ) : null}
      </form>
    );
  }

  return (
    <>
      {current ? (
        <span className="min-w-0 break-words rounded border border-dashed border-border-strong px-1.5 py-0.5 text-[12px] text-fg-muted">
          {current}
        </span>
      ) : null}
      {canEdit ? (
        <button
          ref={pencilRef}
          type="button"
          onClick={() => {
            setValue(current);
            setError(null);
            setEditing(true);
          }}
          aria-label={`แก้ชื่อจุดที่ ${point.no}`}
          title="แก้ชื่อจุด (บันทึกทันที ไม่ต้องบันทึกการเข้า)"
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded border border-border-strong bg-surface text-fg-muted hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-[640px]:size-11"
        >
          <PencilIcon />
        </button>
      ) : null}
    </>
  );
}
