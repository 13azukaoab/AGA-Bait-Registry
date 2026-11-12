"use client";

/**
 * WorksSection — หมวด "งานซ่อม / ฝังเพิ่ม" (หมวดเดียว 2 กลุ่ม — ฝังเพิ่มไม่ใช่งานซ่อม · SPEC v1.8 §8.1)
 *
 *   * งานซ่อม: เปลี่ยนฝาสถานี · สถานีหาย · ถอนสถานีออก · อื่นๆ — IG/IC + เลขสถานีเดิม หลายเลข/ช่วงในแถวเดียว
 *     ("3, 5, 8-12" = 7 สถานี · ระบบนับเอง) · "สถานีหาย" และ "อื่นๆ" ต้องระบุรายละเอียด ·
 *     หาย/ถอนออก หักจากจำนวนที่ใช้งาน (เปลี่ยนสถานะ ไม่ลบแถว)
 *   * ฝังเพิ่ม: ฝังสถานีใหม่ IG/IC — พิมพ์เลขที่ฝัง · ใช้เลขเดิมของสถานีที่หาย/ถอนได้ (DECISIONS 2.20)
 *     แต่ห้ามชนสถานีที่ยังใช้งาน · ไม่บังคับเลขต่อเนื่อง
 *   * สรุปสดก่อนบันทึก: "จำนวนสถานีลูกค้า (หลังบันทึก): IG 80 → 85"
 *   * กล่อง AG ใหม่ (S) อยู่ในหมวดกล่อง AG (ใช้ข้อมูลชุดเดียวกัน kind = added, type = AG)
 */
import { Button, Chip } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import { parseStationNumbers } from "@/lib/service/stationNumbers";

import { newId } from "./formState";
import { ERROR_TEXT, HINT, INPUT, INVALID, SECTION, SECTION_TITLE, STATION_TYPE_TAG } from "./styles";
import type { NumberIndex } from "./stationIndex";
import type { FormState, WorkKind, WorkRow } from "./types";
import type { FormIssues } from "./validate";

const KIND_LABEL: Record<WorkKind, string> = {
  cap_replaced: "เปลี่ยนฝาสถานี",
  lost: "สถานีหาย",
  withdrawn: "ถอนสถานีออก",
  other: "อื่นๆ",
  added: "ฝังสถานีใหม่",
};
const REPAIR_KINDS: WorkKind[] = ["cap_replaced", "lost", "withdrawn", "other"];

export function worksDelta(works: readonly WorkRow[]): { IG: number; IC: number } {
  const d = { IG: 0, IC: 0 };
  for (const w of works) {
    if (w.type === "AG") continue;
    const p = parseStationNumbers(w.noText);
    if (!p.ok) continue;
    if (w.kind === "added") d[w.type] += p.numbers.length;
    else if (w.kind === "lost" || w.kind === "withdrawn") d[w.type] -= p.numbers.length;
  }
  return d;
}

export function WorksSection({
  form,
  baseline,
  issues,
  showIssues,
  onChange,
}: {
  form: FormState;
  /** ชุดเลขสถานีที่ใช้งานก่อนการเข้านี้ (ไว้แสดงสรุปจำนวน) */
  baseline: NumberIndex;
  issues: FormIssues;
  showIssues: boolean;
  onChange: (patch: Partial<FormState>) => void;
}) {
  const rows = form.works.filter((w) => w.type !== "AG");
  const update = (id: string, patch: Partial<WorkRow>) =>
    onChange({ works: form.works.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const delta = worksDelta(form.works);
  const changed = delta.IG !== 0 || delta.IC !== 0;

  const add = (kind: WorkKind) =>
    onChange({
      normal: false,
      works: [...form.works, { id: newId(), kind, type: "IG", noText: "", detail: "" }],
    });

  return (
    <section data-field="works" aria-label="งานซ่อม และ ฝังเพิ่มสถานี" className={SECTION} hidden={!rows.length && form.normal}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={SECTION_TITLE}>งานซ่อม และ ฝังเพิ่มสถานี</h3>
        {changed ? (
          <Chip tone="info">
            จำนวนสถานีลูกค้า (หลังบันทึก): IG {baseline.IG.size} → {baseline.IG.size + delta.IG} · IC {baseline.IC.size} →{" "}
            {baseline.IC.size + delta.IC}
          </Chip>
        ) : (
          <Chip tone="na">งานซ่อมนี้ไม่เปลี่ยนจำนวนสถานี</Chip>
        )}
      </div>
      <p className={HINT}>
        <b>ฝังสถานีใหม่</b> พิมพ์เลขสถานีใหม่ที่ฝัง (เช่น <b>81-85</b> หรือ <b>81, 82, 90</b>) · ฝังแทนสถานีที่หาย/ถอนออกใช้เลขเดิมได้ ·{" "}
        <b>สถานีหาย / ถอนออก</b> ใส่เลขเดิมหลายเลขในแถวเดียว (<b>3, 5, 8-12</b> = 7 สถานี) ระบบหักออกจากจำนวนที่ใช้งาน ·
        “สถานีหาย” และ “อื่นๆ” ต้องระบุรายละเอียด
      </p>

      <div className="mt-2.5 flex flex-col gap-2.5">
        {rows.map((w) => {
          const issue = (showIssues ? issues.works[w.id] : undefined) ?? {};
          const parsed = parseStationNumbers(w.noText);
          const n = parsed.ok ? parsed.numbers.length : 0;
          const needsDetail = w.kind === "lost" || w.kind === "other";
          return (
            <div key={w.id} className="rounded-lg border border-border bg-surface-2 p-2.5">
              <div className="flex flex-wrap items-start gap-2">
                <select
                  aria-label="ประเภทงาน"
                  value={w.kind}
                  onChange={(e) => update(w.id, { kind: e.target.value as WorkKind })}
                  className={cx(INPUT, "w-[190px]")}
                >
                  <optgroup label="งานซ่อม">
                    {REPAIR_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="เพิ่มสถานี (ฝังเพิ่ม — ไม่ใช่งานซ่อม)">
                    <option value="added">{KIND_LABEL.added}</option>
                  </optgroup>
                </select>
                <select
                  aria-label="ชนิดสถานี"
                  value={w.type}
                  onChange={(e) => update(w.id, { type: e.target.value as "IG" | "IC" })}
                  className={cx(INPUT, "w-[70px]")}
                >
                  <option>IG</option>
                  <option>IC</option>
                </select>
                <input
                  aria-label="เลขสถานี (หลายเลขคั่นด้วยจุลภาค หรือช่วงด้วยขีด)"
                  placeholder={w.kind === "added" ? "เช่น 81-85 (เลขสถานีใหม่)" : "เช่น 3, 5, 8-12"}
                  value={w.noText}
                  onChange={(e) => update(w.id, { noText: e.target.value })}
                  className={cx(INPUT, "num w-[210px]", issue.no && INVALID)}
                  aria-invalid={issue.no ? true : undefined}
                />
                <span className="self-center text-[12.5px] text-fg-muted num">
                  {n} สถานี <span className={STATION_TYPE_TAG}>อัตโนมัติ</span>
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  className="ml-auto"
                  onClick={() => onChange({ works: form.works.filter((x) => x.id !== w.id) })}
                >
                  ลบ
                </Button>
              </div>
              <input
                aria-label="รายละเอียดงาน"
                placeholder={
                  w.kind === "lost"
                    ? "ระบุ เช่น สถานีหาย อุปกรณ์ไม่พอซ่อมรอบนี้ (จำเป็น)"
                    : w.kind === "other"
                      ? "ระบุว่าเกิดอะไรขึ้น (จำเป็น)"
                      : "รายละเอียด (ไม่บังคับ)"
                }
                value={w.detail}
                onChange={(e) => update(w.id, { detail: e.target.value })}
                className={cx(INPUT, "mt-2", needsDetail && "border-warn", issue.detail && INVALID)}
                aria-invalid={issue.detail ? true : undefined}
              />
              {issue.no ? <p className={cx(ERROR_TEXT, "mt-1")}>{issue.no}</p> : null}
              {issue.detail ? <p className={cx(ERROR_TEXT, "mt-1")}>{issue.detail}</p> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => add("cap_replaced")}>
          + เพิ่มงานซ่อม
        </Button>
        <Button size="sm" onClick={() => add("added")}>
          + ฝังสถานีเพิ่ม
        </Button>
      </div>
    </section>
  );
}
