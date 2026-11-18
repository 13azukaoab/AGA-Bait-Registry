"use client";

/**
 * หน้า "ส่งข้อมูล และสรุปงานประจำเดือน" ฝั่ง client (mockup FINAL `docs/mockup/month-closure.html`)
 *
 * Logic summary:
 *   * ซ้าย = รายการเดือน · ขวา = การ์ดคู่ ส่วนกลาง 24 สาขา / ต่างจังหวัด 19 สาขา (แต่ละส่วนปิดแยก)
 *   * ส่วนกลาง 2 ขั้น: ทบทวนตกบริการ → ยืนยันปิด · ต่างจังหวัด: ยืนยันปิดขั้นเดียว (ไม่มีทะเบียนให้ทบทวน)
 *   * ยืนยัน = พิมพ์ key เดือน (OCT.26) · ส่งแค่ {month, scope, confirmKey, overrideReason?, acknowledgeCarried?}
 *   * server ตัดสิน "ส่วนกลางพร้อม": ถ้ายังไม่พร้อมตอบ 409 พร้อมรายชื่อสาขา → host พิมพ์เหตุผลแล้วกดซ้ำ (ปิดข้าม) · recorder เห็นรายชื่อเท่านั้น
 *     ต่างจังหวัดมีสาขาใช้ค่ายกมา → 409 → ติ๊กรับทราบแล้วกดซ้ำ
 *   * ปิดสำเร็จแต่ส่ง Dashboard ไม่สำเร็จ = เดือนปิดแล้ว แสดงสถานะส่งแยก · คำนวณ snapshot ใหม่ = host เท่านั้น
 *   * "แก้หลังปิด" (list_post_close_edits) ซ่อนไว้จนกว่า BE ส่ง RPC — ดู PostCloseEdits + POST_CLOSE_EDITS_AVAILABLE
 *   * ซ่อนปุ่มตามสิทธิ์เฉยๆ — ความปลอดภัยจริงอยู่ที่ server/DB
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Button, Chip, Toast, cx } from "@/components/ui";
import { useUnsavedWork } from "@/components/shell/unsaved-work";

import { MissedReview } from "./MissedReview";
import { SyncStatusBox } from "./SyncStatusBox";
import { postClose, postResync, type BranchRef } from "./monthsApi";
import type { MonthsPageData } from "./monthsData";
import {
  POST_CLOSE_EDITS_AVAILABLE,
  SCOPE_BRANCHES,
  SCOPE_NAME,
  canCloseScope,
  canOverrideReady,
  canResync,
  closeFormError,
  confirmKeyFor,
  describeError,
  formatBangkok,
  syncLabel,
  tableLabelTh,
  type MonthEntry,
  type Scope,
  type ScopeState,
} from "./monthsLogic";

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function monthTh(month: string): string {
  return `${THAI_MONTHS[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
}

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={cx("size-4 flex-none", className)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const ICON_SEND = "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z";
const ICON_USERS = "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8";
const ICON_LOCK = "M5 11h14v10H5zM8 11V7a4 4 0 118 0v4";

function statusTone(s: ScopeState): "ok" | "pend" | "na" {
  return s.status === "closed" ? "ok" : s.status === "open" ? "pend" : "na";
}
function statusText(s: ScopeState): string {
  return s.status === "closed" ? "ปิดแล้ว" : s.status === "open" ? "รอปิด" : "ยังไม่จบ";
}

type Result = { scope: Scope; title: string; tone: "ok" | "warn" | "danger"; hint: string };

export function MonthsClient({ data }: { data: MonthsPageData }) {
  const router = useRouter();
  const firstOpen = data.months.find((m) => m.central.status === "open" || m.province.status === "open");
  const [sel, setSel] = useState<string>((firstOpen ?? data.months[0])?.month ?? "");
  const [scopeSel, setScopeSel] = useState<Scope | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState("");
  const [notReady, setNotReady] = useState<{ branches: BranchRef[]; canOverride: boolean } | null>(null);
  const [carried, setCarried] = useState<BranchRef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [toast, setToast] = useState("");

  const month: MonthEntry | undefined = data.months.find((m) => m.month === sel);
  const dirty = typed.trim() !== "" || reason.trim() !== "" || ack;
  useUnsavedWork(dirty);

  function resetForm() {
    setStep(1);
    setTyped("");
    setAck(false);
    setReason("");
    setNotReady(null);
    setCarried(null);
    setError("");
  }
  function pick(m: string) {
    if (busy) return;
    setSel(m);
    setScopeSel(null);
    setResult(null);
    resetForm();
  }
  function openScope(s: Scope) {
    setScopeSel(s);
    setResult(null);
    resetForm();
  }

  async function doClose(entry: MonthEntry, scope: Scope) {
    const override = notReady?.canOverride === true && canOverrideReady(data.perms);
    const err = closeFormError({
      month: entry.month,
      typed,
      needAck: carried !== null,
      ack,
      needReason: override,
      reason,
    });
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError("");
    const out = await postClose({
      month: entry.month,
      scope,
      confirmKey: confirmKeyFor(entry.month),
      ...(override ? { overrideReason: reason.trim() } : {}),
      ...(carried !== null && ack ? { acknowledgeCarried: true } : {}),
    });
    setBusy(false);
    if (out.kind === "ok") {
      const label = syncLabel(out.sync.result);
      setResult({ scope, title: `ปิด${SCOPE_NAME[scope]} ${monthTh(entry.month)} เรียบร้อย · ${label.title}`, tone: label.tone, hint: label.hint });
      setToast(`ปิด${SCOPE_NAME[scope]}แล้ว`);
      setScopeSel(null);
      resetForm();
      router.refresh();
    } else if (out.kind === "not_ready") {
      setNotReady({ branches: out.branches, canOverride: out.canOverride });
      setStep(2);
      setError(describeError("branches_not_ready"));
    } else if (out.kind === "carried") {
      setCarried(out.branches);
      setAck(false);
      setError(describeError("carried_not_acknowledged"));
    } else {
      setError(describeError(out.code));
      if (out.code === "already_closed") router.refresh();
    }
  }

  async function doResync(entry: MonthEntry, scope: Scope) {
    setBusy(true);
    setError("");
    const out = await postResync({ month: entry.month, scope });
    setBusy(false);
    if (out.kind === "ok") {
      const label = syncLabel(out.sync.result);
      setResult({ scope, title: `คำนวณ snapshot ใหม่ (${SCOPE_NAME[scope]}) แล้ว · ${label.title}`, tone: label.tone, hint: label.hint });
      router.refresh();
    } else {
      setError(describeError(out.code));
    }
  }

  const syncInfo = data.sync;

  return (
    <div>
      <div className="mb-3">
        <h1 className="m-0 text-xl font-semibold">ส่งข้อมูล และสรุปงานประจำเดือน</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          ปิดเดือนเพื่อยืนยันตัวเลขบริการรายเดือนและส่งเข้า Dashboard · OM/PM และหัวหน้างานใช้ได้ · เดือนที่ปิดแล้วยังแก้ข้อมูลย้อนหลังได้ ทุกการแก้ลงประวัติการแก้ไข
        </p>
        {!data.perms.isHost ? (
          <p className="mt-2">
            <Chip tone="info">ปิดต่างจังหวัด / คำนวณ snapshot ใหม่ได้เฉพาะ OM/PM</Chip>
          </p>
        ) : null}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[10px] border border-border bg-surface p-3">
          <div className="text-[12px] text-fg-muted">ส่ง Dashboard สำเร็จล่าสุด</div>
          <div className="mt-1 text-[17px] font-semibold tabular-nums">{formatBangkok(syncInfo.lastSuccessAt)}</div>
        </div>
        <SyncStatusBox rows={data.syncRows} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[300px_minmax(0,1fr)]">
        <section aria-label="รายการเดือน" className="rounded-[10px] border border-border bg-surface p-3">
          <h2 className="m-0 mb-2 text-[14px] font-semibold">
            รายการเดือน <span className="ml-1 rounded-full bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-fg-muted">{data.months.length}</span>
          </h2>
          <div className="flex flex-col gap-1.5">
            {data.months.map((m) => (
              <button
                key={m.month}
                type="button"
                onClick={() => pick(m.month)}
                aria-current={m.month === sel}
                className={cx(
                  "flex min-h-11 w-full cursor-pointer flex-col gap-1 rounded-[9px] border px-3 py-2 text-left",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  m.month === sel ? "border-accent bg-accent-soft" : "border-border bg-surface-2 hover:bg-surface-3",
                )}
              >
                <span className="text-[13.5px] font-semibold">
                  {monthTh(m.month)} <span className="font-normal tabular-nums text-fg-muted">{m.key}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  <Chip tone={statusTone(m.central)}>กลาง · {statusText(m.central)}</Chip>
                  <Chip tone={statusTone(m.province)}>ตจว. · {statusText(m.province)}</Chip>
                </span>
                {m.complete ? <small className="font-semibold text-ok">อัพเดทข้อมูลครบทุกสาขา</small> : null}
              </button>
            ))}
            {data.goLiveMonth ? (
              <div className="rounded-[9px] border border-dashed border-border px-3 py-2 text-[12px] text-fg-muted">
                ก่อน {monthTh(data.goLiveMonth)} · legacy นำเข้าจาก Dashboard เดิม · ปิดถาวร
              </div>
            ) : null}
          </div>
        </section>

        <section aria-live="polite" className="min-w-0 rounded-[10px] border border-border bg-surface p-3 sm:p-4">
          {!month ? (
            <p className="text-[13px] text-fg-muted">ยังไม่มีเดือนให้ปิด</p>
          ) : (
            <>
              <h2 className="m-0 mb-3 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                {monthTh(month.month)} <span className="font-normal tabular-nums text-fg-muted">{month.key}</span>
                {month.complete ? <Chip tone="ok">อัพเดทข้อมูลครบทุกสาขา</Chip> : null}
              </h2>

              {result ? (
                <Alert variant={result.tone === "ok" ? "ok" : result.tone === "warn" ? "warn" : "danger"} title={result.title} className="mb-3">
                  {result.hint}
                </Alert>
              ) : null}

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {(["central", "province"] as const).map((s) => (
                  <ScopeCard
                    key={s}
                    scope={s}
                    state={month[s]}
                    selected={scopeSel === s}
                    canClose={canCloseScope(data.perms, s)}
                    onOpen={() => openScope(s)}
                  />
                ))}
              </div>

              {scopeSel ? (
                <div className="mt-4 rounded-[10px] border border-border p-3 sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <b>
                      {SCOPE_NAME[scopeSel]} {SCOPE_BRANCHES[scopeSel]} สาขา
                    </b>
                    <Button size="sm" onClick={() => setScopeSel(null)} className="max-[767px]:min-h-11">
                      ← กลับภาพรวมเดือน
                    </Button>
                  </div>

                  {month[scopeSel].status === "closed" ? (
                    <ClosedPanel
                      scope={scopeSel}
                      state={month[scopeSel]}
                      latestFailed={syncInfo.latestFailed}
                      canResync={canResync(data.perms)}
                      busy={busy}
                      error={error}
                      onResync={() => doResync(month, scopeSel)}
                    />
                  ) : month[scopeSel].status === "open" ? (
                    <OpenPanel
                      entry={month}
                      scope={scopeSel}
                      step={step}
                      setStep={setStep}
                      typed={typed}
                      setTyped={(v) => {
                        setTyped(v);
                        setError("");
                      }}
                      ack={ack}
                      setAck={(v) => {
                        setAck(v);
                        setError("");
                      }}
                      reason={reason}
                      setReason={(v) => {
                        setReason(v);
                        setError("");
                      }}
                      notReady={notReady}
                      carried={carried}
                      canClose={canCloseScope(data.perms, scopeSel)}
                      canOverride={canOverrideReady(data.perms)}
                      busy={busy}
                      error={error}
                      onSubmit={() => doClose(month, scopeSel)}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <Toast message={toast} onClose={() => setToast("")} />
    </div>
  );
}

function ScopeCard(props: { scope: Scope; state: ScopeState; selected: boolean; canClose: boolean; onOpen: () => void }) {
  const { scope, state, selected, canClose, onOpen } = props;
  const closed = state.status === "closed";
  return (
    <div aria-current={selected} className={cx("rounded-[10px] border p-3", selected ? "border-accent bg-accent-soft" : "border-border bg-surface-2")}>
      <h3 className="m-0 mb-1 flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
        {SCOPE_NAME[scope]} {SCOPE_BRANCHES[scope]} สาขา <Chip tone={statusTone(state)}>{statusText(state)}</Chip>
      </h3>
      <p className="m-0 mb-3 text-[12px] leading-relaxed text-fg-muted">
        {closed
          ? `ปิดโดย ${state.closedByName ?? "—"} · ${formatBangkok(state.closedAt)}`
          : state.status === "open"
            ? scope === "central"
              ? "ผู้ปิดได้: OM/PM หรือหัวหน้างาน"
              : "ผู้ปิดได้: OM/PM เท่านั้น"
            : "ปิดได้ตั้งแต่เดือนถัดไป (เดือนยังไม่จบ)"}
      </p>
      <div className="flex flex-wrap gap-2">
        {closed ? (
          <Button size="sm" onClick={onOpen} className="max-[767px]:min-h-11">
            ดูรายละเอียด
          </Button>
        ) : state.status === "open" ? (
          canClose ? (
            <Button size="sm" variant="primary" onClick={onOpen} className="max-[767px]:min-h-11">
              ปิด{SCOPE_NAME[scope]}
            </Button>
          ) : (
            <Button size="sm" disabled className="max-[767px]:min-h-11">
              เฉพาะ OM/PM ปิดได้
            </Button>
          )
        ) : (
          <Button size="sm" disabled className="max-[767px]:min-h-11">
            ปิดไม่ได้ — เดือนยังไม่จบ
          </Button>
        )}
      </div>
    </div>
  );
}

function ClosedPanel(props: {
  scope: Scope;
  state: ScopeState;
  latestFailed: boolean;
  canResync: boolean;
  busy: boolean;
  error: string;
  onResync: () => void;
}) {
  const { scope, state, latestFailed, canResync: allowResync, busy, error, onResync } = props;
  return (
    <div>
      {latestFailed ? (
        <Alert variant="danger" title="รอบส่ง Dashboard ล่าสุดไม่สำเร็จ" className="mb-3">
          ส่วน{SCOPE_NAME[scope]}ปิดแล้ว แต่ Dashboard อาจยังแสดงค่าเดิม · ระบบจะลองส่งใหม่รอบ 06:00 น.{allowResync ? " หรือกดคำนวณใหม่ด้านล่าง" : " หรือแจ้ง OM/PM ให้กดส่ง"}
        </Alert>
      ) : null}
      <div className="mb-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="rounded-[9px] border border-border bg-surface-2 p-2.5">
          <span className="block text-[12px] text-fg-muted">ปิดเมื่อ</span>
          <b className="tabular-nums">{formatBangkok(state.closedAt)}</b>
        </div>
        <div className="rounded-[9px] border border-border bg-surface-2 p-2.5">
          <span className="block text-[12px] text-fg-muted">ปิดโดย</span>
          <b>{state.closedByName ?? "—"}</b>
        </div>
      </div>
      <Alert variant="info" title="เดือนนี้แก้ข้อมูลย้อนหลังได้ตามปกติ" className="mb-3">
        OM/PM และหัวหน้างานแก้ผลบริการเดือนนี้ได้เลย ไม่ต้องปลดล็อก · ทุกการแก้ลงประวัติการแก้ไข · ตัวเลขบน Dashboard เปลี่ยนเมื่อ OM/PM กด &quot;คำนวณ snapshot ใหม่&quot; เท่านั้น
      </Alert>
      {allowResync ? (
        <div className="mb-3">
          <Button variant="primary" loading={busy} onClick={onResync} className="max-[767px]:min-h-11">
            <Icon d={ICON_SEND} /> คำนวณ snapshot ใหม่ + ส่ง Dashboard
          </Button>
        </div>
      ) : (
        <p className="mb-3 text-[12px] text-fg-muted">การคำนวณ snapshot ใหม่ทำได้เฉพาะ OM/PM</p>
      )}
      {error ? <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p> : null}
      {POST_CLOSE_EDITS_AVAILABLE ? <PostCloseEdits rows={[]} /> : null}
    </div>
  );
}

/** รายการแก้หลังปิด — รอ RPC list_post_close_edits จาก BE (ตอนนี้ซ่อนด้วย POST_CLOSE_EDITS_AVAILABLE = false) */
export function PostCloseEdits({ rows }: { rows: { table: string; branch: string; changedAt: string; by: string }[] }) {
  return (
    <div>
      <h4 className="m-0 mb-2 text-[13px] font-semibold">แก้หลังปิด ({rows.length})</h4>
      <ul className="m-0 list-none p-0 text-[12.5px]">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-3 border-t border-border py-2">
            <span className="w-32 flex-none tabular-nums text-fg-muted">{formatBangkok(r.changedAt)}</span>
            <span>
              <b>{tableLabelTh(r.table)}</b> · {r.branch} · {r.by}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpenPanel(props: {
  entry: MonthEntry;
  scope: Scope;
  step: 1 | 2;
  setStep: (s: 1 | 2) => void;
  typed: string;
  setTyped: (v: string) => void;
  ack: boolean;
  setAck: (v: boolean) => void;
  reason: string;
  setReason: (v: string) => void;
  notReady: { branches: BranchRef[]; canOverride: boolean } | null;
  carried: BranchRef[] | null;
  canClose: boolean;
  canOverride: boolean;
  busy: boolean;
  error: string;
  onSubmit: () => void;
}) {
  const { entry, scope, step, setStep, notReady, carried, canClose, canOverride, busy, error } = props;
  const central = scope === "central";
  const names = central ? ["ทบทวนตกบริการ", "ยืนยันปิด"] : [];
  const showConfirm = !central || step === 2;
  const inputCls = "w-52 max-w-full rounded-lg border border-border-strong bg-surface px-2.5 py-2 font-mono text-[15px] tracking-wider text-fg max-[767px]:text-base";

  if (!canClose) {
    return (
      <Alert variant="warn" title="เฉพาะ OM/PM ปิดส่วนนี้ได้">
        ข้อมูลส่วน{SCOPE_NAME[scope]}ปิดได้เฉพาะ OM/PM · ชื่อผู้ปิดถูกบันทึกในประวัติการแก้ไข
      </Alert>
    );
  }

  return (
    <div>
      {central ? (
        <ol className="m-0 mb-4 flex list-none gap-2 p-0 max-[640px]:flex-col">
          {names.map((n, i) => {
            const no = (i + 1) as 1 | 2;
            return (
              <li key={n} className="flex-1">
                <button
                  type="button"
                  aria-current={no === step ? "step" : undefined}
                  onClick={() => setStep(no)}
                  className={cx(
                    "min-h-11 w-full cursor-pointer rounded-[9px] border px-2 py-2 text-[12.5px]",
                    no === step ? "border-accent bg-accent-soft font-semibold text-accent-strong" : no < step ? "border-transparent bg-ok-soft text-ok" : "border-border bg-surface-2 text-fg-muted",
                  )}
                >
                  <span className="mr-1.5 inline-grid size-5 place-items-center rounded-full bg-surface-3 text-[12px] font-bold">{no < step ? "✓" : no}</span>
                  {n}
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}

      {central && step === 1 ? (
        <div>
          <MissedReview month={entry.month} />
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => setStep(2)} className="max-[767px]:min-h-11">
              ถัดไป: ยืนยันปิด →
            </Button>
          </div>
        </div>
      ) : null}

      {showConfirm ? (
        <div>
          <Alert variant="danger" title={`การปิด${SCOPE_NAME[scope]}จะส่ง Dashboard ทันที`} className="mb-3">
            <span className="inline-flex items-start gap-1.5">
              <Icon d={ICON_SEND} className="mt-0.5" />
              <span>
                ระบบคำนวณตัวเลขเองทั้งหมดที่ server แล้วสร้าง dashboard_data.json ครบ 43 สาขา · ส่วนที่ยังไม่ปิดใช้ค่าที่มี/ยกมาจากเดือนก่อน · Netlify deploy ~30 วินาที
              </span>
            </span>
          </Alert>
          {central ? (
            <Alert variant="warn" title="ปิดส่วนกลางมีผลกับทุกสาขาส่วนกลาง (24 สาขา) ไม่ใช่เฉพาะทีมของคุณ" className="mb-3">
              <span className="inline-flex items-start gap-1.5">
                <Icon d={ICON_USERS} className="mt-0.5" />
                <span>ชื่อผู้ปิดถูกบันทึกในประวัติการแก้ไข</span>
              </span>
            </Alert>
          ) : null}

          {notReady ? (
            <Alert variant="warn" title="ยังมีสาขาที่บันทึกบริการไม่ครบ" className="mb-3">
              <p className="m-0 mb-1.5">
                &quot;พร้อมปิด&quot; = ทุกสัญญาที่ตกบริการ ทำ/ชดเชย/ยกเว้นแล้ว หรือมีบันทึกเหตุตกบริการ
              </p>
              <ul className="m-0 list-disc pl-5">
                {notReady.branches.map((b) => (
                  <li key={b.id}>
                    {b.name}
                    {typeof b.pending === "number" ? <span className="tabular-nums"> · ค้าง {b.pending} ราย</span> : null}
                  </li>
                ))}
              </ul>
              {!(notReady.canOverride && canOverride) ? (
                <p className="m-0 mt-1.5 inline-flex items-center gap-1.5">
                  <Icon d={ICON_LOCK} /> หัวหน้างานปิดข้ามไม่ได้ — กรอกให้ครบ หรือแจ้ง OM/PM ให้ปิดข้ามพร้อมเหตุผล
                </p>
              ) : null}
            </Alert>
          ) : null}

          {notReady?.canOverride && canOverride ? (
            <div className="mb-3">
              <label htmlFor="override-reason" className="mb-1 block text-[12px] text-fg-muted">
                เหตุผลที่ปิดข้าม (5–500 ตัวอักษร · เฉพาะ OM/PM)
              </label>
              <textarea
                id="override-reason"
                value={props.reason}
                onChange={(e) => props.setReason(e.target.value)}
                rows={3}
                maxLength={500}
                className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-[13px] text-fg max-[767px]:text-base"
              />
            </div>
          ) : null}

          {carried ? (
            <label className="mb-3 flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input type="checkbox" checked={props.ack} onChange={(e) => props.setAck(e.target.checked)} className="mt-1 size-4 flex-none" />
              <span>
                รับทราบว่า <b>{carried.length} สาขา</b> ยังใช้ค่ายกมาจากเดือนก่อน ({carried.map((b) => b.name).join(", ")}) และจะขึ้น Dashboard ด้วยค่านั้น
              </span>
            </label>
          ) : null}

          <div className="mb-1">
            <label htmlFor="confirm-key" className="mb-1 block text-[12px] text-fg-muted">
              พิมพ์ <b className="tabular-nums text-fg">{confirmKeyFor(entry.month)}</b> เพื่อยืนยันการปิดเดือน
            </label>
            <input
              id="confirm-key"
              value={props.typed}
              onChange={(e) => props.setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={confirmKeyFor(entry.month)}
              className={inputCls}
            />
          </div>
          <div role="alert" className="min-h-5 text-[12px] text-danger">
            {error}
          </div>

          <div data-sticky-savebar className="sticky bottom-0 -mx-1 mt-2 flex flex-wrap items-center justify-between gap-2 bg-surface px-1 py-2 max-[767px]:border-t max-[767px]:border-border">
            {central ? (
              <Button onClick={() => setStep(1)} className="max-[767px]:min-h-11">
                ← ย้อนกลับ
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" loading={busy} onClick={props.onSubmit} className="max-[767px]:min-h-11">
              ปิด{SCOPE_NAME[scope]} {monthTh(entry.month)} และส่ง Dashboard
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

