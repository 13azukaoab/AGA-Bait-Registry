"use client";

/**
 * หน้า "ลงข้อมูล Port ต่างจังหวัด" ฝั่ง client (SPEC §8 หน้า 9 · mockup FINAL `docs/mockup/provincial-port-update.html` · M40)
 *
 * Logic summary:
 *   * ข้อมูลทั้งหมดมาจาก server (page.tsx → portData) · เปลี่ยนเดือน = เปลี่ยน `?month=` (server โหลดใหม่)
 *   * ซ้าย: สถิติ + ตาราง 19 สาขา (กรอง/จัดกลุ่มตามเขต) · ขวา: แผงแก้ไขสาขาที่เลือก (PortEditor)
 *   * บันทึก/ยืนยันค่าเดิม → `savePortRow` ด้วย JWT ผู้ใช้ (ไม่ใช้ service role) แล้ว `router.refresh()`
 *     ก่อนบันทึกถามยืนยันเมื่อมีคำเตือน/ยังไม่ได้เทียบยอดรายงาน/เดือนปิดแล้ว (ข้อความ: แก้หลังปิดส่งขึ้น Dashboard รอบ 06:00 ถัดไป — 2.79(2))
 *   * ยอดไม่ตรงรายงาน = ปุ่มบันทึกปิด (5.11 · DB บังคับซ้ำด้วย CHECK) · legacy (2.85 Q1) = ไม่มีปุ่มยืนยันค่าเดิม
 *   * มีงานค้าง → `useUnsavedWork` + เตือนก่อนปิดแท็บ/เปลี่ยนเดือน/เปลี่ยนสาขา
 *   * error จาก DB แปลงเป็นข้อความไทยด้วย `portErrorMessage` (ไม่แสดงข้อความดิบ)
 */
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";

import { formatThaiDateTime } from "@/components/dashboard-sync/syncLogic";
import { Toast, cx } from "@/components/ui";
import { useUnsavedWork } from "@/components/shell/unsaved-work";
import { createClient } from "@/lib/supabase/client";

import { Icon, Notice, Pill, useConfirm } from "./PortBits";
import { PortEditor } from "./PortEditor";
import { savePortRow } from "./portApi";
import type { PortPageData } from "./portData";
import {
  buildUpsertPayload,
  draftFromState,
  evalDraft,
  filterRows,
  fmt0,
  fmt2,
  fmtSigned,
  isDraftDirty,
  portErrorMessage,
  summarizeRows,
  tierBandTexts,
  toTableRow,
  type Draft,
  type StatusFilter,
  type TableRow,
} from "./portLogic";

const FIELD =
  "min-h-[34px] rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg " +
  "max-md:min-h-11 max-md:text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

export function PortClient({ data }: { data: PortPageData }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();

  const [sel, setSel] = useState(-1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [q, setQ] = useState("");
  const [zone, setZone] = useState("all");
  const [st, setSt] = useState<StatusFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const rows: TableRow[] = useMemo(
    () => data.branches.map((b) => toTableRow(b.index, b.area, b.name, b.state)),
    [data.branches],
  );
  const branch = sel >= 0 ? data.branches[sel] : null;
  const savedDraft = useMemo(() => (branch ? draftFromState(branch.state) : null), [branch]);
  const dirty = !!(draft && savedDraft && isDraftDirty(draft, savedDraft));
  useUnsavedWork(dirty);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ข้อมูลโหลดใหม่หลังบันทึก → ตั้งฟอร์มตามค่าที่บันทึกแล้ว (ถ้าไม่ได้แก้ค้างอยู่)
  useEffect(() => {
    const cur = sel >= 0 ? data.branches[sel] : undefined;
    if (cur && !dirty) setDraft(draftFromState(cur.state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const ev = useMemo(
    () => (branch && draft ? evalDraft(draft, { branchName: branch.name, month: data.month, rules: data.rules, strictValues: branch.state.strictValues }) : null),
    [branch, draft, data.month, data.rules],
  );
  const bands = useMemo(() => tierBandTexts(data.rules, data.month), [data.rules, data.month]);

  const sum = useMemo(() => summarizeRows(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, q, zone, st), [rows, q, zone, st]);
  const zones = useMemo(() => [...new Set(data.branches.map((b) => b.area))], [data.branches]);
  const legacyCount = rows.filter((r) => r.state.kind === "legacy-carry" || r.state.kind === "empty").length;
  const allUnconfirmed = rows.every((r) => !r.state.updated);

  const askDiscard = (what: string, okLabel: string) =>
    confirm("ทิ้งการแก้ไขที่ยังไม่บันทึก?", what, okLabel);

  async function onMonthChange(m: string) {
    if (m === data.month) return;
    if (dirty && !(await askDiscard("สาขาที่เปิดอยู่มีการแก้ไขที่ยังไม่ได้บันทึก ถ้าเปลี่ยนเดือนจะหายทั้งหมด", "ทิ้งและเปลี่ยนเดือน"))) return;
    router.push(`/admin/port?month=${m}`);
  }

  async function openBranch(i: number) {
    if (i === sel) return;
    if (dirty && !(await askDiscard(`สาขา${branch?.name ?? ""} มีการแก้ไขที่ยังไม่ได้บันทึก ถ้าเปิดสาขาอื่นจะหายทั้งหมด`, "ทิ้งและเปิดสาขาอื่น"))) return;
    setSel(i);
    setSaveError(null);
    const target = data.branches[i];
    if (!target) return;
    setDraft(draftFromState(target.state));
    if (window.matchMedia("(max-width:1180px)").matches) {
      requestAnimationFrame(() => document.getElementById("port-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  async function closeEditor() {
    if (dirty && !(await askDiscard("ปิดแผงแก้ไขแล้วการแก้ไขที่ยังไม่บันทึกจะหายทั้งหมด", "ทิ้งและปิด"))) return;
    setSel(-1);
    setDraft(null);
    setSaveError(null);
  }

  async function write(b: NonNullable<typeof branch>, input: Parameters<typeof buildUpsertPayload>[0]["input"], report: Parameters<typeof buildUpsertPayload>[0]["report"], msg: string) {
    setSaving(true);
    setSaveError(null);
    const payload = buildUpsertPayload({ month: data.month, branchId: b.id, branchName: b.name, input, report, nowIso: new Date().toISOString() });
    const out = await savePortRow(createClient(), payload);
    setSaving(false);
    if (!out.ok) {
      setSaveError(portErrorMessage(out.code));
      return;
    }
    setToast(`${msg} · ${b.name} ${data.monthLabelKey}${data.provinceClosed ? " (แก้หลังปิด · ลง audit log)" : ""}`);
    router.refresh();
  }

  async function onSave() {
    if (!branch || !ev || !ev.canSave) return;
    const notes: string[] = [];
    const warnCount = ev.rowWarns.filter(Boolean).length;
    if (warnCount) notes.push(`มีคำเตือน ${warnCount} รายการ (ค่าเฉลี่ยต่อรายผิดปกติ/มูลค่า 0)`);
    if (ev.reportState === "none") notes.push("ยังไม่ได้เทียบยอดกับรายงาน");
    if (data.provinceClosed) notes.push("เดือนนี้ปิดแล้ว การแก้จะลง audit log และส่งขึ้น Dashboard ในรอบ 06:00 ถัดไป");
    if (notes.length && !(await confirm(`บันทึก ${branch.name} ${data.monthLabelKey}?`, `${notes.join(" · ")} — ต้องการบันทึกต่อหรือไม่`, "บันทึก"))) return;
    await write(branch, ev.input, ev.report, "บันทึกแล้ว");
  }

  async function onKeep() {
    if (!branch || !branch.state.canKeepSame) return;
    const ok = await confirm(
      `ยืนยันใช้ค่าเดิมของ ${branch.name}?`,
      `ตัวเลขเดือน ${data.monthLabelKey} จะเท่ากับค่าที่ยกมาจาก ${branch.state.from ?? "เดือนก่อน"} ทุกช่อง และถือว่า “อัปเดตแล้ว” · ส่วนต่างจากเดือนก่อน = 0`,
      "ยืนยันค่าเดิม",
    );
    if (!ok) return;
    await write(branch, branch.state.input, null, "ยืนยันใช้ค่าเดิม");
  }

  const toggleZone = (z: string) => setCollapsed((c) => ({ ...c, [z]: !c[z] }));
  const diff = sum.totalCents - sum.prevCents;
  const closedMeta = data.provinceClosed
    ? `ปิด ${formatThaiDateTime(data.closedAt)}${data.closedByName ? ` โดย ${data.closedByName}` : ""}`
    : "";

  const th = "bg-surface-2 px-2 py-2 text-left text-xs font-semibold text-fg-muted border-b border-border whitespace-nowrap";
  const td = "px-2 py-1.5 border-b border-border whitespace-nowrap";

  return (
    <div className="mx-auto max-w-[1760px] p-4 max-[860px]:p-3">
      <header className="mb-3">
        <h1 className="m-0 text-xl font-semibold">ลงข้อมูล Port ต่างจังหวัด</h1>
        <p className="m-0 mt-1 text-[13px] text-fg-muted">
          กรอก/วางสรุปมูลค่าลูกค้า แยก Size × ปี ของ {rows.length} สาขาต่างจังหวัดรายเดือน แทนการอัปเดตไฟล์ Excel · เฉพาะ OM/PM
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="port-month" className="text-xs text-fg-muted">เดือน</label>
          <select id="port-month" value={data.month} onChange={(e) => void onMonthChange(e.target.value)} className={FIELD}>
            {data.months.length === 0 ? <option value={data.month}>{data.monthLabelKey}</option> : null}
            {data.months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.key}{m.province.status === "closed" ? " · ปิดแล้ว" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="pb-1.5 text-[12.5px] text-fg-muted" aria-live="polite">
          {data.provinceClosed ? "เดือนที่ปิดแล้ว · แก้ย้อนหลังได้ (ลง audit log)" : "เดือนที่ยังเปิดอยู่"}
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2.5">
        {data.provinceClosed ? (
          <Notice tone="warn">
            <b>เดือนนี้ปิดแล้ว</b> ({closedMeta}) · OM/PM แก้ย้อนหลังได้ และลง audit log ทุกครั้ง
            <small>
              ตัวเลขที่แก้จะส่งขึ้น Dashboard ในรอบอัตโนมัติ 06:00 ถัดไป · เกณฑ์ Tier ใหม่ไม่มีผลย้อนหลัง
              {data.editsAfterClose !== null ? <> · แก้หลังปิดแล้ว <b>{data.editsAfterClose}</b> ครั้งในเดือนนี้ (ต่างจังหวัด)</> : null}
            </small>
          </Notice>
        ) : null}
        {allUnconfirmed ? (
          <Notice tone="info">
            <span className="mr-1"><Icon name="carry" /></span>
            <b>ยังไม่มีข้อมูลเดือน {data.monthLabelKey}</b> — ระบบยกค่ามาให้เท่าที่มี (สถานะ “ยังไม่อัปเดต”)
            <small>ถ้าไม่ได้ยืนยัน Dashboard จะแสดงค่ายกมานี้ไปก่อน · สาขาที่ไม่มีการเปลี่ยนแปลงกด “ยืนยันใช้ค่าเดิม” ได้เลย</small>
          </Notice>
        ) : null}
        {legacyCount > 0 ? (
          <Notice tone="warn">
            <b>{legacyCount} สาขาต้องกรอกจากรายงานเอง</b> — เดือนก่อนหน้าเป็นข้อมูลเก่าที่นำเข้า (มีแต่ยอดรวม) หรือยังไม่มีข้อมูล จึงยกค่ามาให้ไม่ได้
            <small>เกิดครั้งแรกครั้งเดียวต่อสาขา · กรอกจำนวนและมูลค่า 8 tier จากรายงาน หรือวางตารางจาก Excel</small>
          </Notice>
        ) : null}
        <Notice tone="info">
          ส่วนกลาง 24 สาขา <b>คำนวณจากทะเบียนอัตโนมัติ</b> — ไม่ได้มาจากหน้านี้ · หน้านี้ใช้เฉพาะ {rows.length} สาขาต่างจังหวัด ซึ่งยังไม่มีทะเบียนในระบบ ·
          ถ้าเดือนไหนยังไม่ได้อัปเดต Dashboard จะใช้ค่าล่าสุดที่ยกมา
        </Notice>
      </div>

      {/* สถิติ */}
      <div className="mb-4 grid grid-cols-2 gap-3 min-[640px]:grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
        <StatButton tone="ok" label="อัปเดตแล้ว" value={`${sum.updated} / ${rows.length}`} sub={`สาขาต่างจังหวัดเดือน ${data.monthLabelKey}`} onClick={() => { setSt("ok"); setQ(""); setZone("all"); }} />
        <StatButton tone={sum.pending ? "warn" : "ok"} label="ยังไม่อัปเดต" value={String(sum.pending)} sub={sum.pending ? "ใช้ค่ายกมาไปก่อน" : "ครบทุกสาขาแล้ว"} onClick={() => { setSt("pend"); setQ(""); setZone("all"); }} />
        <div className="rounded-[10px] border border-border bg-surface px-4 py-3 shadow-[var(--shadow)]">
          <div className="text-xs text-fg-muted">มูลค่ารวม {rows.length} สาขา (บาท)</div>
          <div className="mt-1 text-[22px] font-bold leading-tight text-accent tabular-nums">{fmt2(sum.totalCents / 100)}</div>
          <div className="mt-1 text-xs text-fg-muted">{fmt0(sum.totalN)} ราย</div>
        </div>
        <div className="rounded-[10px] border border-border bg-surface px-4 py-3 shadow-[var(--shadow)]">
          <div className="text-xs text-fg-muted">ส่วนต่างจากเดือนก่อน (บาท)</div>
          <div className={cx("mt-1 text-[22px] font-bold leading-tight tabular-nums", diff < 0 ? "text-danger" : diff > 0 ? "text-ok" : "")}>{fmtSigned(diff / 100)}</div>
          <div className="mt-1 text-xs text-fg-muted">เทียบเดือนก่อนหน้า (เฉพาะสาขาที่มีข้อมูล)</div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(380px,1fr)] items-start gap-4 max-[1180px]:grid-cols-1">
        {/* ตาราง */}
        <section aria-labelledby="port-tbl" className="min-w-0 rounded-[10px] border border-border bg-surface shadow-[var(--shadow)]">
          <h3 id="port-tbl" className="m-0 flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
            {rows.length} สาขาต่างจังหวัด <Pill tone="na">{shown.length} / {rows.length} สาขา</Pill>
          </h3>
          <div className="flex flex-wrap items-end gap-2.5 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="port-q" className="text-xs text-fg-muted">ค้นหาสาขา</label>
              <input id="port-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="เช่น ตาก" className={FIELD} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="port-zone" className="text-xs text-fg-muted">เขต</label>
              <select id="port-zone" value={zone} onChange={(e) => setZone(e.target.value)} className={FIELD}>
                <option value="all">ทุกเขต</option>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="port-st" className="text-xs text-fg-muted">สถานะ</label>
              <select id="port-st" value={st} onChange={(e) => setSt(e.target.value as StatusFilter)} className={FIELD}>
                <option value="all">ทั้งหมด</option>
                <option value="pend">ยังไม่อัปเดต</option>
                <option value="ok">อัปเดตแล้ว</option>
                <option value="big">ส่วนต่างเกิน 10%</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table data-tour="port-list" className="w-full border-collapse text-[13px]">
              <caption className="sr-only">ตารางสถานะการอัปเดต port ของสาขาต่างจังหวัดในเดือนที่เลือก</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>สาขา</th>
                  <th scope="col" className={th}>สถานะ</th>
                  <th scope="col" className={th}>อัปเดตโดย</th>
                  <th scope="col" className={cx(th, "text-right")}>ราย</th>
                  <th scope="col" className={cx(th, "text-right")}>มูลค่ารวม (บาท)</th>
                  <th scope="col" className={cx(th, "text-right")}>เดือนก่อน</th>
                  <th scope="col" className={cx(th, "text-right")}>ส่วนต่าง</th>
                  <th scope="col" className={th}>เทียบยอด</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-fg-muted">ไม่พบสาขาตามตัวกรอง</td></tr>
                ) : (
                  zones.filter((z) => shown.some((r) => r.area === z)).map((z) => {
                    const g = shown.filter((r) => r.area === z);
                    const gs = summarizeRows(g);
                    const gd = gs.totalCents - gs.prevCents;
                    const col = !!collapsed[z];
                    return (
                      <Fragment key={z}>
                        <tr className="bg-surface-3 text-xs font-semibold">
                          <th scope="rowgroup" className="border-t border-border-strong px-2 py-1.5 text-left">
                            <button type="button" aria-expanded={!col} onClick={() => toggleZone(z)} className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-semibold text-fg max-md:min-h-11">
                              <Icon name={col ? "chevron-right" : "chevron-down"} />
                              {z} <span className="font-normal text-fg-muted">{g.length} สาขา</span>
                            </button>
                          </th>
                          <td className="border-t border-border-strong px-2 py-1.5"><Pill tone={gs.updated === g.length ? "ok" : "pend"}>{gs.updated} / {g.length} อัปเดตแล้ว</Pill></td>
                          <td className="border-t border-border-strong" />
                          <td className="border-t border-border-strong px-2 py-1.5 text-right tabular-nums">{fmt0(gs.totalN)}</td>
                          <td className="border-t border-border-strong px-2 py-1.5 text-right tabular-nums">{fmt2(gs.totalCents / 100)}</td>
                          <td className="border-t border-border-strong px-2 py-1.5 text-right tabular-nums">{fmt2(gs.prevCents / 100)}</td>
                          <td className={cx("border-t border-border-strong px-2 py-1.5 text-right tabular-nums", gd > 0 ? "text-ok" : gd < 0 ? "text-danger" : "text-fg-muted")}>{fmtSigned(gd / 100)}</td>
                          <td className="border-t border-border-strong" />
                        </tr>
                        {col ? null : g.map((r) => <BranchRow key={r.index} r={r} selected={r.index === sel} dirtyMark={r.index === sel && dirty} confirmer={data.branches[r.index]?.confirmerName ?? null} onOpen={() => void openBranch(r.index)} td={td} />)}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
              {shown.length > 0 ? (() => {
                const s = summarizeRows(shown);
                return (
                  <tfoot>
                    <tr className="bg-surface-2 font-semibold">
                      <td className="border-t border-border-strong px-2 py-2">รวม {shown.length} สาขา</td><td className="border-t border-border-strong" /><td className="border-t border-border-strong" />
                      <td className="border-t border-border-strong px-2 py-2 text-right tabular-nums">{fmt0(s.totalN)}</td>
                      <td className="border-t border-border-strong px-2 py-2 text-right tabular-nums">{fmt2(s.totalCents / 100)}</td>
                      <td className="border-t border-border-strong px-2 py-2 text-right tabular-nums">{fmt2(s.prevCents / 100)}</td>
                      <td className="border-t border-border-strong px-2 py-2 text-right tabular-nums">{fmtSigned((s.totalCents - s.prevCents) / 100)}</td>
                      <td className="border-t border-border-strong" />
                    </tr>
                  </tfoot>
                );
              })() : null}
            </table>
          </div>
          <p className="m-0 border-t border-border px-4 py-2.5 text-xs text-fg-muted">
            <Icon name="flag" /> = ส่วนต่างจากเดือนก่อนเกิน 10% — ไม่ใช่ข้อผิดพลาด แต่ควรตรวจว่ากรอกถูก · ตัวกรอง “ส่วนต่างเกิน 10%” ดูเฉพาะรายการเหล่านี้ได้ · กดหัวเขตเพื่อพับ/กางสาขา
          </p>
        </section>

        {/* แผงแก้ไข */}
        <section id="port-editor" aria-label="แก้ไขข้อมูลสาขา" className="min-w-0 rounded-[10px] border border-border bg-surface shadow-[var(--shadow)] min-[1181px]:sticky min-[1181px]:top-[76px] min-[1181px]:max-h-[calc(100vh-92px)] min-[1181px]:overflow-y-auto">
          {branch && draft && savedDraft && ev ? (
            <PortEditor
              key={`${branch.id}:${data.month}`}
              branch={branch}
              month={data.month}
              monthLabelKey={data.monthLabelKey}
              closed={data.provinceClosed}
              bands={bands}
              draft={draft}
              savedDraft={savedDraft}
              ev={ev}
              dirty={dirty}
              saving={saving}
              saveError={saveError}
              onDraft={setDraft}
              onSave={() => void onSave()}
              onKeep={() => void onKeep()}
              onRevert={() => { setDraft(savedDraft); setSaveError(null); setToast("คืนค่าเดิมแล้ว"); }}
              onClose={() => void closeEditor()}
            />
          ) : (
            <div className="px-4 py-7 text-center text-fg-muted">
              <div className="text-[26px]"><Icon name="pointer" /></div>
              <b className="mt-1.5 block text-fg">เลือกสาขาจากตารางด้านซ้าย</b>
              <span>แล้วกรอก 8 tier หรือวางตารางจาก Excel ได้ที่นี่</span>
            </div>
          )}
        </section>
      </div>

      {dialog}
      <Toast message={toast} onClose={() => setToast("")} />
    </div>
  );
}

function StatButton({ tone, label, value, sub, onClick }: { tone: "ok" | "warn"; label: string; value: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`กดเพื่อดูเฉพาะ${label}`}
      className="w-full cursor-pointer rounded-[10px] border border-border bg-surface px-4 py-3 text-left shadow-[var(--shadow)] hover:border-border-strong max-md:min-h-11"
    >
      <div className="text-xs text-fg-muted">{label}</div>
      <div className={cx("mt-1 text-[22px] font-bold leading-tight tabular-nums", tone === "ok" ? "text-ok" : "text-warn")}>{value}</div>
      <div className="mt-1 text-xs text-fg-muted">{sub}</div>
    </button>
  );
}

function BranchRow({ r, selected, dirtyMark, confirmer, onOpen, td }: { r: TableRow; selected: boolean; dirtyMark: boolean; confirmer: string | null; onOpen: () => void; td: string }) {
  const s = r.state;
  const diffCls = r.diffCents === null ? "text-fg-muted" : r.diffCents > 0 ? "text-ok" : r.diffCents < 0 ? "text-danger" : "text-fg-muted";
  return (
    <tr aria-current={selected ? "true" : undefined} className={cx("hover:bg-surface-2", selected && "bg-accent-soft hover:bg-accent-soft")}>
      <td className={cx(td, "pl-6")}>
        <button type="button" onClick={onOpen} aria-label={`เปิดแก้ไขสาขา${r.name} ${r.area}`} className="cursor-pointer border-0 bg-transparent p-0 py-0.5 text-left text-[13px] font-semibold text-fg hover:text-accent-strong hover:underline max-[860px]:inline-flex max-[860px]:min-h-11 max-[860px]:items-center">
          {r.name}
        </button>
        {dirtyMark ? <span className="ml-1.5"><Pill tone="pend">● แก้อยู่ ยังไม่บันทึก</Pill></span> : null}
      </td>
      <td className={td}>
        {s.updated ? <Pill tone="ok"><Icon name="check" /> อัปเดตแล้ว</Pill>
          : s.kind === "readonly" ? <Pill tone="na">ข้อมูลเก่า</Pill>
          : <span className="inline-flex flex-wrap items-center gap-1">
              <Pill tone="pend" title={s.from ? `ค่ายกมาจาก ${s.from}` : undefined}><Icon name="circle" /> ยังไม่อัปเดต</Pill>
              {s.strictValues ? <Pill tone="info">ต้องกรอกเอง</Pill> : null}
            </span>}
      </td>
      <td className={cx(td, "text-xs")}>
        {s.updated && confirmer ? <b className="block font-medium">{confirmer}</b> : null}
        {s.updated ? <span className="block text-xs text-fg-muted">{formatThaiDateTime(s.confirmedAt)}</span> : <span className="text-fg-muted">–</span>}
      </td>
      <td className={cx(td, "text-right tabular-nums")}>{fmt0(r.totalN)}</td>
      <td className={cx(td, "text-right tabular-nums")}>{fmt2(r.totalCents / 100)}</td>
      <td className={cx(td, "text-right tabular-nums")}>{s.prevCents === null ? "–" : fmt2(s.prevCents / 100)}</td>
      <td className={cx(td, "text-right tabular-nums", diffCls, r.bigDiff && "font-semibold")}>
        {r.diffCents === null ? "–" : fmtSigned(r.diffCents / 100)}
        {r.bigDiff ? <span title="ส่วนต่างเกิน 10% จากเดือนก่อน — ตรวจว่ากรอกถูกหรือไม่" className="ml-1"><Icon name="flag" /></span> : null}
      </td>
      <td className={td}>
        {r.reportMatch === true ? <Pill tone="ok">ตรง</Pill> : r.reportMatch === false ? <Pill tone="miss">ไม่ตรง</Pill> : <Pill tone="na">{s.kind === "carried" || s.kind === "legacy-carry" || s.kind === "empty" ? "–" : "ไม่ได้เทียบ"}</Pill>}
      </td>
    </tr>
  );
}

