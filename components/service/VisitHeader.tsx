"use client";

/**
 * VisitHeader — ทีมที่เข้า · วันที่ · เวลาเข้า/ออก (24 ชม.) · เวลาทำงานจริง (คำนวณเอง)
 * (SPEC v1.8 §8.1) พิมพ์เวลาเป็นเลขล้วนได้ (1445 → 14:45) · พิมพ์เวลาเข้าครบแล้วเลื่อนไปช่องเวลาออกให้เอง
 *
 * ไม่มีช่อง "ประเภทการเข้า" ให้เลือก (DECISIONS 2.38 ง): หน้าจริงตั้ง `visit_type` ให้เอง
 * (/service = routine · /bait = follow_up) · แก้การเข้าเดิมที่เป็นประเภทอื่น (เช่น แก้ปัญหา) คงชนิดเดิม แสดงเป็นข้อความอ่านอย่างเดียว
 * `dateLabel` ใช้ได้ (หน้า /bait เรียก "วันที่เข้าจริง (ตามใบงาน)")
 */
import { useRef } from "react";

import { cx } from "@/components/ui/cx";

import { INPUT, INVALID, LABEL } from "./styles";
import { TeamSelect } from "./TeamSelect";
import { formatDuration, formatTimeInput, isValidTime, workTime } from "./timeInput";
import type { FormState, TeamOption, VisitType } from "./types";
import type { FormIssues } from "./validate";

const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  routine: "บริการประจำเดือน",
  problem: "แก้ปัญหา",
  follow_up: "ติดตามผล",
};

export function VisitHeader({
  form,
  teams,
  issues,
  showIssues,
  teamHint,
  dateLabel = "วันที่เข้า",
  dateHint,
  showVisitTypeNote = true,
  onChange,
}: {
  form: FormState;
  teams: readonly TeamOption[];
  issues: FormIssues;
  /** แสดงกรอบแดงหลังกด "บันทึก" ครั้งแรก */
  showIssues: boolean;
  teamHint: string;
  dateLabel?: string;
  dateHint?: string;
  /** แสดงข้อความประเภทการเข้าเมื่อไม่ใช่ routine (หน้า /bait ซ่อน เพราะเป็น follow_up เสมอ) */
  showVisitTypeNote?: boolean;
  onChange: (patch: Partial<FormState>) => void;
}) {
  const timeOutRef = useRef<HTMLInputElement>(null);
  const wt = workTime(form.timeIn, form.timeOut);
  const bad = (flag: boolean) => (showIssues && flag ? INVALID : "");

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="sv-team" className={LABEL}>
          ทีมที่เข้า
        </label>
        <TeamSelect
          id="sv-team"
          teams={teams}
          value={form.teamIds}
          onChange={(teamIds) => onChange({ teamIds })}
          invalid={showIssues && issues.header.teams}
        />
        <span className="text-[11px] text-fg-muted">{teamHint}</span>
      </div>

      <div className="flex flex-col gap-1" data-field="date">
        <label htmlFor="sv-date" className={LABEL}>
          {dateLabel}
        </label>
        <input
          id="sv-date"
          type="date"
          value={form.visitDate}
          onChange={(e) => onChange({ visitDate: e.target.value })}
          className={cx(INPUT, bad(issues.header.date))}
        />
        {dateHint ? <span className="text-[11px] text-fg-muted">{dateHint}</span> : null}
      </div>

      <div className="flex flex-col gap-1" data-field="timeIn">
        <label htmlFor="sv-time-in" className={LABEL}>
          เวลาเข้า (24 ชม.)
        </label>
        <input
          id="sv-time-in"
          type="text"
          inputMode="numeric"
          maxLength={5}
          autoComplete="off"
          placeholder="เช่น 09:30"
          value={form.timeIn}
          onChange={(e) => {
            const value = formatTimeInput(e.target.value);
            onChange({ timeIn: value });
            // เวลาเข้าครบและถูกต้อง → เลื่อนไปช่องเวลาออก
            if (isValidTime(value) && document.activeElement === e.target) {
              timeOutRef.current?.focus();
              timeOutRef.current?.select();
            }
          }}
          className={cx(INPUT, "num", bad(issues.header.timeIn))}
        />
      </div>

      <div className="flex flex-col gap-1" data-field="timeOut">
        <label htmlFor="sv-time-out" className={LABEL}>
          เวลาออก (24 ชม.)
        </label>
        <input
          id="sv-time-out"
          ref={timeOutRef}
          type="text"
          inputMode="numeric"
          maxLength={5}
          autoComplete="off"
          placeholder="เช่น 14:45"
          value={form.timeOut}
          onChange={(e) => onChange({ timeOut: formatTimeInput(e.target.value) })}
          className={cx(INPUT, "num", bad(issues.header.timeOut))}
        />
      </div>

      <div className="flex flex-col gap-1 sm:col-span-1 xl:col-span-2">
        <span className={LABEL}>
          เวลาทำงานจริง (คำนวณเอง)
          {showVisitTypeNote && form.visitType !== "routine" ? (
            <> · ประเภทการเข้า: {VISIT_TYPE_LABEL[form.visitType]}</>
          ) : null}
        </span>
        <div
          aria-live="polite"
          className={cx(
            "rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[13px]",
            wt.status === "badFormat" || wt.status === "notAfter" ? "border-danger text-danger" : "text-fg",
          )}
        >
          {wt.status === "empty" ? (
            <span className="text-fg-faint">กรอกเวลาเข้า–ออก</span>
          ) : wt.status === "badFormat" ? (
            "กรอกเวลาให้ครบรูปแบบ 24 ชม. เช่น 09:30"
          ) : wt.status === "notAfter" ? (
            "เวลาออกต้องหลังเวลาเข้า"
          ) : (
            <b className="num">{formatDuration(wt.minutes)}</b>
          )}
        </div>
      </div>
    </div>
  );
}
