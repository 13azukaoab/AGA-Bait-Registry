"use client";

/**
 * แท็บ "เกณฑ์ Tier" (mockup FINAL settings.html · M20/M25)
 *
 * Logic summary:
 *   * เกณฑ์ทุกตัวมาจาก `tier_rules` (props.data.ruleSets) — ร่างที่กำลังแก้เริ่มจากชุดที่ใช้กับ "เดือนปัจจุบัน"
 *     "คืนค่าเริ่มต้น" = ชุดตั้งต้น (เก่าสุดใน tier_rules) ไม่ใช่เลขตายตัว
 *   * ตัวอย่างตรวจสอบ/ลองใส่มูลค่าเอง คำนวณสดด้วย `classify` (= tierOf + annualValueForTerm ของ lib/rules) กับร่างเกณฑ์
 *   * กดบันทึก → dialog เลือก "เดือนที่เริ่มใช้" (เฉพาะเดือนที่ยังไม่ถูกปิด/ก่อน go-live) + เหตุผล + พิมพ์ "ยืนยันแก้ไข"
 *     → server action `saveTierRuleSetAction` (RPC save_tier_rule_set) · เดือนที่ปิดแล้วคงเกณฑ์เดิมโดย DB (TR002)
 *   * ⚠ ต่างจาก mockup: ไม่มีการ์ด "ผลกระทบต่อสัญญาที่ใช้งานอยู่" (mockup ใช้ข้อมูลสมมติ · ของจริงต้องมี RPC นับสัญญาต่อ Tier — แจ้งในรายงาน)
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Modal } from "@/components/customers-new/Modal";
import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { Alert, Button, Chip, Field, TierBadge, cx } from "@/components/ui";
import { monthLabel } from "@/lib/service/months";

import { saveTierRuleSetAction } from "./settingsActions";
import type { SettingsData } from "./settingsData";
import { Card, ConfirmField, DialogError, DialogFooter, MOBILE_BTN, MOBILE_INPUT } from "./parts";
import {
  CONFIRM_PHRASE,
  SAMPLE_CONTRACTS,
  classify,
  effectiveMonthOptions,
  endMonthOf,
  formatMoney,
  isDraftValid,
  parseMoney,
  rangeEnds,
  sameThresholds,
  setForMonth,
  statusOf,
  validateSaveForm,
  validateTierDraft,
  type TierDraft,
  type TierThresholds,
} from "./tierLogic";

type Texts = { m: string; l: string; xl: string };

const STATUS_LABEL = { current: "ใช้อยู่ตอนนี้", upcoming: "จะเริ่มใช้", past: "ใช้ไปแล้ว" } as const;

function toTexts(t: TierThresholds): Texts {
  return { m: formatMoney(t.m), l: formatMoney(t.l), xl: formatMoney(t.xl) };
}

export function TierTab({ data, onToast }: { data: SettingsData; onToast: (m: string) => void }) {
  const { ruleSets, currentMonth } = data;
  const baseline = ruleSets[0]!;
  const saved = (setForMonth(ruleSets, currentMonth) ?? ruleSets[ruleSets.length - 1]!).thresholds;

  const [texts, setTexts] = useState<Texts>(toTexts(saved));
  const [saving, setSaving] = useState(false);

  const draft: TierDraft = { m: parseMoney(texts.m), l: parseMoney(texts.l), xl: parseMoney(texts.xl) };
  const errors = validateTierDraft(draft);
  const valid = isDraftValid(draft);
  const dirty = !sameThresholds(draft, saved);
  useUnsavedWork(dirty);

  const ends = valid ? rangeEnds(draft) : null;
  const preview: TierThresholds | null = valid ? { m: draft.m!, l: draft.l!, xl: draft.xl! } : null;
  const current = setForMonth(ruleSets, currentMonth);

  const field = (key: keyof Texts, label: string) => (
    <div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={`จุดเริ่ม Tier ${label} (บาทต่อปี)`}
          aria-invalid={errors[key] ? true : undefined}
          aria-describedby={errors[key] ? `er-${key}` : undefined}
          value={texts[key]}
          onChange={(e) => setTexts((t) => ({ ...t, [key]: e.target.value }))}
          onBlur={() => {
            const n = parseMoney(texts[key]);
            if (n !== null) setTexts((t) => ({ ...t, [key]: formatMoney(n) }));
          }}
          className={cx(
            "w-[150px] min-w-0 rounded-lg border bg-surface px-2.5 py-1.5 text-right text-[13px] tabular-nums text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            MOBILE_INPUT,
            errors[key] ? "border-danger" : "border-border-strong",
          )}
        />
        <span className="text-xs text-fg-muted">บาท</span>
      </div>
      {errors[key] ? (
        <div id={`er-${key}`} role="alert" className="mt-1 text-xs text-danger">
          {errors[key]}
        </div>
      ) : null}
      {valid && draft[key] !== saved[key] ? (
        <div className="mt-1 text-xs text-fg-muted">เดิม {formatMoney(saved[key])}</div>
      ) : null}
    </div>
  );

  const tiers = [
    { tier: "S" as const, from: <span className="tabular-nums">0 <Chip tone="na">ค่าคงที่</Chip></span>, to: ends ? formatMoney(ends.s) : "—" },
    { tier: "M" as const, from: field("m", "M"), to: ends ? formatMoney(ends.m) : "—" },
    { tier: "L" as const, from: field("l", "L"), to: ends ? formatMoney(ends.l) : "—" },
    { tier: "XL" as const, from: field("xl", "XL"), to: "ไม่จำกัด" },
  ];

  return (
    <div>
      <div role="status" className="mb-3 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-[13px]">
        {current ? (
          <>
            เกณฑ์ที่ใช้อยู่ตอนนี้ ({monthLabel(currentMonth)}):{" "}
            <b>
              M ตั้งแต่ {formatMoney(current.thresholds.m)} · L ตั้งแต่ {formatMoney(current.thresholds.l)} · XL ตั้งแต่{" "}
              {formatMoney(current.thresholds.xl)}
            </b>{" "}
            บาท/ปี
          </>
        ) : (
          "ยังไม่พบเกณฑ์ที่ใช้กับเดือนปัจจุบัน"
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4 max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Card title="เกณฑ์แบ่ง Tier" sub="มูลค่าต่อปี = มูลค่าสัญญา ÷ จำนวนปี">
            <p className="m-0 px-4 pb-1.5 pt-3 text-[13px] text-fg-muted">
              แก้เฉพาะ <b className="text-fg">จุดเริ่มของ M, L, XL</b> — ปลายช่วงของ Tier ก่อนหน้าระบบคำนวณให้
              (จุดเริ่มถัดไป − 0.01) จึงไม่มีช่องว่างหรือช่วงทับกัน
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-surface-2 text-left text-xs text-fg-muted">
                    <th scope="col" className="px-4 py-2 font-medium">Tier</th>
                    <th scope="col" className="px-4 py-2 font-medium">ตั้งแต่ (บาท/ปี)</th>
                    <th scope="col" className="px-4 py-2 font-medium">ถึง (บาท/ปี)</th>
                    <th scope="col" className="px-4 py-2 font-medium">ป้ายในระบบ</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((r) => (
                    <tr key={r.tier} className="border-t border-border align-top">
                      <td className="px-4 py-2.5 font-semibold" style={{ color: `var(--tier-${r.tier.toLowerCase()}-ink)` }}>
                        {r.tier}
                      </td>
                      <td className="px-4 py-2.5">{r.from}</td>
                      <td className="px-4 py-2.5 tabular-nums">{r.to}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex gap-1.5">
                          <TierBadge tier={r.tier} years={1} />
                          <TierBadge tier={r.tier} years={3} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview ? <ScaleBar t={preview} /> : null}
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              {dirty ? (
                <Chip tone="pend">● มีการแก้ที่ยังไม่บันทึก</Chip>
              ) : (
                <Chip tone="ok">✓ ตรงกับที่บันทึกไว้</Chip>
              )}
              <span className="ml-auto flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className={MOBILE_BTN}
                  title="คืนเป็นเกณฑ์ชุดตั้งต้นของระบบ (ยังไม่บันทึกจนกว่าจะกดบันทึก)"
                  onClick={() => {
                    setTexts(toTexts(baseline.thresholds));
                    onToast("คืนเป็นเกณฑ์ชุดตั้งต้นแล้ว (ยังไม่บันทึก)");
                  }}
                >
                  คืนค่าเริ่มต้น
                </Button>
                <Button size="sm" className={MOBILE_BTN} disabled={!dirty} onClick={() => setTexts(toTexts(saved))}>
                  ยกเลิกการแก้
                </Button>
                <Button variant="save" disabled={!valid || !dirty} onClick={() => setSaving(true)}>
                  บันทึกเกณฑ์…
                </Button>
              </span>
            </div>
          </Card>

          <Samples t={preview} />
        </div>

        <div className="flex flex-col gap-4">
          <Card title="เกณฑ์ที่ใช้ในแต่ละช่วงเดือน" sub="เริ่มใช้ตั้งแต่เดือนไหน · ประวัติการแก้">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-surface-2 text-left text-xs text-fg-muted">
                    <th scope="col" className="px-3 py-2 font-medium">ใช้ตั้งแต่</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">M เริ่ม</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">L เริ่ม</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">XL เริ่ม</th>
                    <th scope="col" className="px-3 py-2 font-medium">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ruleSets].reverse().map((s) => {
                    const end = endMonthOf(s, ruleSets);
                    const st = statusOf(s, ruleSets, currentMonth);
                    const closed = data.lastClosedMonth !== null && s.month <= data.lastClosedMonth;
                    return (
                      <tr key={s.month} className="border-t border-border align-top">
                        <td className="px-3 py-2">
                          <b>{s.isBaseline ? "ชุดตั้งต้น" : monthLabel(s.month)}</b>
                          <small className="block text-xs text-fg-muted">
                            {end ? `ถึง ${monthLabel(end)}` : "ใช้เรื่อยไปจนกว่าจะมีชุดใหม่"}
                            {closed ? " · รวมเดือนที่ปิดแล้ว" : ""}
                          </small>
                          {s.reason ? <small className="block text-xs text-fg-muted">เหตุผล: {s.reason}</small> : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(s.thresholds.m)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(s.thresholds.l)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(s.thresholds.xl)}</td>
                        <td className="px-3 py-2">
                          <Chip tone={st === "current" ? "ok" : st === "upcoming" ? "info" : "na"}>{STATUS_LABEL[st]}</Chip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Alert variant="info">
            การเปลี่ยนเกณฑ์มีผลกับการคำนวณ Tier และตัวเลข snapshot ที่ส่งไป Dashboard —{" "}
            <b>เกณฑ์ใหม่มีผลตั้งแต่เดือนที่เลือกเป็นต้นไป</b> · เดือนที่ปิดแล้วคงเกณฑ์เดิม
            และตัวเลขที่ส่ง Dashboard ไปแล้วไม่เปลี่ยนจนกว่าจะสั่งคำนวณใหม่
          </Alert>
        </div>
      </div>

      {saving && preview ? (
        <SaveDialog
          data={data}
          saved={saved}
          next={preview}
          onClose={() => setSaving(false)}
          onSaved={(month) => {
            setSaving(false);
            onToast(`บันทึกเกณฑ์ใหม่แล้ว · เริ่มใช้ตั้งแต่ ${monthLabel(month)} · บันทึกลงประวัติการแก้ไข`);
          }}
        />
      ) : null}
    </div>
  );
}

/** แถบสัดส่วนช่วงมูลค่า (แสดงผลอย่างเดียว — XL ขยายเพื่อให้เห็นเป็นแถบ) */
function ScaleBar({ t }: { t: TierThresholds }) {
  const total = t.xl * 1.5;
  const seg = [
    { k: "S", w: t.m, cls: "bg-[var(--tier-s)]" },
    { k: "M", w: t.l - t.m, cls: "bg-[var(--tier-m)]" },
    { k: "L", w: t.xl - t.l, cls: "bg-[var(--tier-l)]" },
    { k: "XL", w: t.xl * 0.5, cls: "bg-[var(--tier-xl)]" },
  ];
  return (
    <div className="px-4 pb-3 pt-1">
      <div role="img" aria-label="แถบแสดงสัดส่วนช่วงมูลค่าของแต่ละ Tier" className="flex h-7 overflow-hidden rounded-md">
        {seg.map((s) => (
          <div
            key={s.k}
            className={cx("flex min-w-[28px] items-center justify-center text-xs font-semibold text-[var(--on-tier)]", s.cls)}
            style={{ width: `${(s.w / total) * 100}%` }}
          >
            {s.k}
          </div>
        ))}
      </div>
    </div>
  );
}

function Samples({ t }: { t: TierThresholds | null }) {
  const [value, setValue] = useState("75000");
  const [years, setYears] = useState<"1" | "3">("1");
  const v = parseMoney(value);
  const res = t && v !== null ? classify(v, Number(years) * 12, t) : null;
  return (
    <Card title="ตัวอย่างตรวจสอบ" sub="คำนวณสดจากเกณฑ์ที่กำลังแก้">
      {t ? (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2 p-4 text-[13px]">
          {SAMPLE_CONTRACTS.map((s) => {
            const r = classify(s.value, s.termMonths, t);
            return (
              <li key={`${s.value}-${s.termMonths}`} className="flex items-center gap-2">
                <span className="tabular-nums">
                  {formatMoney(s.value)} / {s.termMonths / 12} ปี
                </span>
                <span aria-hidden="true">→</span>
                <TierBadge tier={r.tier} years={s.termMonths === 36 ? 3 : 1} />
                <span className="text-xs text-fg-muted">(ปีละ {formatMoney(Math.round(r.annual * 100) / 100)})</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 p-4 text-[13px] text-fg-muted">แก้ค่าเกณฑ์ให้ถูกต้องก่อน จึงจะเห็นตัวอย่าง</p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <span className="w-full text-xs text-fg-muted">ลองใส่มูลค่าเอง</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label="มูลค่าสัญญา (บาท)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={cx(
            "w-[150px] rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            MOBILE_INPUT,
          )}
        />
        <span className="text-xs text-fg-muted">บาท ·</span>
        <select
          aria-label="ระยะสัญญา (ปี)"
          value={years}
          onChange={(e) => setYears(e.target.value as "1" | "3")}
          className={cx(
            "rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            MOBILE_INPUT,
          )}
        >
          <option value="1">1 ปี</option>
          <option value="3">3 ปี</option>
        </select>
        <span aria-live="polite" className="flex items-center gap-2 text-[13px]">
          {res ? (
            <>
              <TierBadge tier={res.tier} years={years === "3" ? 3 : 1} />
              <span className="text-xs text-fg-muted">ปีละ {formatMoney(Math.round(res.annual * 100) / 100)} บาท</span>
            </>
          ) : null}
        </span>
      </div>
    </Card>
  );
}

function SaveDialog({
  data,
  saved,
  next,
  onClose,
  onSaved,
}: {
  data: SettingsData;
  saved: TierThresholds;
  next: TierThresholds;
  onClose: () => void;
  onSaved: (month: string) => void;
}) {
  const router = useRouter();
  const options = useMemo(
    () =>
      effectiveMonthOptions({
        currentMonth: data.currentMonth,
        goLiveMonth: data.goLiveMonth,
        lastClosedMonth: data.lastClosedMonth,
        baselineMonth: data.ruleSets[0]?.month ?? null,
      }),
    [data],
  );
  const [month, setMonth] = useState(options[0] ?? data.currentMonth);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"month" | "reason" | "confirm", string>>>({});
  const [serverError, setServerError] = useState("");
  const [pending, startTransition] = useTransition();
  useUnsavedWork(reason !== "" || confirm !== "");

  const changes = (["m", "l", "xl"] as const).filter((k) => saved[k] !== next[k]);

  const submit = () => {
    const found = validateSaveForm({ month, options, reason, confirm });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setServerError("");
    startTransition(async () => {
      const res = await saveTierRuleSetAction({
        effectiveMonth: month,
        m: next.m,
        l: next.l,
        xl: next.xl,
        reason,
        confirm,
      });
      if (!res.ok) return setServerError(res.message);
      router.refresh();
      onSaved(month);
    });
  };

  return (
    <Modal title="บันทึกเกณฑ์ Tier" onClose={onClose}>
      <p className="m-0 mb-1.5 text-xs text-fg-muted">สิ่งที่จะเปลี่ยน</p>
      <ul className="m-0 mb-3 list-none space-y-1 p-0 text-[13px]">
        {changes.map((k) => (
          <li key={k}>
            จุดเริ่ม {k.toUpperCase()} <b className="tabular-nums">{formatMoney(saved[k])}</b> → <b className="tabular-nums">{formatMoney(next[k])}</b> บาท/ปี
          </li>
        ))}
        {changes.length === 0 ? <li>ไม่มีค่าที่เปลี่ยน</li> : null}
      </ul>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label="เริ่มใช้ตั้งแต่เดือน"
          error={errors.month}
          hint="เลือกได้เฉพาะเดือนที่ยังเปิด · เดือนที่ปิดแล้วและก่อนเริ่มใช้ระบบคงเกณฑ์เดิม"
        >
          {(c) => (
            <select {...c} className={cx(c.className, MOBILE_INPUT)} value={month} onChange={(e) => setMonth(e.target.value)}>
              {options.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {m === data.currentMonth ? " (เดือนนี้)" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Alert variant="warn">
          เกณฑ์ใหม่ส่งผลต่อตัวเลขที่ส่งไป Dashboard ตั้งแต่เดือนที่เลือก · เดือนก่อนหน้านั้นไม่เปลี่ยน
        </Alert>
        <Field label="เหตุผลในการแก้ (บังคับ — เก็บในประวัติการแก้ไข)" required error={errors.reason}>
          {(c) => (
            <textarea
              {...c}
              className={cx(c.className, MOBILE_INPUT, "min-h-[72px]")}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <ConfirmField phrase={CONFIRM_PHRASE} value={confirm} onChange={setConfirm} error={errors.confirm} />
        <DialogError message={serverError} />
        <DialogFooter>
          <Button className={MOBILE_BTN} onClick={onClose}>ยกเลิก</Button>
          <Button className={MOBILE_BTN} variant="primary" type="submit" loading={pending}>
            บันทึก
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
