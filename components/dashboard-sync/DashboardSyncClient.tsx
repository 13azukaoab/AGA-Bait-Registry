"use client";

/**
 * หน้า "Dashboard Sync" ฝั่ง client (SPEC §9.2 · จอ 10 · mockup FINAL `docs/mockup/dashboard-sync.html`)
 *
 * Logic summary:
 *   * ข้อมูลทั้งหมดมาจาก server (page.tsx) — ที่นี่ไม่อ่าน env/token · แสดงผลตาม `deriveSyncState`
 *   * สถานะ "ยังไม่ได้ตั้งค่าการเชื่อมต่อ" แสดงเป็นข้อมูล (สีน้ำเงิน) ไม่ใช่ error · ปุ่มส่งถูกปิดไว้จนกว่าจะตั้ง token
 *   * ปุ่ม "ส่งตอนนี้" แสดงเฉพาะเมื่อ `canTrigger` (host) → POST /api/dashboard/sync แล้วแปลงผลด้วย
 *     `interpretSyncResponse` (ไม่โชว์ข้อความดิบ) → `router.refresh()` ให้ประวัติอัปเดต
 *   * ประวัติ: กรองผล/ช่องทาง · รวมรอบ "ข้าม" ที่ติดกัน · กดดูรายละเอียดรายแถว (error แสดงสาเหตุ + วิธีแก้เป็นไทย)
 *   * Export สำรอง: ยังไม่มี endpoint ฝั่ง BE → แสดงเป็นกล่องข้อมูลว่ายังไม่เปิดใช้ (ไม่มีปุ่มหลอก)
 */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Alert, Button, Chip, cx } from "@/components/ui";

import {
  autoStreak,
  deriveSyncState,
  describeSyncError,
  elapsedSeconds,
  failureStats,
  filterLogs,
  formatThaiDateTime,
  formatThaiDayMonth,
  groupHistory,
  interpretSyncResponse,
  lastAttempt,
  lastSuccess,
  nextAutoSyncLabel,
  relativeDay,
  resultLabel,
  sourceLabel,
  type HistoryFilter,
  type SyncActionOutcome,
  type SyncLogRow,
  type SyncState,
} from "./syncLogic";

export type DashboardSyncProps = {
  logs: SyncLogRow[];
  /** server ตรวจแล้วว่ามี DASHBOARD_GITHUB_TOKEN หรือไม่ (ไม่ส่งค่า token) */
  tokenConfigured: boolean;
  /** เวลา "ตอนนี้" จาก server (ISO) — ให้ผลแสดงตรงกันทุกครั้งที่ render */
  nowIso: string;
  /** host เท่านั้นที่เห็นปุ่มสั่งส่ง */
  canTrigger: boolean;
  repo: string;
  branch: string;
};

const PAGE = 8;

// ---------- ไอคอน SVG ----------
function Icon({ name, className }: { name: "check" | "dash" | "cross" | "clock" | "info" | "retry" | "plug"; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className: cx("size-[1em]", className) };
  switch (name) {
    case "check":
      return <svg {...common}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
    case "dash":
      return <svg {...common}><path d="M6 12h12" /></svg>;
    case "cross":
      return <svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
    case "info":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.2" /></svg>;
    case "retry":
      return <svg {...common}><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></svg>;
    case "plug":
      return <svg {...common}><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v5" /></svg>;
  }
}

const BADGE_TONE: Record<"ok" | "skip" | "fail" | "config" | "none" | "run", string> = {
  ok: "bg-ok-soft text-ok",
  skip: "bg-surface-3 text-fg-muted",
  fail: "bg-danger-soft text-danger",
  config: "bg-accent-soft text-accent-strong",
  none: "bg-surface-3 text-fg-muted",
  run: "bg-accent-soft text-accent-strong",
};

function Panel({ title, id, children, aside }: { title: React.ReactNode; id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-4 overflow-hidden rounded-card border border-border bg-surface shadow-[var(--shadow)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 id={id} className="m-0 text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-0.5 break-words text-[13px] font-semibold">{children}</div>
    </div>
  );
}

export function DashboardSyncClient({ logs, tokenConfigured, nowIso, canTrigger, repo, branch }: DashboardSyncProps) {
  const router = useRouter();
  const nowMs = Date.parse(nowIso);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<SyncActionOutcome | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>({ result: "all", source: "all" });
  const [groupSkips, setGroupSkips] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<number | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>({});

  const state: SyncState = deriveSyncState(logs, tokenConfigured);
  const last = lastAttempt(logs);
  const lastOk = lastSuccess(logs);
  const notConfigured = state === "not_configured" || (outcome?.kind === "failed" && outcome.notConfigured);
  const rows = useMemo(() => filterLogs(logs, filter), [logs, filter]);
  const items = useMemo(() => groupHistory(rows, groupSkips), [rows, groupSkips]);
  const fails = failureStats(logs, nowMs);
  const streak = autoStreak(logs);

  async function send() {
    if (sending || !canTrigger) return;
    setSending(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/dashboard/sync", { method: "POST", headers: { Accept: "application/json" } });
      const body: unknown = await res.json().catch(() => null);
      setOutcome(interpretSyncResponse(res.status, body));
    } catch {
      setOutcome({ kind: "error", message: "เชื่อมต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง" });
    } finally {
      setSending(false);
      router.refresh();
    }
  }

  function resetPaging(next: HistoryFilter) {
    setFilter(next);
    setShown(PAGE);
    setOpenId(null);
  }

  const sendButton = (primary: boolean) =>
    canTrigger ? (
      <Button
        data-tour="sync-run"
        variant={primary ? "primary" : "secondary"}
        loading={sending}
        disabled={notConfigured === true || state === "running"}
        onClick={send}
        className="max-[767px]:min-h-11"
      >
        <span className="inline-flex items-center gap-1.5"><Icon name="retry" />{sending ? "กำลังส่ง…" : "ส่งตอนนี้"}</span>
      </Button>
    ) : null;

  // ---------- การ์ดสถานะล่าสุด ----------
  let hero: React.ReactNode;
  if (notConfigured) {
    hero = (
      <HeroShell tone="config" icon="plug" title="ยังไม่ได้ตั้งค่าการเชื่อมต่อกับ GitHub" action={sendButton(false)}>
        <p className="m-0 text-[13px] text-fg-muted">
          ระบบยังไม่มี token สำหรับส่งข้อมูลเข้า Dashboard จึงยังไม่ส่งอัตโนมัติ · Dashboard ยังแสดงตัวเลขเดิม ไม่มีอะไรเสียหาย
        </p>
        <p className="m-0 mt-1.5 text-[13px]">
          <b className="text-accent-strong">ต้องทำ:</b> ให้ผู้ดูแลระบบตั้งค่า Environment Variable ที่ Vercel (ห้ามส่ง token ทางแชท/อีเมล) แล้วกลับมากด “ส่งตอนนี้”
        </p>
      </HeroShell>
    );
  } else if (state === "never_sent" || !last) {
    hero = (
      <HeroShell tone="none" icon="info" title="ยังไม่เคยส่งข้อมูลเข้า Dashboard" action={sendButton(true)}>
        <p className="m-0 text-[13px] text-fg-muted">
          Auto Sync รอบแรกจะเริ่ม {nextAutoSyncLabel(nowMs)} {canTrigger ? "หรือกด “ส่งตอนนี้” เพื่อส่งทันที" : ""}
        </p>
      </HeroShell>
    );
  } else if (state === "running") {
    hero = (
      <HeroShell tone="run" icon="clock" title="กำลังส่งข้อมูลเข้า Dashboard…" action={null}>
        <p className="m-0 text-[13px] text-fg-muted">เริ่มเมื่อ {formatThaiDateTime(last.startedAt)} · รอสักครู่ ผลจะขึ้นในประวัติ</p>
      </HeroShell>
    );
  } else {
    const failed = state === "last_failed";
    const label = resultLabel(last.result);
    const secs = elapsedSeconds(last);
    const err = failed ? describeSyncError(last.errorCode) : null;
    hero = (
      <HeroShell
        tone={failed ? "fail" : state === "last_skipped" ? "skip" : "ok"}
        icon={label.icon}
        title={
          <>
            {state === "last_ok" ? "ส่งสำเร็จ" : state === "last_skipped" ? "ตรวจแล้ว ไม่มีการเปลี่ยนแปลง" : "ส่งไม่สำเร็จ"} ·{" "}
            <span className="tabular-nums">{formatThaiDateTime(last.startedAt)}</span>{" "}
            <span className="text-[13px] font-normal text-fg-muted">({relativeDay(last.startedAt, nowMs)})</span>
          </>
        }
        action={sendButton(failed)}
      >
        <p className="m-0 text-[13px] text-fg-muted">
          ช่องทาง: {sourceLabel(last.source)} · ผู้สั่ง: {actorName(last)}
          {secs !== null ? ` · ใช้เวลา ${secs.toFixed(1)} วินาที` : ""}
        </p>
        {failed && err ? (
          <p className="m-0 mt-1.5 text-[13px]"><b className="text-danger">สาเหตุ:</b> {err.title}<br /><b className="text-danger">ต้องทำ:</b> {err.fix}</p>
        ) : (
          <p className="m-0 mt-1.5 text-[13px]"><b className="text-ok">ไม่ต้องทำอะไร</b> · รอบถัดไป {nextAutoSyncLabel(nowMs)}</p>
        )}
      </HeroShell>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <h1 className="m-0 text-xl font-semibold">Dashboard Sync</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          ติดตามการส่งตัวเลขไป AGA Bait Dashboard · ดูประวัติการส่ง · เฉพาะ OM/PM
        </p>
      </div>

      <div aria-live="polite" className="space-y-2">
        {outcome ? <OutcomeAlert outcome={outcome} /> : null}
      </div>

      <Panel id="h-last" title="สถานะการส่งล่าสุด">
        <div className="p-4">
          {hero}
          {lastOk && !notConfigured ? (
            <div className="mt-3 grid grid-cols-2 gap-2 max-[480px]:grid-cols-1">
              <Kv label="ส่งสำเร็จ (commit) ล่าสุด"><span className="tabular-nums">{formatThaiDateTime(lastOk.startedAt)}</span></Kv>
              <Kv label="commit"><span className="font-mono">{lastOk.commitSha ? lastOk.commitSha.slice(0, 7) : "-"}</span></Kv>
              <Kv label="จำนวนเดือนในไฟล์">{lastOk.monthCount !== null ? `${lastOk.monthCount} เดือน` : "-"}</Kv>
              <Kv label="เดือนที่เปลี่ยนในรอบนั้น">{lastOk.monthsSent.length > 0 ? lastOk.monthsSent.join(", ") : "-"}</Kv>
            </div>
          ) : null}
        </div>
      </Panel>

      {lastOk ? (
        <div className="mt-4 grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-[480px]:grid-cols-1">
          <Stat tone="ok" label="Dashboard อัปเดตล่าสุด" value={formatThaiDateTime(lastOk.startedAt)} sub="ครั้งล่าสุดที่มีการ commit จริง" />
          <Stat tone={streak >= 7 ? "ok" : "accent"} label="Auto Sync ไม่พลาดติดต่อกัน" value={`${streak} วัน`} sub="เป้าหมายยอมรับระบบ: 7 วัน (SPEC §15 ข้อ 5)" />
          <button
            type="button"
            onClick={() => {
              resetPaging({ result: "failed", source: "all" });
              document.getElementById("h-hist")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={cx(
              "cursor-pointer rounded-card border border-border border-t-[3px] bg-surface p-3 text-left shadow-[var(--shadow)] max-[767px]:min-h-11",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              fails.count > 0 ? "border-t-warn" : "border-t-ok",
            )}
          >
            <div className="text-xs text-fg-muted">ล้มเหลวใน 30 วันล่าสุด (กดดูรายการ)</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{fails.count} ครั้ง</div>
            <div className="text-xs text-fg-muted">{fails.unresolved > 0 ? `${fails.unresolved} ครั้งยังไม่ได้ส่งซ้ำสำเร็จ` : "ทุกครั้งส่งซ้ำสำเร็จแล้ว"}</div>
          </button>
          <Stat tone="accent" label="รอบ Auto Sync ถัดไป" value={nextAutoSyncLabel(nowMs)} sub="เริ่มได้ถึง 06:59 · เวลาไทย" />
        </div>
      ) : null}

      <Panel id="h-hist" title="ประวัติการส่ง" aside={<Chip tone="na">{rows.length} รายการ</Chip>}>
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            ผลลัพธ์
            <select
              value={filter.result}
              onChange={(e) => resetPaging({ ...filter, result: e.target.value as HistoryFilter["result"] })}
              className="min-h-10 rounded-lg border border-border-strong bg-surface px-2 text-[13px] text-fg max-[767px]:min-h-11 max-[767px]:text-base"
            >
              <option value="all">ทั้งหมด</option>
              <option value="success">สำเร็จ</option>
              <option value="skipped">ข้าม (ไม่มีการเปลี่ยนแปลง)</option>
              <option value="failed">ล้มเหลว</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            ช่องทาง
            <select
              value={filter.source}
              onChange={(e) => resetPaging({ ...filter, source: e.target.value as HistoryFilter["source"] })}
              className="min-h-10 rounded-lg border border-border-strong bg-surface px-2 text-[13px] text-fg max-[767px]:min-h-11 max-[767px]:text-base"
            >
              <option value="all">ทุกช่องทาง</option>
              <option value="auto">Auto Sync 06:00</option>
              <option value="manual">ส่งตอนนี้ (กดเอง)</option>
              <option value="close">ปิดเดือน</option>
              <option value="resync">คำนวณ snapshot ใหม่</option>
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-[13px] max-[767px]:min-h-11">
            <input type="checkbox" checked={groupSkips} onChange={(e) => { setGroupSkips(e.target.checked); setShown(PAGE); }} className="size-4" />
            รวมรายการ “ข้าม” ที่ติดกัน
          </label>
        </div>

        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <caption className="sr-only">ประวัติการส่งข้อมูลไป Dashboard เรียงจากใหม่ไปเก่า</caption>
            <thead>
              <tr className="bg-surface-2 text-left text-xs text-fg-muted">
                <th scope="col" className="px-3 py-2 font-medium">เวลา</th>
                <th scope="col" className="px-3 py-2 font-medium">ช่องทาง</th>
                <th scope="col" className="px-3 py-2 font-medium">ผลลัพธ์</th>
                <th scope="col" className="px-3 py-2 font-medium">ผู้สั่ง</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">ใช้เวลา</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">รายละเอียด</span></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-fg-muted">{logs.length === 0 ? "ยังไม่มีประวัติการส่ง" : "ไม่พบรายการตามตัวกรอง"}</td></tr>
              ) : null}
              {items.slice(0, shown).map((it) => {
                if (it.kind === "row") return <HistoryRow key={it.log.id} log={it.log} open={openId === it.log.id} onToggle={() => setOpenId(openId === it.log.id ? null : it.log.id)} />;
                const first = it.logs[0]!;
                const lastG = it.logs[it.logs.length - 1]!;
                const key = lastG.id;
                const open = !!openGroups[key];
                const a = formatThaiDayMonth(lastG.startedAt);
                const b = formatThaiDayMonth(first.startedAt);
                return (
                  <FragmentRows key={`g${key}`}>
                    <tr className="border-t border-border bg-surface-2">
                      <td className="px-3 py-2 tabular-nums">{a === b ? a : `${a} – ${b}`}</td>
                      <td className="px-3 py-2">{sourceLabel(first.source)}</td>
                      <td className="px-3 py-2"><Chip tone="na"><Icon name="dash" /> ข้าม {it.logs.length} รอบติดกัน</Chip></td>
                      <td className="px-3 py-2" colSpan={2}>ข้อมูลเหมือนรอบก่อน ไม่ commit</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpenGroups({ ...openGroups, [key]: !open })} className="max-[767px]:min-h-11">
                          {open ? "ซ่อน" : "แสดง"}
                        </Button>
                      </td>
                    </tr>
                    {open ? it.logs.map((l) => <HistoryRow key={l.id} log={l} open={openId === l.id} onToggle={() => setOpenId(openId === l.id ? null : l.id)} />) : null}
                  </FragmentRows>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-fg-muted">
          <span>แสดง {Math.min(shown, items.length)} จาก {items.length} แถว ({rows.length} รายการ) · ระบบเก็บประวัติถาวร ไม่ลบอัตโนมัติ</span>
          {items.length > shown ? (
            <Button size="sm" variant="secondary" onClick={() => setShown(shown + PAGE)} className="max-[767px]:min-h-11">
              แสดงเพิ่ม {Math.min(PAGE, items.length - shown)} แถว
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel id="h-exp" title="Export สำรอง" aside={<Chip tone="na">ยังไม่เปิดใช้</Chip>}>
        <div className="p-4">
          <Alert variant="info">
            การดาวน์โหลดไฟล์ <code className="font-mono">dashboard_data.json</code> เป็นไฟล์สำรองยังไม่เปิดใช้ในรุ่นนี้ · ถ้าส่งอัตโนมัติไม่ได้ ให้แจ้งผู้ดูแลฐานข้อมูลให้ช่วยสร้างไฟล์ให้
          </Alert>
        </div>
      </Panel>

      <details className="mt-4 overflow-hidden rounded-card border border-border bg-surface shadow-[var(--shadow)]">
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-semibold max-[767px]:min-h-11">
          ระบบส่งข้อมูลเข้า Dashboard อย่างไร <Chip tone="na">อ่านครั้งเดียวพอ</Chip>
        </summary>
        <div className="space-y-3 border-t border-border p-4 text-[13px]">
          <p className="m-0"><b>Auto Sync ทุกวัน 06:00 น. (เวลาไทย)</b><br /><span className="text-fg-muted">รันบน Vercel Cron เอง ไม่ต้องเปิดคอมพิวเตอร์ · ระบบอาจเริ่มรันช่วง 06:00–06:59 ถือว่าปกติ · ไม่คำนวณ “เดือนที่ปิดแล้ว” ใหม่เอง — ใช้ snapshot ที่เก็บไว้</span></p>
          <p className="m-0"><b>ปิดเดือน → ส่งทันที</b><br /><span className="text-fg-muted">เมื่อกดปิดเดือน ระบบเก็บ snapshot แล้วส่ง Dashboard ทันที · ถ้าส่งไม่สำเร็จ เดือนยังถือว่าปิดแล้ว</span></p>
          <p className="m-0"><b>ข้อมูลไม่เปลี่ยน = ข้าม</b><br /><span className="text-fg-muted">ระบบไม่ commit เมื่อข้อมูลเหมือนเดิม (ไม่ทำให้ Netlify build ใหม่โดยไม่จำเป็น) และนับว่าสำเร็จ</span></p>
        </div>
      </details>

      <details className="mt-4 overflow-hidden rounded-card border border-border bg-surface shadow-[var(--shadow)]">
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-semibold max-[767px]:min-h-11">
          ปลายทางที่ส่งไป <Chip tone="na">อ่านอย่างเดียว</Chip>
        </summary>
        <div className="border-t border-border p-4">
          <div className="grid grid-cols-2 gap-2 max-[480px]:grid-cols-1">
            <Kv label="Repo"><span className="font-mono">{repo}</span></Kv>
            <Kv label="Branch"><span className="font-mono">{branch}</span></Kv>
            <Kv label="ไฟล์ที่ระบบ commit"><span className="font-mono">dashboard_data.json · index.html (const DATA)</span></Kv>
            <Kv label="GitHub token">
              {tokenConfigured ? <Chip tone="ok">ตั้งค่าแล้ว</Chip> : <Chip tone="info">ยังไม่ได้ตั้งค่า</Chip>}{" "}
              <span className="text-xs font-normal text-fg-muted">อยู่ใน env ของ Vercel</span>
            </Kv>
          </div>
          <p className="mb-0 mt-3 text-xs text-fg-muted">
            ค่าเหล่านี้ตั้งที่ Vercel (Environment Variable) ไม่ใช่ในหน้านี้ — ระบบไม่แสดงและไม่รับ token ทางหน้าจอ เพื่อไม่ให้ความลับรั่วไหล
          </p>
        </div>
      </details>
    </div>
  );
}

function actorName(log: SyncLogRow): string {
  if (log.source === "auto") return "ระบบ Auto Update";
  return log.triggeredByName ?? "ผู้ดูแลระบบ";
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function HeroShell({
  tone,
  icon,
  title,
  action,
  children,
}: {
  tone: keyof typeof BADGE_TONE;
  icon: "check" | "dash" | "cross" | "clock" | "info" | "plug";
  title: React.ReactNode;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div aria-hidden="true" className={cx("flex size-11 flex-none items-center justify-center rounded-full text-xl", BADGE_TONE[tone])}>
        <Icon name={icon} />
      </div>
      <div className="min-w-0 flex-1 basis-60">
        <h3 className="m-0 mb-1 text-[15px] font-semibold">{title}</h3>
        {children}
      </div>
      {action ? <div className="flex-none max-[480px]:w-full [&>button]:max-[480px]:w-full">{action}</div> : null}
    </div>
  );
}

function Stat({ tone, label, value, sub }: { tone: "ok" | "accent"; label: string; value: string; sub: string }) {
  return (
    <div className={cx("rounded-card border border-border border-t-[3px] bg-surface p-3 shadow-[var(--shadow)]", tone === "ok" ? "border-t-ok" : "border-t-accent")}>
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-fg-muted">{sub}</div>
    </div>
  );
}

function OutcomeAlert({ outcome }: { outcome: SyncActionOutcome }) {
  if (outcome.kind === "success") return <Alert variant="ok" title="ส่ง Dashboard สำเร็จ">{outcome.message}</Alert>;
  if (outcome.kind === "skipped") return <Alert variant="info" title="ข้อมูลไม่เปลี่ยน">{outcome.message}</Alert>;
  if (outcome.kind === "busy") return <Alert variant="warn" title="มีการส่งอื่นกำลังทำงานอยู่">{outcome.message}</Alert>;
  if (outcome.kind === "failed" && outcome.notConfigured) {
    return <Alert variant="info" title="ยังไม่ได้ตั้งค่าการเชื่อมต่อกับ GitHub">ให้ผู้ดูแลระบบตั้งค่าที่ Vercel ก่อน แล้วค่อยกด “ส่งตอนนี้” อีกครั้ง</Alert>;
  }
  if (outcome.kind === "failed") {
    return <Alert variant="danger" title="ส่งไม่สำเร็จ — Dashboard ยังแสดงตัวเลขเดิม">{outcome.message} · ดูวิธีแก้ในประวัติด้านล่าง</Alert>;
  }
  return <Alert variant="danger" title="ส่งไม่สำเร็จ">{outcome.message}</Alert>;
}

function HistoryRow({ log, open, onToggle }: { log: SyncLogRow; open: boolean; onToggle: () => void }) {
  const r = resultLabel(log.result);
  const secs = elapsedSeconds(log);
  const detailId = `d${log.id}`;
  return (
    <>
      <tr className={cx("border-t border-border", open && "bg-accent-soft")}>
        <td className="px-3 py-2 tabular-nums">{formatThaiDateTime(log.startedAt)}</td>
        <td className="px-3 py-2">{sourceLabel(log.source)}</td>
        <td className="px-3 py-2"><Chip tone={r.tone}><Icon name={r.icon} /> {r.text}</Chip></td>
        <td className="px-3 py-2">{actorName(log)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{secs !== null ? `${secs.toFixed(1)} วิ` : "-"}</td>
        <td className="px-3 py-2 text-right">
          <Button size="sm" variant="secondary" aria-expanded={open} aria-controls={detailId} onClick={onToggle} className="max-[767px]:min-h-11">
            {open ? "ซ่อน" : "รายละเอียด"}
          </Button>
        </td>
      </tr>
      {open ? (
        <tr id={detailId} className="bg-surface-2">
          <td colSpan={6} className="px-4 py-3">
            <LogDetail log={log} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function LogDetail({ log }: { log: SyncLogRow }) {
  if (log.result === "failed") {
    const e = describeSyncError(log.errorCode);
    return (
      <div className="space-y-1.5 text-[13px]">
        <div className="rounded-lg border-l-[3px] border-l-danger bg-danger-soft px-3 py-2"><b>สาเหตุ:</b> {e.title}</div>
        <p className="m-0"><b>วิธีแก้:</b> {e.fix}</p>
        {log.errorCode ? <p className="m-0 text-xs text-fg-muted">รหัส: <span className="font-mono">{log.errorCode}</span></p> : null}
      </div>
    );
  }
  if (log.result === null) return <p className="m-0 text-[13px] text-fg-muted">รอบนี้กำลังส่ง รอผลสักครู่</p>;
  if (log.result === "skipped") {
    const e = log.errorCode ? describeSyncError(log.errorCode) : null;
    return <p className="m-0 text-[13px] text-fg-muted">{e ? e.title : "ข้อมูลเหมือนรอบก่อน ไม่ commit (ไม่ทำให้ Netlify build ใหม่)"}</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2 max-[480px]:grid-cols-1">
      <Kv label="เดือนที่ส่ง">{log.monthsSent.length > 0 ? log.monthsSent.join(", ") : "-"}</Kv>
      <Kv label="จำนวนเดือนในไฟล์">{log.monthCount !== null ? `${log.monthCount} เดือน × 43 สาขา` : "-"}</Kv>
      <Kv label="commit"><span className="font-mono">{log.commitSha ? log.commitSha.slice(0, 7) : "-"}</span></Kv>
    </div>
  );
}
