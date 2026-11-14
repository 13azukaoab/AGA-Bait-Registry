"use client";

/**
 * AgSection — หมวด "กล่องเหยื่อ AG" ในฟอร์มเดียวกัน (แถวเดียว 4 ช่องต่อจุด · SPEC v1.8 §8.1)
 *
 *   * ทุกจุดที่ยังใช้งานต้อง "กรอกผล" (เหยื่อ + สัดส่วนปลวก) หรือ "ไม่ได้ตรวจจุดนี้" หรือข้ามทั้งหมด (กันลืมกล่อง D10)
 *   * เลขรอบ F **ไม่ให้กรอก** — แสดงจากฐานข้อมูล (บันทึกแล้ว) หรือค่าโดยประมาณ F ถัดไป (ระบบนับจริงตอนบันทึก)
 *     "ไม่ได้ตรวจจุดนี้" ไม่นับเป็นรอบ F
 *   * ป้ายกำกับจุด (ไม่บังคับ) ผูกกับจุดข้ามรอบ แก้ได้ทุกเดือนแม้ไม่ได้ตรวจ
 *   * สถานะจุด: ติดตามผล / รอถอด / ถอดแล้ว (DECISIONS 2.34) — "ถอดแล้ว" = จบงาน เปลี่ยนกลับไม่ได้ ยกเว้นแก้การเข้าที่เป็นคนถอด
 *     เอง (2.26 — เปลี่ยนกลับ = ยกเลิกการถอด) · จุดที่ถอดโดยการเข้าอื่นล็อกไว้
 *   * `mode="offround"` (หน้า "กล่อง AG นอกรอบประจำเดือน"): ไม่มี "ไม่ได้ตรวจจุดนี้"/"ข้ามทุกจุด" — จุดที่ไม่ได้กรอกถือว่าไม่ได้ตรวจ
 *   * "ติดกล่องใหม่ (S)": กรอก "เหยื่อที่ใส่" + "ป้ายจุด" (ไม่มี % กิน · ไม่นับเป็นรอบตรวจ → ครั้งถัดไปเป็น F1 SPEC §7.5) · ส่งเป็น `installs` ใน works (M13)
 *   * ชิป: ใต้ดิน/ติดตาม = ฟ้า · ถอดแล้ว = เขียว · ไม่ได้ตรวจ = ส้ม · แดงใช้เฉพาะขาด/ผิด
 */
import { useState } from "react";

import { Button, Chip } from "@/components/ui";
import { cx } from "@/components/ui/cx";

import { BaitField } from "./BaitField";
import { EATEN_OPTIONS } from "./bait";
import { isAgPointOff, newId, nextFollowUp, statusLabel } from "./formState";
import { nextAgNumber } from "./stationIndex";
import {
  CHIP_UNCHECKED,
  ERROR_TEXT,
  HINT,
  INPUT,
  INVALID,
  LABEL,
  SECTION,
  SECTION_TITLE,
  STATION_TYPE_TAG,
} from "./styles";
import type { AgHistory, AgPointState, AgStatusChoice, EatenSelect, FormState, StationRow } from "./types";
import type { FormIssues } from "./validate";
import { parseStationNumbers } from "@/lib/service/stationNumbers";

const CASTES = ["งาน>ทหาร", "ทหาร>งาน", "ทหาร", "ทหาร+สืบพันธุ์สำรอง", "สืบพันธุ์สำรอง", "ปลวกตาย"] as const;

export function AgSection({
  form,
  stations,
  history,
  issues,
  showIssues,
  mode = "round",
  onChange,
}: {
  form: FormState;
  stations: readonly StationRow[];
  history: readonly AgHistory[];
  issues: FormIssues;
  showIssues: boolean;
  /** round = ในรอบบริการประจำเดือน (/service) · offround = นอกรอบ (/bait) */
  mode?: "round" | "offround";
  onChange: (patch: Partial<FormState>) => void;
}) {
  const round = mode === "round";
  /** จุดที่ยังค้างติดตาม (ไม่รวมจุดที่การเข้านี้ถอดไปแล้ว) */
  const pendingCount = form.ag.filter((p) => p.statusChoice !== "removed").length;
  const [labelOpen, setLabelOpen] = useState<string | null>(null);
  const newBoxes = form.works.filter((w) => w.type === "AG" && w.kind === "added");
  const update = (stationId: string, patch: Partial<AgPointState>) =>
    onChange({ ag: form.ag.map((p) => (p.stationId === stationId ? { ...p, ...patch } : p)) });
  const historyById = new Map(history.map((h) => [h.stationId, h]));

  const addBox = () => {
    const taken = newBoxes.flatMap((w) => {
      const p = parseStationNumbers(w.noText);
      return p.ok ? p.numbers : [];
    });
    onChange({
      works: [
        ...form.works,
        { id: newId(), kind: "added", type: "AG", noText: String(nextAgNumber(stations, taken)), detail: "" },
      ],
    });
  };

  return (
    <section data-field="ag" aria-label="กล่องเหยื่อ AG" className={SECTION}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={SECTION_TITLE}>กล่องเหยื่อ AG</h3>
        {pendingCount > 0 ? <Chip tone="pend">ค้างติดตาม {pendingCount} จุด</Chip> : <Chip tone="na">ยังไม่มีกล่องค้างติดตาม</Chip>}
        <Button size="sm" variant="primary" className="ml-auto" onClick={addBox}>
          + ติดกล่องใหม่ (S)
        </Button>
      </div>
      <p className={HINT}>
        เลขรอบ F ระบบนับให้เอง · เหยื่อเลือกจากรายการ (เกิน 200 ก. เลือก “มากกว่า 200” แล้วพิมพ์เอง ต้องหาร 50 ลงตัว) ·
        เลือกสัดส่วนปลวกและสถานะของแต่ละจุด
      </p>

      <div className="mt-2.5 flex flex-col gap-2.5">
        {form.ag.map((p) => {
          const issue = (showIssues ? issues.ag[p.stationId] : undefined) ?? {};
          const off = round ? isAgPointOff(p, form.skipAllAg) : p.removedNoCheck && p.statusChoice === "removed";
          const f = p.savedFollowUpNo ?? nextFollowUp(historyById.get(p.stationId), form.visitDate);
          const isOpen = labelOpen === p.stationId;
          return (
            <div key={p.stationId} className={cx("rounded-lg border border-border bg-surface-2 p-2.5", off && "opacity-80")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={STATION_TYPE_TAG}>AG</span>
                <b className="text-[13px]">จุดที่ {p.no}</b>
                <button
                  type="button"
                  onClick={() => setLabelOpen(isOpen ? null : p.stationId)}
                  aria-expanded={isOpen}
                  className="cursor-pointer rounded border border-dashed border-border-strong px-1.5 py-0.5 text-[12px] text-fg-muted hover:bg-surface"
                  title="ป้ายกำกับจุด (ไม่บังคับ) — บอกตำแหน่ง เช่น ห้องนอน"
                >
                  {p.label ? `${p.label} ✎` : "+ ป้ายกำกับ"}
                </button>
                {p.statusChoice === "active" ? (
                  <Chip tone="info">{statusLabel("active", p.statusDb)}</Chip>
                ) : p.statusChoice === "pending_removal" ? (
                  <Chip tone="pend">{statusLabel("pending_removal", p.statusDb)}</Chip>
                ) : p.statusChoice === "removed" ? (
                  <Chip tone="ok">{statusLabel("removed", p.statusDb)}</Chip>
                ) : (
                  <Chip tone="na">{statusLabel(p.statusChoice, p.statusDb)}</Chip>
                )}
                {round && (p.skip || form.skipAllAg) ? (
                  <span className={CHIP_UNCHECKED}>ไม่ได้ตรวจ</span>
                ) : off ? (
                  <span className="text-[12px] text-fg-muted">ถอดโดยไม่มีผลตรวจ</span>
                ) : (
                  <span className="text-[12px] text-fg-muted num">
                    ติดตามผล F{f} <span className={STATION_TYPE_TAG}>อัตโนมัติ</span>
                  </span>
                )}
                {round ? (
                  <label
                    className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12.5px]"
                    title="ทีมเข้ามาแต่ไม่ได้ตรวจกล่องจุดนี้ — ไม่ต้องกรอกผล และไม่นับเป็นรอบตรวจ"
                  >
                    <input
                      type="checkbox"
                      checked={p.skip || form.skipAllAg}
                      disabled={form.skipAllAg}
                      onChange={(e) => update(p.stationId, { skip: e.target.checked })}
                    />
                    ไม่ได้ตรวจจุดนี้
                  </label>
                ) : null}
              </div>

              {isOpen ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`lbl-${p.stationId}`} className={LABEL}>
                      ป้ายกำกับจุดที่ {p.no} <span className="text-fg-faint">(ไม่บังคับ)</span>
                    </label>
                    <input
                      id={`lbl-${p.stationId}`}
                      maxLength={40}
                      autoComplete="off"
                      placeholder="เช่น ห้องนอน, ห้องนั่งเล่น, หลังบ้าน"
                      value={p.label}
                      onChange={(e) => update(p.stationId, { label: e.target.value })}
                      className={cx(INPUT, "w-[260px]")}
                    />
                  </div>
                  <Button size="sm" onClick={() => update(p.stationId, { label: "" })}>
                    ล้าง
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => setLabelOpen(null)}>
                    เสร็จ
                  </Button>
                </div>
              ) : null}

              <div className="mt-2.5 flex flex-wrap items-start gap-3">
                <BaitField
                  label="ปริมาณเหยื่อที่ใช้"
                  idPrefix={`ag-${p.stationId}`}
                  select={p.baitSelect}
                  custom={p.baitCustom}
                  error={issue.bait}
                  disabled={off}
                  onChange={(v) => update(p.stationId, { baitSelect: v.select, baitCustom: v.custom })}
                />
                <div className="flex min-w-[120px] flex-col gap-1">
                  <label htmlFor={`ag-${p.stationId}-eat`} className={LABEL}>
                    การกินเหยื่อ <span className="text-fg-faint">(ไม่บังคับ)</span>
                  </label>
                  <select
                    id={`ag-${p.stationId}-eat`}
                    value={p.eaten}
                    disabled={off}
                    onChange={(e) => update(p.stationId, { eaten: e.target.value as EatenSelect })}
                    className={INPUT}
                  >
                    <option value="">— เลือก —</option>
                    {EATEN_OPTIONS.map((v) => (
                      <option key={v} value={String(v)}>
                        {v}%
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-[170px] flex-col gap-1">
                  <label htmlFor={`ag-${p.stationId}-caste`} className={LABEL}>
                    สัดส่วนปลวกที่พบ
                  </label>
                  <select
                    id={`ag-${p.stationId}-caste`}
                    value={p.caste}
                    disabled={off}
                    onChange={(e) => update(p.stationId, { caste: e.target.value })}
                    className={cx(INPUT, issue.caste && INVALID)}
                  >
                    <option value="" disabled>
                      — เลือก —
                    </option>
                    <option value="none">ไม่พบปลวก</option>
                    {CASTES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {issue.caste ? <p className={ERROR_TEXT}>{issue.caste}</p> : null}
                </div>
                <div className="flex min-w-[150px] flex-col gap-1">
                  <label htmlFor={`ag-${p.stationId}-st`} className={LABEL}>
                    สถานะจุดนี้
                  </label>
                  {p.statusChoice === "locked" ? (
                    <div className={cx(INPUT, "bg-surface-3 text-fg-muted")}>{statusLabel(p.statusChoice, p.statusDb)}</div>
                  ) : (
                    <select
                      id={`ag-${p.stationId}-st`}
                      value={p.statusChoice}
                      onChange={(e) => update(p.stationId, { statusChoice: e.target.value as AgStatusChoice })}
                      className={INPUT}
                    >
                      <option value="active">ติดตามผล</option>
                      <option value="pending_removal">รอถอด (ปลวกตาย)</option>
                      <option value="removed">ถอดแล้ว (จบปัญหา)</option>
                    </select>
                  )}
                  {p.statusChoice === "removed" ? (
                    <p className="m-0 text-[11px] leading-snug text-fg-muted">
                      {p.removedHere
                        ? "การเข้านี้เป็นคนถอดกล่องนี้ — เปลี่ยนกลับเป็น ติดตามผล/รอถอด เพื่อยกเลิกการถอดได้ (ทำไม่ได้ถ้ามีการเข้าครั้งหลัง หรือสัญญา Renew แล้ว)"
                        : "ถอดแล้ว = ยืนยันว่าปลวกตายจริงและถอดกล่องออก · จบงานจุดนี้ เปลี่ยนสถานะอีกไม่ได้"}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {form.ag.length === 0 && newBoxes.length === 0 ? (
          <p className="m-0 text-[12.5px] text-fg-muted">ยังไม่มีจุดกล่อง — กด “+ ติดกล่องใหม่ (S)” เพื่อเพิ่มจุดแรก</p>
        ) : null}

        {newBoxes.map((w) => {
          const issue = (showIssues ? issues.works[w.id] : undefined) ?? {};
          return (
            <div key={w.id} className="rounded-lg border border-accent bg-accent-soft p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={STATION_TYPE_TAG}>AG</span>
                <label htmlFor={`new-${w.id}`} className="text-[13px] font-semibold">
                  ติดกล่องใหม่ (S) จุดที่
                </label>
                <input
                  id={`new-${w.id}`}
                  inputMode="numeric"
                  value={w.noText}
                  onChange={(e) =>
                    onChange({ works: form.works.map((x) => (x.id === w.id ? { ...x, noText: e.target.value } : x)) })
                  }
                  className={cx(INPUT, "num w-[90px]", issue.no && INVALID)}
                  aria-invalid={issue.no ? true : undefined}
                />
                <span className="text-[12px] text-fg-muted">ติดตั้งใหม่ (S) — ไม่นับเป็นรอบตรวจ ครั้งถัดไปเป็น F1</span>
                <Button
                  variant="danger"
                  size="sm"
                  className="ml-auto"
                  onClick={() => onChange({ works: form.works.filter((x) => x.id !== w.id) })}
                >
                  ลบจุด
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-start gap-3">
                <BaitField
                  label="เหยื่อที่ใส่"
                  idPrefix={`new-${w.id}`}
                  select={w.baitSelect ?? ""}
                  custom={w.baitCustom ?? ""}
                  error={issue.bait}
                  onChange={(v) =>
                    onChange({
                      works: form.works.map((x) => (x.id === w.id ? { ...x, baitSelect: v.select, baitCustom: v.custom } : x)),
                    })
                  }
                />
                <div className="flex min-w-[220px] flex-col gap-1">
                  <label htmlFor={`new-${w.id}-lbl`} className={LABEL}>
                    ป้ายจุด <span className="text-fg-faint">(ไม่บังคับ)</span>
                  </label>
                  <input
                    id={`new-${w.id}-lbl`}
                    maxLength={40}
                    autoComplete="off"
                    placeholder="เช่น ห้องนอน, หลังบ้าน"
                    value={w.label ?? ""}
                    onChange={(e) =>
                      onChange({ works: form.works.map((x) => (x.id === w.id ? { ...x, label: e.target.value } : x)) })
                    }
                    className={INPUT}
                  />
                </div>
              </div>
              {issue.no ? <p className={cx(ERROR_TEXT, "mt-1")}>{issue.no}</p> : null}
            </div>
          );
        })}
      </div>

      {round && form.ag.length > 0 ? (
        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-surface-2 p-2.5 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.skipAllAg}
            onChange={(e) => onChange({ skipAllAg: e.target.checked })}
          />
          <span>
            <b>รอบนี้ไม่ได้ตรวจกล่อง AG เลย (ข้ามทุกจุด)</b>
            <br />
            <small className="text-fg-muted">
              ทางลัดเมื่อทีมเข้ามาแต่ไม่ได้ตรวจกล่องเดิมของลูกค้ารายนี้เลยสักจุด · ถ้าตรวจบางจุด ให้ติ๊ก “ไม่ได้ตรวจจุดนี้” ที่จุดที่ข้ามแทน
            </small>
          </span>
        </label>
      ) : null}
    </section>
  );
}
