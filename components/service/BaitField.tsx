"use client";

/**
 * BaitField — ปริมาณเหยื่อ: เลือก 0–200 ก. หรือ "มากกว่า 200 (พิมพ์เอง)" (หาร 50 ลงตัว ไม่เกิน 5,000)
 * ใช้ร่วมกันระหว่างแถว "พบปลวก" (ปลวกใต้ดิน) และกล่อง AG
 */
import { cx } from "@/components/ui/cx";

import { BAIT_CUSTOM_HINT, BAIT_OPTIONS } from "./bait";
import { ERROR_TEXT, INPUT, INVALID } from "./styles";
import type { BaitSelect } from "./types";

export function BaitField({
  label,
  idPrefix,
  select,
  custom,
  error,
  disabled,
  onChange,
}: {
  label: string;
  idPrefix: string;
  select: BaitSelect;
  custom: string;
  error?: string;
  disabled?: boolean;
  onChange: (next: { select: BaitSelect; custom: string }) => void;
}) {
  return (
    <div className="flex min-w-[130px] flex-col gap-1">
      <label htmlFor={`${idPrefix}-bait`} className="text-[11px] text-fg-muted">
        {label}
      </label>
      <select
        id={`${idPrefix}-bait`}
        value={select}
        disabled={disabled}
        onChange={(e) => onChange({ select: e.target.value as BaitSelect, custom: "" })}
        className={cx(INPUT, error && INVALID)}
        aria-invalid={error ? true : undefined}
      >
        <option value="" disabled>
          — เลือก —
        </option>
        {BAIT_OPTIONS.map((g) => (
          <option key={g} value={String(g)}>
            {g} ก.
          </option>
        ))}
        <option value="other">มากกว่า 200 (พิมพ์เอง)</option>
      </select>
      {select === "other" ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={250}
            max={5000}
            step={50}
            inputMode="numeric"
            placeholder="เช่น 250"
            aria-label={`${label} (ก.) พิมพ์เอง`}
            value={custom}
            disabled={disabled}
            onChange={(e) => onChange({ select, custom: e.target.value })}
            className={cx(INPUT, "num", error && INVALID)}
          />
          <span className="text-[12px] text-fg-muted">ก.</span>
        </div>
      ) : null}
      {error ? <p className={ERROR_TEXT}>{select === "other" ? BAIT_CUSTOM_HINT : error}</p> : null}
    </div>
  );
}
