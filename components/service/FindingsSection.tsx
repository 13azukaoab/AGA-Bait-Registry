"use client";

/**
 * FindingsSection — หมวด "พบปลวก" และ "เปลี่ยนไม้ล่อ" (IG/IC · กรอกแบบ exception ตั้งต้นว่าทุกจุดปกติ)
 *
 *   * พบปลวก: ชนิด IG/IC + เลขสถานี (ตัวเลขเดียว) + ชนิดปลวก
 *       - ปลวกใต้ดิน (ชิปสีฟ้า) = ใส่เหยื่อ (0–200 หรือมากกว่า 200 พิมพ์เอง หาร 50) + % การกินเหยื่อ (ไม่บังคับ)
 *       - ปลวกสวน = เคมีผง จำนวนจุด ≥ 1 → แปลงกรัม 0.3 ก./จุด
 *   * เปลี่ยนไม้: ชนิด + เลขสถานี (หลายเลข/ช่วง "3, 5, 8-12") → ไม้ IG ×2 · IC ×1 ชิ้น (คำนวณเอง)
 *   * สถานีเดียวกันอยู่ได้ทั้งสองหมวด (ตอนบันทึกรวมเป็นผลตรวจแถวเดียว — ดู buildPayload.ts)
 */
import { Button, Chip } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import { parseStationNumbers } from "@/lib/service/stationNumbers";

import { BaitField } from "./BaitField";
import { resolveBait, resolvePowder, EATEN_OPTIONS } from "./bait";
import { rowKey } from "./formState";
import {
  CHIP_SUBTERRANEAN,
  ERROR_TEXT,
  HINT,
  INPUT,
  INVALID,
  LABEL,
  SECTION,
  SECTION_TITLE,
  STATION_TYPE_TAG,
} from "./styles";
import type { EatenSelect, FindingRow, FormState, TimberRow } from "./types";
import type { FormIssues } from "./validate";

export function FindingsSection({
  form,
  issues,
  showIssues,
  onChange,
}: {
  form: FormState;
  issues: FormIssues;
  showIssues: boolean;
  onChange: (patch: Partial<FormState>) => void;
}) {
  const updateFinding = (key: string, patch: Partial<FindingRow>) =>
    onChange({ findings: form.findings.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
  const updateTimber = (key: string, patch: Partial<TimberRow>) =>
    onChange({ timbers: form.timbers.map((t) => (t.key === key ? { ...t, ...patch } : t)) });

  let under = 0;
  let garden = 0;
  let baitTotal = 0;
  let points = 0;
  for (const f of form.findings) {
    if (f.group === "garden") {
      garden += 1;
      const p = resolvePowder(f.powderText);
      if (p.status === "ok") points += p.points;
    } else if (f.group === "subterranean") {
      under += 1;
      const b = resolveBait(f.baitSelect, f.baitCustom);
      if (b.status === "ok") baitTotal += b.grams;
    }
  }

  let timberPieces = 0;
  let timberCount = 0;
  for (const t of form.timbers) {
    const parsed = parseStationNumbers(t.noText);
    if (!parsed.ok) continue;
    timberCount += parsed.numbers.length;
    timberPieces += parsed.numbers.length * (t.type === "IG" ? 2 : 1);
  }

  return (
    <>
      <section data-field="findings" aria-label="พบปลวก" className={SECTION} hidden={!form.findings.length && form.normal}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={SECTION_TITLE}>พบปลวก</h3>
          <Chip tone="ok">ที่เหลือปกติ</Chip>
          <span className={CHIP_SUBTERRANEAN}>ปลวกใต้ดิน {under} จุด</span>
          <Chip tone="pend">ปลวกสวน {garden} จุด</Chip>
          <Chip tone="na">เหยื่อรวม {baitTotal} ก.</Chip>
          <Chip tone="na">
            เคมีผง {points} จุด ({Math.round(points * 0.3 * 100) / 100} ก.)
          </Chip>
        </div>
        <p className={HINT}>
          ตั้งต้นว่าจุดอื่นปกติ — เพิ่มเฉพาะจุดที่พบ: เลือก IG/IC + พิมพ์เลขสถานี แล้วเลือกชนิดปลวก ·{" "}
          <b>ใต้ดิน</b> = ใส่เหยื่อ · <b>สวน</b> = เคมีผง กรอกจำนวนจุด (0.3 ก./จุด)
        </p>

        <div className="mt-2.5 flex flex-col gap-2.5">
          {form.findings.map((f) => {
            const issue = (showIssues ? issues.findings[f.key] : undefined) ?? {};
            return (
              <div key={f.key} className="rounded-lg border border-border bg-surface-2 p-2.5">
                <div className="flex flex-wrap items-start gap-2.5">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${f.key}-no`} className={LABEL}>
                      สถานี
                    </label>
                    <div className="flex items-center gap-1">
                      <select
                        aria-label="ชนิดสถานี"
                        value={f.type}
                        onChange={(e) => updateFinding(f.key, { type: e.target.value as "IG" | "IC" })}
                        className={cx(INPUT, "w-[70px]")}
                      >
                        <option>IG</option>
                        <option>IC</option>
                      </select>
                      <input
                        id={`${f.key}-no`}
                        inputMode="numeric"
                        placeholder="เลขสถานี"
                        value={f.noText}
                        onChange={(e) => updateFinding(f.key, { noText: e.target.value })}
                        className={cx(INPUT, "num w-[100px]", issue.no && INVALID)}
                        aria-invalid={issue.no ? true : undefined}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${f.key}-group`} className={LABEL}>
                      ชนิดปลวก
                    </label>
                    <select
                      id={`${f.key}-group`}
                      value={f.group}
                      onChange={(e) =>
                        updateFinding(f.key, { group: e.target.value as FindingRow["group"] })
                      }
                      className={cx(INPUT, issue.group && INVALID)}
                    >
                      <option value="" disabled>
                        — เลือก —
                      </option>
                      <option value="subterranean">ปลวกใต้ดิน</option>
                      <option value="garden">ปลวกสวน</option>
                    </select>
                  </div>

                  {f.group === "subterranean" ? (
                    <>
                      <BaitField
                        label="ปริมาณเหยื่อ"
                        idPrefix={f.key}
                        select={f.baitSelect}
                        custom={f.baitCustom}
                        error={issue.bait}
                        onChange={(v) => updateFinding(f.key, { baitSelect: v.select, baitCustom: v.custom })}
                      />
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`${f.key}-eat`} className={LABEL}>
                          การกินเหยื่อ <span className="text-fg-faint">(ไม่บังคับ)</span>
                        </label>
                        <select
                          id={`${f.key}-eat`}
                          value={f.eaten}
                          onChange={(e) => updateFinding(f.key, { eaten: e.target.value as EatenSelect })}
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
                    </>
                  ) : null}

                  {f.group === "garden" ? (
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${f.key}-powder`} className={LABEL}>
                        เคมีผง (จุด)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id={`${f.key}-powder`}
                          type="number"
                          min={1}
                          inputMode="numeric"
                          placeholder="จำนวนจุด"
                          value={f.powderText}
                          onChange={(e) => updateFinding(f.key, { powderText: e.target.value })}
                          className={cx(INPUT, "num w-[110px]", issue.powder && INVALID)}
                        />
                        <span className="text-[12px] text-fg-muted num">
                          {(() => {
                            const p = resolvePowder(f.powderText);
                            return p.status === "ok" ? `× 0.3 = ${p.grams} ก.` : "× 0.3 ก./จุด";
                          })()}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <Button
                    variant="danger"
                    size="sm"
                    className="ml-auto self-end"
                    onClick={() => onChange({ findings: form.findings.filter((x) => x.key !== f.key) })}
                  >
                    ลบ
                  </Button>
                </div>
                {issue.no ? <p className={cx(ERROR_TEXT, "mt-1")}>{issue.no}</p> : null}
                {issue.group ? <p className={cx(ERROR_TEXT, "mt-1")}>{issue.group}</p> : null}
                {issue.powder ? <p className={cx(ERROR_TEXT, "mt-1")}>{issue.powder}</p> : null}
              </div>
            );
          })}
        </div>
        <div className="mt-2.5">
          <Button
            size="sm"
            onClick={() =>
              onChange({
                normal: false,
                findings: [
                  ...form.findings,
                  {
                    key: rowKey("f"),
                    type: "IG",
                    noText: "",
                    group: "",
                    baitSelect: "",
                    baitCustom: "",
                    eaten: "",
                    powderText: "",
                  },
                ],
              })
            }
          >
            + เพิ่มจุดที่พบปลวก
          </Button>
        </div>
      </section>

      <section data-field="timbers" aria-label="เปลี่ยนไม้ล่อ" className={SECTION} hidden={!form.timbers.length && form.normal}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={SECTION_TITLE}>เปลี่ยนไม้ล่อ</h3>
          <Chip tone="info">
            เปลี่ยนไม้รวม {timberPieces} ชิ้น ({timberCount} สถานี)
          </Chip>
        </div>
        <p className={HINT}>
          พิมพ์เลขสถานีได้หลายเลขในแถวเดียว เช่น <b>3, 5, 8-12</b> · จำนวนไม้คำนวณเอง (IG = 2 ชิ้น · IC = 1 ชิ้น ต่อสถานี)
        </p>
        <div className="mt-2.5 flex flex-col gap-2">
          {form.timbers.map((t) => {
            const msg = showIssues ? issues.timbers[t.key] : undefined;
            const parsed = parseStationNumbers(t.noText);
            const n = parsed.ok ? parsed.numbers.length : 0;
            return (
              <div key={t.key} className="flex flex-wrap items-start gap-2 rounded-lg border border-border bg-surface-2 p-2.5">
                <select
                  aria-label="ชนิดสถานี"
                  value={t.type}
                  onChange={(e) => updateTimber(t.key, { type: e.target.value as "IG" | "IC" })}
                  className={cx(INPUT, "w-[70px]")}
                >
                  <option>IG</option>
                  <option>IC</option>
                </select>
                <input
                  aria-label="เลขสถานีที่เปลี่ยนไม้ (เช่น 3, 5, 8-12)"
                  placeholder="เช่น 3, 5, 8-12"
                  value={t.noText}
                  onChange={(e) => updateTimber(t.key, { noText: e.target.value })}
                  className={cx(INPUT, "num w-[200px]", msg && INVALID)}
                  aria-invalid={msg ? true : undefined}
                />
                <span className="self-center text-[12.5px] text-fg-muted num">
                  {n} สถานี · {n * (t.type === "IG" ? 2 : 1)} ชิ้น <span className={STATION_TYPE_TAG}>อัตโนมัติ</span>
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  className="ml-auto"
                  onClick={() => onChange({ timbers: form.timbers.filter((x) => x.key !== t.key) })}
                >
                  ลบ
                </Button>
                {msg ? <p className={cx(ERROR_TEXT, "basis-full")}>{msg}</p> : null}
              </div>
            );
          })}
        </div>
        <div className="mt-2.5">
          <Button
            size="sm"
            onClick={() =>
              onChange({ normal: false, timbers: [...form.timbers, { key: rowKey("t"), type: "IG", noText: "" }] })
            }
          >
            + เพิ่มสถานีที่เปลี่ยนไม้
          </Button>
        </div>
      </section>
    </>
  );
}
