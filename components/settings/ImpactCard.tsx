"use client";

/**
 * การ์ด "ผลกระทบต่อสัญญาที่ใช้งานอยู่" ของแท็บเกณฑ์ Tier (mockup FINAL settings.html · M38 · DECISIONS 2.74)
 *
 * Logic summary:
 *   * `useTierImpact` เรียก server action `previewTierRuleChangeAction` (RPC `preview_tier_rule_change` · host เท่านั้น · ดูอย่างเดียว)
 *     เมื่อร่างเกณฑ์ "ถูกต้องและต่างจากที่บันทึกไว้" เท่านั้น · หน่วง 400 ms กันยิงถี่ตอนพิมพ์ ·
 *     คำตอบที่มาช้ากว่าคำขอใหม่ถูกทิ้ง (cancelled flag — server action ยกเลิกกลางทางไม่ได้)
 *   * สถานะ loading/idle/ready/error "คำนวณจาก key" (เดือน+ร่างเกณฑ์) ไม่ setState ใน effect — key เปลี่ยน = กำลังคำนวณทันที
 *   * แสดงตัวเลขรวมต่อ Tier (ก่อน/หลัง/ต่าง) + คู่ที่ย้าย Tier แยก 1 ปี/3 ปี · **ไม่มีชื่อลูกค้า/เลขสัญญา**
 *   * ป้าย "ตัวเลขประมาณ": นับทุกสัญญาที่ยังไม่ถูกยกเลิกและมีเดือนบริการตั้งแต่เดือนที่เลือก (DECISIONS 2.74)
 *     ถ้ามีชุดเกณฑ์ล่วงหน้าหลังเดือนนั้นอยู่แล้ว เกณฑ์ใหม่มีผลแค่ถึงก่อนชุดนั้น
 */
import { useEffect, useState } from "react";

import { Alert, Chip, TierBadge, cx } from "@/components/ui";
import { monthLabel } from "@/lib/service/months";

import { previewTierRuleChangeAction } from "./settingsActions";
import { Card, MOBILE_INPUT } from "./parts";
import { summarizeImpact, type ImpactSummary, type TierThresholds } from "./tierLogic";

export type ImpactState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; summary: ImpactSummary }
  | { status: "error"; message: string };

type Settled = { key: string; state: { status: "ready"; summary: ImpactSummary } | { status: "error"; message: string } };

const DEBOUNCE_MS = 400;
const FAILED = "คำนวณผลกระทบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

/** `draft` = null เมื่อร่างยังไม่ถูกต้อง · `enabled` = ร่างต่างจากที่บันทึกไว้ */
export function useTierImpact(args: { month: string; draft: TierThresholds | null; enabled: boolean }): ImpactState {
  const { month, draft, enabled } = args;
  const m = draft?.m ?? null;
  const l = draft?.l ?? null;
  const xl = draft?.xl ?? null;
  const key = enabled && m !== null && l !== null && xl !== null ? `${month}|${m}|${l}|${xl}` : null;
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (key === null || m === null || l === null || xl === null) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      let next: Settled["state"];
      try {
        const res = await previewTierRuleChangeAction({ effectiveMonth: month, m, l, xl });
        next = res.ok ? { status: "ready", summary: summarizeImpact(res.rows) } : { status: "error", message: res.message };
      } catch {
        next = { status: "error", message: FAILED };
      }
      if (!cancelled) setSettled({ key, state: next });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, month, m, l, xl]);

  if (key === null) return { status: "idle" };
  if (settled?.key === key) return settled.state;
  return { status: "loading" };
}

export function ImpactCard({
  state,
  month,
  monthOptions,
  currentMonth,
  draftValid,
  onMonthChange,
}: {
  state: ImpactState;
  month: string;
  monthOptions: readonly string[];
  currentMonth: string;
  draftValid: boolean;
  onMonthChange: (m: string) => void;
}) {
  return (
    <Card title="ผลกระทบต่อสัญญาที่ใช้งานอยู่" sub="นับก่อนบันทึก · ไม่แสดงชื่อลูกค้า">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <label htmlFor="impact-month" className="text-xs text-fg-muted">
          นับตั้งแต่เดือน
        </label>
        <select
          id="impact-month"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className={cx(
            "rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            MOBILE_INPUT,
          )}
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
              {m === currentMonth ? " (เดือนนี้)" : ""}
            </option>
          ))}
        </select>
        <Chip tone="pend" className="ml-auto">ตัวเลขประมาณ</Chip>
      </div>

      <div aria-live="polite">
        {state.status === "idle" ? (
          <p className="m-0 px-4 py-5 text-center text-[13px] text-fg-muted">
            {draftValid
              ? "ยังไม่มีการแก้เกณฑ์ — แก้ตัวเลขแล้วระบบจะคำนวณผลกระทบให้"
              : "แก้ตัวเลขให้ถูกต้องก่อน ระบบจึงคำนวณผลกระทบให้ได้"}
          </p>
        ) : null}
        {state.status === "loading" ? (
          <p role="status" className="m-0 px-4 py-5 text-center text-[13px] text-fg-muted">
            กำลังคำนวณผลกระทบ…
          </p>
        ) : null}
        {state.status === "error" ? (
          <div className="p-4">
            <Alert variant="danger">{state.message}</Alert>
          </div>
        ) : null}
        {state.status === "ready" ? <ImpactResult summary={state.summary} /> : null}
      </div>

      <p className="m-0 border-t border-border px-4 py-2.5 text-xs text-fg-muted">
        ตัวเลขประมาณ: นับทุกสัญญาที่ยังไม่ถูกยกเลิกและยังมีเดือนบริการตั้งแต่เดือนที่เลือก · ถ้ามีชุดเกณฑ์ล่วงหน้าหลังเดือนนั้นอยู่แล้ว
        เกณฑ์ใหม่มีผลแค่ถึงก่อนชุดนั้น
      </p>
    </Card>
  );
}

function ImpactResult({ summary }: { summary: ImpactSummary }) {
  return (
    <>
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-xs text-fg-muted">
              <th scope="col" className="px-4 py-2 font-medium">Tier</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">ตอนนี้</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">หลังแก้</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">ต่าง</th>
            </tr>
          </thead>
          <tbody>
            {summary.perTier.map((r) => (
              <tr key={r.tier} className="border-t border-border">
                <td className="px-4 py-2">
                  <TierBadge tier={r.tier} years={1} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.before}</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.after}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.diff === 0 ? (
                    <span className="text-fg-muted">—</span>
                  ) : (
                    <span className={r.diff > 0 ? "text-ok" : "text-danger"}>
                      {r.diff > 0 ? "+" : ""}
                      {r.diff}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-4 py-3">
        {summary.moved > 0 ? (
          <>
            <Chip tone="pend">⚠ {summary.moved} สัญญาจะเปลี่ยน Tier</Chip>
            <ul className="m-0 mt-2.5 list-none space-y-1.5 p-0 text-[13px]">
              {summary.moves.flatMap((mv) =>
                ([1, 3] as const)
                  .map((years) => ({ years, count: years === 3 ? mv.y3 : mv.y1 }))
                  .filter((x) => x.count > 0)
                  .map(({ years, count }) => (
                    <li key={`${mv.from}-${mv.to}-${years}`} className="flex flex-wrap items-center gap-1.5">
                      <TierBadge tier={mv.from} years={years} />
                      <span aria-hidden="true">→</span>
                      <TierBadge tier={mv.to} years={years} />
                      <b className="tabular-nums">{count}</b> สัญญา
                      <span className="text-xs text-fg-muted">{years === 3 ? "(3 ปี)" : "(1 ปี / Custom)"}</span>
                    </li>
                  )),
              )}
            </ul>
          </>
        ) : (
          <Chip tone="ok">✓ ไม่มีสัญญาเปลี่ยน Tier</Chip>
        )}
        <p className="m-0 mt-2 text-xs text-fg-muted">รวมที่นับ {summary.total} สัญญา</p>
      </div>
    </>
  );
}
