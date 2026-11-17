"use client";

/**
 * PointLabelPanel — แผงเล็ก "ชื่อจุดกล่อง AG" ใต้ฟอร์ม /bait (M37 · DECISIONS 2.60 / 2.65)
 *
 * Logic summary:
 *   * แสดงเฉพาะ host / recorder และเฉพาะกล่อง AG ที่ active / รอถอด (`editablePointLabelStations`) — ไม่มีสถานีให้แก้ = ไม่แสดงแผง
 *   * กดไอคอนดินสอข้างชื่อจุด → ช่องกรอก inline (ตัดช่องว่างหน้า-หลัง · ไม่เกิน 40 ตัวอักษร) → "บันทึกชื่อจุด"
 *     เรียก RPC `set_station_point_label` อย่างเดียว **ไม่สร้างการเข้าบริการ** (DB เป็นด่านจริง)
 *   * ช่องว่าง = ลบชื่อจุด → ถามยืนยันก่อน · ไม่เปลี่ยนจากเดิม = ปิดช่องเฉยๆ ไม่เรียก RPC
 *   * สำเร็จ → `onSaved(stationId, ชื่อที่ DB คืนมา)` ให้แม่อัปเดตชื่อบนหน้าจอ · error แสดงข้อความไทยใต้ช่อง
 *   * ระหว่างแก้ค้าง = `useUnsavedWork` (แถบแจ้งเวอร์ชันใหม่ไม่รีโหลดทับ) + `onDirtyChange` ให้ /bait เตือนก่อนออกจากรายนี้
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/service/ConfirmDialog";
import { ERROR_TEXT, INPUT, LABEL, SECTION, SECTION_TITLE, STATION_TYPE_TAG } from "@/components/service/styles";
import type { StationRow } from "@/components/service/types";
import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { Button } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import type { UserRole } from "@/lib/db/types";

import {
  editablePointLabelStations,
  isPointLabelDirty,
  planPointLabelEdit,
  POINT_LABEL_MAX,
} from "./pointLabelLogic";
import { setStationPointLabel } from "./pointLabelRpc";

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function PointLabelPanel({
  supabase,
  role,
  stations,
  onSaved,
  onDirtyChange,
}: {
  supabase: SupabaseClient;
  role: UserRole | null | undefined;
  stations: readonly StationRow[];
  /** newLabel = ชื่อที่ DB เก็บจริง (null = ลบชื่อแล้ว) */
  onSaved: (stationId: string, newLabel: string | null) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const rows = editablePointLabelStations(role, stations);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const editing = rows.find((s) => s.id === editingId);
  const dirty = editing ? isPointLabelDirty(value, editing.pointLabel) : false;

  useUnsavedWork(dirty);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
    // onDirtyChange เป็น setState ของแม่ (คงที่)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  if (rows.length === 0) return null;

  const start = (s: StationRow) => {
    if (saving) return;
    setEditingId(s.id);
    setValue(s.pointLabel);
    setError(null);
  };
  const stop = () => {
    setEditingId(null);
    setValue("");
    setError(null);
    setConfirmClear(false);
  };

  async function commit(s: StationRow, label: string | null) {
    setConfirmClear(false);
    setSaving(true);
    setError(null);
    const r = await setStationPointLabel(supabase, s.id, label);
    setSaving(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    onSaved(s.id, r.pointLabel);
    stop();
  }

  function submit(s: StationRow) {
    if (saving) return;
    const plan = planPointLabelEdit(value, s.pointLabel);
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
    void commit(s, plan.value);
  }

  return (
    <section aria-label="ชื่อจุดกล่อง AG" className={SECTION}>
      <h3 className={SECTION_TITLE}>ชื่อจุดกล่อง AG</h3>
      <p className="m-0 mt-1 text-[12px] text-fg-muted">
        แก้ชื่อบอกตำแหน่งของจุด เช่น ห้องนอน ได้เลย <b>ไม่ต้องบันทึกการเข้าบริการ</b> · ไม่เกิน {POINT_LABEL_MAX} ตัวอักษร
      </p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
        {rows.map((s) => {
          const isEditing = s.id === editingId;
          return (
            <li key={s.id} className="rounded-lg border border-border bg-surface-2 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={STATION_TYPE_TAG}>AG</span>
                <b className="text-[13px]">จุดที่ {s.no}</b>
                {s.status === "pending_removal" ? <span className="text-[12px] text-fg-muted">(รอถอด)</span> : null}
                {isEditing ? null : (
                  <>
                    <span className={cx("min-w-0 break-words text-[13px]", s.pointLabel ? "text-fg" : "text-fg-muted")}>
                      {s.pointLabel || "ยังไม่ตั้งชื่อจุด"}
                    </span>
                    <button
                      type="button"
                      onClick={() => start(s)}
                      aria-label={`แก้ชื่อจุดที่ ${s.no}`}
                      title="แก้ชื่อจุด"
                      className="ml-auto inline-flex min-h-[32px] min-w-[32px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-border-strong bg-surface px-2 text-[12px] text-fg-muted hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-[640px]:min-h-11 max-[640px]:min-w-11"
                    >
                      <PencilIcon />
                      <span>แก้ชื่อจุด</span>
                    </button>
                  </>
                )}
              </div>

              {isEditing ? (
                <form
                  className="mt-2 flex flex-col gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(s);
                  }}
                >
                  <label htmlFor={`pl-${s.id}`} className={LABEL}>
                    ชื่อจุดที่ {s.no} <span className="text-fg-faint">(เว้นว่าง = ลบชื่อจุด)</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      id={`pl-${s.id}`}
                      ref={inputRef}
                      value={value}
                      maxLength={POINT_LABEL_MAX + 10}
                      autoComplete="off"
                      disabled={saving}
                      placeholder="เช่น ห้องนอน, ห้องนั่งเล่น, หลังบ้าน"
                      aria-invalid={error ? true : undefined}
                      onChange={(e) => {
                        setValue(e.target.value);
                        setError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") stop();
                      }}
                      className={cx(INPUT, "w-[260px] max-w-full max-[640px]:min-h-11 max-[640px]:text-[16px]")}
                    />
                    <Button type="submit" size="sm" variant="primary" loading={saving} className="max-[640px]:min-h-11">
                      บันทึกชื่อจุด
                    </Button>
                    <Button type="button" size="sm" onClick={stop} disabled={saving} className="max-[640px]:min-h-11">
                      ยกเลิก
                    </Button>
                  </div>
                  {error ? (
                    <p role="alert" className={ERROR_TEXT}>
                      {error}
                    </p>
                  ) : null}
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>

      {confirmClear && editing ? (
        <ConfirmDialog
          title="ลบชื่อจุดนี้?"
          message={`ชื่อจุดที่ ${editing.no} (“${editing.pointLabel}”) จะถูกลบ เหลือแค่เลขจุด — ประวัติการแก้ไขยังเก็บไว้ในระบบ`}
          confirmLabel="ลบชื่อจุด"
          cancelLabel="ยกเลิก"
          danger
          onConfirm={() => void commit(editing, null)}
          onCancel={() => setConfirmClear(false)}
        />
      ) : null}
    </section>
  );
}
