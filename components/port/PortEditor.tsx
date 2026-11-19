"use client";

/**
 * แผงแก้ไขสาขาเดียว (ฝั่งขวาของหน้า /admin/port · mockup `provincial-port-update.html`)
 *
 * Logic summary:
 *   * ฟอร์มคุมจากภายนอก (PortClient ถือ draft) — ที่นี่ถือเฉพาะข้อความที่วาง (paste) และผลอ่าน
 *   * ตรวจเป็นสด: `evalDraft` (portLogic) → ข้อความรายแถว + กล่อง error + ปุ่มบันทึกปิดเมื่อมี error (5.11 ยอดไม่ตรง = บันทึกไม่ได้)
 *   * วางจาก Excel: กด Ctrl+V ตรงไหนของหน้าก็ได้ (ยกเว้นขณะอยู่ในช่องกรอก) · อ่านแล้วเห็นตัวอย่างก่อนกด "ใส่ลงฟอร์ม"
 *   * legacy (2.85 Q1): ไม่มีปุ่ม "ยืนยันใช้ค่าเดิม" + ข้อความให้กรอกจากรายงาน
 *   * แถวที่เป็น legacy ของเดือนนี้เอง (readonly) = ดูได้อย่างเดียว
 *   * แถบปุ่มล่าง ติด `data-sticky-savebar` (ให้แบนเนอร์อัปเดตเวอร์ชันหลบ)
 */
import { useEffect, useRef, useState } from "react";

import { Button, TierBadge, cx } from "@/components/ui";
import { formatThaiDateTime } from "@/components/dashboard-sync/syncLogic";

import { Icon, Notice, Pill } from "./PortBits";
import type { PortBranch } from "./portData";
import {
  applyPasteToDraft,
  EMPTY_CARRY_MESSAGE,
  fmt0,
  fmt2,
  fmtSigned,
  LEGACY_CARRY_MESSAGE,
  MANUAL_TIER_KEYS,
  parseNum,
  parsePaste,
  type BandText,
  type Draft,
  type EvalResult,
  type PasteResult,
} from "./portLogic";

const INPUT =
  "w-full rounded-lg border border-border-strong bg-surface px-2 py-1 text-right text-[13px] tabular-nums text-fg " +
  "min-h-8 max-md:min-h-11 max-md:text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export interface PortEditorProps {
  branch: PortBranch;
  month: string;
  monthLabelKey: string;
  closed: boolean;
  bands: BandText[] | null;
  draft: Draft;
  savedDraft: Draft;
  ev: EvalResult;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  onDraft: (d: Draft) => void;
  onSave: () => void;
  onKeep: () => void;
  onRevert: () => void;
  onClose: () => void;
}

function tierParts(key: string): { tier: "S" | "M" | "L" | "XL"; years: 1 | 3 } {
  return { tier: key.slice(0, -1).toUpperCase() as "S" | "M" | "L" | "XL", years: key.endsWith("3") ? 3 : 1 };
}

export function PortEditor(p: PortEditorProps) {
  const { branch, draft, ev, dirty } = p;
  const st = branch.state;
  const readonly = st.kind === "readonly";
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState<PasteResult | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const applyBtn = useRef<HTMLButtonElement>(null);

  const readPaste = (txt: string) => {
    setApplied(null);
    setParsed(txt.trim() ? parsePaste(txt) : null);
  };

  // วางที่ไหนก็ได้ในหน้า → ใส่ช่องวางแล้วอ่านทันที (ไม่ยุ่งถ้าเคอร์เซอร์อยู่ในช่องกรอก)
  useEffect(() => {
    if (readonly) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,select,dialog")) return;
      const txt = e.clipboardData?.getData("text") ?? "";
      if (!txt.trim()) return;
      e.preventDefault();
      setPasteText(txt);
      readPaste(txt);
      setTimeout(() => applyBtn.current?.focus(), 0);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [readonly]);

  const setCell = (k: number, field: "count" | "value", v: string) => {
    const tiers = draft.tiers.map((t, i) => (i === k ? { ...t, [field]: v } : t));
    p.onDraft({ ...draft, tiers });
  };
  const fixFmt = (v: string, dp: 0 | 2, blankOk = false): string => {
    if (blankOk && v.trim() === "") return v;
    const n = parseNum(v);
    if (Number.isNaN(n)) return v;
    return dp === 0 ? String(Math.round(n)) : fmt2(n);
  };
  const enterNext = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const els = Array.from(root.current?.querySelectorAll<HTMLInputElement>("input[data-fld]") ?? []);
    const i = els.indexOf(e.currentTarget);
    if (i >= 0 && i < els.length - 1) { els[i + 1]?.focus(); els[i + 1]?.select(); }
  };

  const foundKeys = MANUAL_TIER_KEYS.filter((k) => parsed?.tiers[k]);
  const missingKeys = MANUAL_TIER_KEYS.filter((k) => !parsed?.tiers[k]);
  const diffCents = st.prevCents === null ? null : ev.total.cents - st.prevCents;
  const bigDiff = diffCents !== null && st.prevCents !== null && st.prevCents > 0 && Math.abs(diffCents) / st.prevCents > 0.1;

  return (
    <div ref={root}>
      {/* หัวแผง */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div>
          <h3 id="port-ed-h" className="m-0 text-[15px] font-semibold">
            {branch.name} <span className="text-[13px] font-normal text-fg-muted">· {branch.area} · {p.monthLabelKey}</span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {st.updated ? (
              <>
                <Pill tone="ok"><Icon name="check" /> อัปเดตแล้ว</Pill>
                <span className="text-xs text-fg-muted">{formatThaiDateTime(st.confirmedAt)}{branch.confirmerName ? ` · ${branch.confirmerName}` : ""}</span>
              </>
            ) : readonly ? (
              <Pill tone="na">ข้อมูลเก่า (อ่านอย่างเดียว)</Pill>
            ) : (
              <Pill tone="pend"><Icon name="circle" /> ยังไม่อัปเดต</Pill>
            )}
          </div>
        </div>
        <Button size="sm" onClick={p.onClose} aria-label="ปิดแผงแก้ไข" className="max-md:min-h-11"><Icon name="x" /> ปิด</Button>
      </div>

      <div className="px-4 py-3.5">
        {/* ข้อความตามที่มาของค่า */}
        {st.kind === "carried" ? (
          <Notice tone="info" className="mb-3">
            <b>ค่านี้ยกมาจาก {st.from}</b> — ยังไม่ได้ยืนยันสำหรับเดือน {p.monthLabelKey}
            <small>แก้ตัวเลข/วางตารางใหม่แล้วกดบันทึก หรือกด &quot;ยืนยันใช้ค่าเดิม&quot; ถ้าไม่มีการเปลี่ยนแปลง</small>
          </Notice>
        ) : null}
        {st.kind === "legacy-carry" ? <Notice tone="warn" className="mb-3"><b>ต้องกรอกจากรายงาน</b><small>{LEGACY_CARRY_MESSAGE}</small></Notice> : null}
        {st.kind === "empty" ? <Notice tone="warn" className="mb-3"><b>ต้องกรอกจากรายงาน</b><small>{EMPTY_CARRY_MESSAGE}</small></Notice> : null}
        {readonly ? (
          <Notice tone="warn" className="mb-3">
            <b>เดือนนี้เป็นข้อมูลเก่าที่นำเข้ามา</b>
            <small>แก้ในหน้านี้ไม่ได้ — ระบบเก็บไว้เป็นยอดรวมเดิมสำหรับ Dashboard</small>
          </Notice>
        ) : null}
        {p.closed && !readonly ? (
          <Notice tone="warn" className="mb-3">เดือนนี้ปิดแล้ว — บันทึกได้ และจะลง audit log · ตัวเลขที่แก้จะส่งขึ้น Dashboard ในรอบ 06:00 ถัดไป</Notice>
        ) : null}

        {/* วางจาก Excel */}
        {!readonly ? (
          <div className="mb-3 rounded-lg border border-dashed border-border-strong bg-surface-2 p-3">
            <b className="text-[13px]">วางตารางจาก Excel / เว็บ</b>
            <p className="m-0 mb-1.5 mt-0.5 text-xs text-fg-muted">
              ลากคลุมตารางใน Excel แล้ว Ctrl+C → กด <b>Ctrl+V ตรงไหนของหน้านี้ก็ได้</b> (หรือวางในช่องด้านล่าง) ระบบอ่านให้ทันที จับคู่ S1…XL3 จากป้ายเช่น &quot;S1 (&lt;30K)&quot; ·
              &quot;-&quot; = 0 · บรรทัด &quot;รวมทั้งสิ้น&quot; ใช้เป็นยอดรายงาน · แล้วกด &quot;ใส่ลงฟอร์ม&quot;
            </p>
            <label htmlFor="port-paste" className="sr-only">ข้อความตารางที่วาง</label>
            <textarea
              id="port-paste"
              spellCheck={false}
              value={pasteText}
              placeholder={"S1\t8\t143,688.73\nS3\t29\t1,175,706.72\n…\nรวมทั้งสิ้น\t43\t1,853,040.30"}
              onChange={(e) => { setPasteText(e.target.value); setParsed(null); setApplied(null); }}
              onPaste={(e) => { const txt = e.clipboardData.getData("text"); setTimeout(() => readPaste(txt), 0); }}
              className="min-h-[104px] w-full resize-y whitespace-pre rounded-lg border border-border-strong bg-surface p-2 font-mono text-xs text-fg max-md:text-base"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => readPaste(pasteText)} className="max-md:min-h-11">อ่านข้อมูล</Button>
              {parsed && foundKeys.length > 0 ? (
                <button
                  ref={applyBtn}
                  type="button"
                  onClick={() => {
                    p.onDraft(applyPasteToDraft(draft, parsed));
                    setApplied(foundKeys.length);
                    setParsed(null);
                  }}
                  className="min-h-[30px] cursor-pointer rounded-lg border border-accent bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg max-md:min-h-11"
                >
                  ใส่ลงฟอร์ม
                </button>
              ) : null}
              <Button size="sm" onClick={() => { setPasteText(""); setParsed(null); setApplied(null); }} className="max-md:min-h-11">ล้าง</Button>
            </div>
            <div aria-live="polite">
              {parsed && foundKeys.length === 0 ? (
                <Notice tone="danger" className="mt-2"><b>จับคู่ tier ไม่ได้เลย</b><small>แต่ละบรรทัดควรขึ้นต้นด้วย S1, S3, M1, M3, L1, L3, XL1 หรือ XL3 ตามด้วยจำนวนและมูลค่า (คั่นด้วย tab)</small></Notice>
              ) : null}
              {parsed && foundKeys.length > 0 ? (
                <div className="mt-2 text-xs">
                  <b>ตรวจแล้ว:</b> จับคู่ได้ {foundKeys.length} / 8 tier{parsed.report ? " · พบยอดรวมทั้งสิ้น" : " · ไม่พบบรรทัด “รวมทั้งสิ้น”"}
                  <ul className="m-0 mt-2 list-none p-0">
                    {foundKeys.map((k) => {
                      const x = parsed.tiers[k]!;
                      const idx = MANUAL_TIER_KEYS.indexOf(k);
                      const oldN = parseNum(draft.tiers[idx]?.count);
                      const oldV = parseNum(draft.tiers[idx]?.value);
                      const changed = oldN !== x.n || Math.round((Number.isNaN(oldV) ? 0 : oldV) * 100) !== Math.round(x.v * 100);
                      const tp = tierParts(k);
                      return (
                        <li key={k} className="flex flex-wrap items-center gap-2 border-b border-border py-1 last:border-0">
                          <TierBadge tier={tp.tier} years={tp.years} />
                          <span className="min-w-[52px]">{fmt0(x.n)} ราย</span>
                          <span>{fmt2(x.v)}</span>
                          {changed ? <Pill tone="info">เปลี่ยนจาก {fmt0(Number.isNaN(oldN) ? 0 : oldN)} / {fmt2(Number.isNaN(oldV) ? 0 : oldV)}</Pill> : <Pill tone="na">เท่าเดิม</Pill>}
                          {x.swapped ? <Pill tone="pend">สลับคอลัมน์ให้ (พบมูลค่ามาก่อนจำนวน)</Pill> : null}
                        </li>
                      );
                    })}
                  </ul>
                  {parsed.report ? <div className="mt-1.5">ยอดรายงาน: <b>{fmt0(parsed.report.n)} ราย · {fmt2(parsed.report.v)} บาท</b></div> : null}
                  {missingKeys.length > 0 ? (
                    <Notice tone="warn" className="mt-2">ไม่พบ {missingKeys.map((k) => k.toUpperCase()).join(", ")} ในข้อความ — จะ<b>คงค่าเดิมไว้</b> (ไม่ตั้งเป็น 0)</Notice>
                  ) : null}
                  {parsed.issues.length > 0 ? <Notice tone="warn" className="mt-2"><div>{parsed.issues.map((m) => <div key={m}>{m}</div>)}</div></Notice> : null}
                </div>
              ) : null}
              {applied !== null ? <Notice tone="ok" className="mt-2" live>ใส่ลงฟอร์มแล้ว {applied} tier — ตรวจยอดด้านล่างแล้วกดบันทึก</Notice> : null}
            </div>
          </div>
        ) : null}

        {/* ตาราง 8 tier */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">ตารางจำนวนและมูลค่าสัญญา 8 tier ของสาขา</caption>
            <thead>
              <tr className="text-left text-xs text-fg-muted">
                <th scope="col" className="border-b border-border-strong px-1.5 py-1.5 font-semibold">Tier</th>
                <th scope="col" className="border-b border-border-strong px-1.5 py-1.5 font-semibold max-[860px]:hidden">
                  {p.closed ? "ช่วงมูลค่า (เกณฑ์ ณ ตอนปิดเดือน)" : "ช่วงมูลค่า (เกณฑ์ปัจจุบัน)"}
                </th>
                <th scope="col" className="border-b border-border-strong px-1.5 py-1.5 text-right font-semibold">จำนวน (ราย)</th>
                <th scope="col" className="border-b border-border-strong px-1.5 py-1.5 text-right font-semibold">มูลค่ารวม (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {MANUAL_TIER_KEYS.map((key, k) => {
                const tp = tierParts(key);
                const err = ev.rowErrors[k];
                const wrn = ev.rowWarns[k];
                const label = key.toUpperCase();
                const dt = draft.tiers[k] ?? { count: "", value: "" };
                const sv = p.savedDraft.tiers[k] ?? dt;
                const band = p.bands?.[k];
                const cChg = dt.count !== sv.count && parseNum(dt.count) !== parseNum(sv.count);
                const vChg = dt.value !== sv.value && parseNum(dt.value) !== parseNum(sv.value);
                return (
                  <tr key={key}>
                    <td className="border-b border-border px-1.5 py-1.5 align-top"><TierBadge tier={tp.tier} years={tp.years} /></td>
                    <td className="border-b border-border px-1.5 py-1.5 align-top text-xs leading-snug text-fg-muted max-[860px]:hidden">
                      {band ? <>{band.line1}<small className="block text-xs text-fg-faint">{band.line2}</small></> : "–"}
                    </td>
                    <td className="w-[84px] border-b border-border px-1.5 py-1.5 align-top">
                      <input
                        data-fld inputMode="numeric" autoComplete="off" disabled={readonly}
                        aria-label={`จำนวนสัญญา ${label}`} aria-invalid={err ? true : undefined}
                        value={dt.count}
                        onChange={(e) => setCell(k, "count", e.target.value)}
                        onBlur={(e) => setCell(k, "count", fixFmt(e.target.value, 0))}
                        onKeyDown={enterNext}
                        className={cx(INPUT, err && "border-danger bg-danger-soft", !err && cChg && "border-accent")}
                      />
                    </td>
                    <td className="min-w-[132px] border-b border-border px-1.5 py-1.5 align-top">
                      <input
                        data-fld inputMode="decimal" autoComplete="off" disabled={readonly}
                        aria-label={`มูลค่ารวม ${label} (บาท)`} aria-invalid={err ? true : undefined}
                        value={dt.value}
                        onChange={(e) => setCell(k, "value", e.target.value)}
                        onBlur={(e) => setCell(k, "value", fixFmt(e.target.value, 2))}
                        onKeyDown={enterNext}
                        className={cx(INPUT, err && "border-danger bg-danger-soft", !err && vChg && "border-accent")}
                      />
                      {err || wrn ? <span className={cx("mt-0.5 block whitespace-normal text-right text-xs", err ? "text-danger" : "text-warn")}>{err || wrn}</span> : null}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-surface-2 font-semibold">
                <td colSpan={2} className="px-1.5 py-2 max-[860px]:hidden">รวมที่ระบบคำนวณ</td>
                <td className="hidden px-1.5 py-2 max-[860px]:table-cell">รวม</td>
                <td className="px-1.5 py-2 text-right tabular-nums">{fmt0(ev.total.n)}</td>
                <td className="px-1.5 py-2 text-right tabular-nums">{fmt2(ev.total.cents / 100)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ยอดจากรายงาน */}
        <div className="mt-3.5 rounded-lg border border-border bg-surface-2 p-3">
          <h4 className="m-0 mb-2 text-[13px] font-semibold">ยอดจากรายงาน (รวมทั้งสิ้น) — ใช้ตรวจยอดก่อนบันทึก</h4>
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <label htmlFor="port-rn" className="min-w-24 text-xs text-fg-muted">จำนวน (ราย)</label>
            <input
              id="port-rn" data-fld inputMode="numeric" autoComplete="off" disabled={readonly}
              value={draft.reportCust}
              onChange={(e) => p.onDraft({ ...draft, reportCust: e.target.value })}
              onBlur={(e) => p.onDraft({ ...draft, reportCust: fixFmt(e.target.value, 0, true) })}
              onKeyDown={enterNext}
              className={cx(INPUT, "w-[84px]", (ev.reportState === "partial" || ev.reportState === "bad" || ev.match === false) && "border-danger bg-danger-soft")}
            />
          </div>
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <label htmlFor="port-rv" className="min-w-24 text-xs text-fg-muted">มูลค่า (บาท)</label>
            <input
              id="port-rv" data-fld inputMode="decimal" autoComplete="off" disabled={readonly}
              value={draft.reportValue}
              onChange={(e) => p.onDraft({ ...draft, reportValue: e.target.value })}
              onBlur={(e) => p.onDraft({ ...draft, reportValue: fixFmt(e.target.value, 2, true) })}
              onKeyDown={enterNext}
              className={cx(INPUT, "w-[132px]", (ev.reportState === "partial" || ev.reportState === "bad" || ev.match === false) && "border-danger bg-danger-soft")}
            />
          </div>
          <div aria-live="polite">
            {ev.reportState === "ok" && ev.match ? <Pill tone="ok"><Icon name="check" /> ตรงกับรายงาน ({fmt0(ev.report!.cust)} ราย · {fmt2(ev.report!.value)} บาท)</Pill> : null}
            {ev.reportState === "ok" && !ev.match ? <Pill tone="miss"><Icon name="x" /> ไม่ตรง — จำนวนต่าง {ev.dn} ราย · มูลค่าต่าง {fmtSigned(ev.dCents / 100)} บาท</Pill> : null}
            {ev.reportState === "none" ? <Pill tone="pend" wrap>ยังไม่ได้เทียบยอดรายงาน — บันทึกได้ แต่แนะนำให้กรอกยอดจากรายงานเพื่อตรวจ</Pill> : null}
            {ev.reportState === "partial" || ev.reportState === "bad" ? <Pill tone="miss">ยอดรายงานกรอกไม่ครบ/ผิดรูปแบบ</Pill> : null}
          </div>
        </div>

        {/* เดือนก่อน / ส่วนต่าง / cust */}
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
            <span className="block text-xs text-fg-muted">มูลค่าเดือนก่อน (บาท)</span>
            <b className="mt-0.5 block text-sm tabular-nums">{st.prevCents === null ? "–" : fmt2(st.prevCents / 100)}</b>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
            <span className="block text-xs text-fg-muted">ส่วนต่าง</span>
            <b className={cx("mt-0.5 block text-sm tabular-nums", diffCents === null ? "" : diffCents > 0 ? "text-ok" : diffCents < 0 ? "text-danger" : "text-fg-muted")}>
              {diffCents === null ? "–" : fmtSigned(diffCents / 100)}{bigDiff ? <> <Icon name="flag" /></> : null}
            </b>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
            <span className="block text-xs text-fg-muted">สัญญาทั้งหมด (cust)</span>
            <b className="mt-0.5 block text-sm tabular-nums">{fmt0(ev.total.n)} ราย</b>
          </div>
        </div>

        {/* error จากการตรวจ / จากการบันทึก */}
        {ev.errors.length > 0 && !readonly ? (
          <div role="alert" className="mt-3 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-[12.5px]">
            <b>บันทึกยังไม่ได้ — แก้รายการนี้ก่อน</b>
            <ul className="m-0 mt-1 list-disc pl-[18px]">{ev.errors.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        ) : null}
        {ev.warnings.length > 0 && !readonly ? (
          <Notice tone="warn" className="mt-3">{ev.warnings.map((m) => <div key={m}>{m}</div>)}</Notice>
        ) : null}
        {p.saveError ? <Notice tone="danger" className="mt-3"><b>บันทึกไม่สำเร็จ</b><small>{p.saveError}</small></Notice> : null}

        <p className="m-0 mt-3 flex items-start gap-2 text-xs text-fg-muted">
          <span className="mt-0.5 text-accent"><Icon name="info" /></span>
          <span>บันทึก = เก็บเป็นข้อมูลของสาขานี้เดือนนี้ (source = manual) และส่ง Dashboard ในรอบถัดไป · เกณฑ์ band ในตารางอ่านจากหน้าตั้งค่า</span>
        </p>
      </div>

      {/* แถบปุ่มล่าง */}
      {!readonly ? (
        <div data-sticky-savebar className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-b-[10px] border-t border-border bg-surface px-4 py-3">
          <Button variant="save" disabled={!ev.canSave || p.saving} loading={p.saving} onClick={p.onSave} className="max-md:!h-11">
            {st.updated ? "บันทึกการแก้ไข" : "บันทึกเป็น “อัปเดตแล้ว”"}
          </Button>
          {st.canKeepSame && !dirty && !st.updated ? (
            <Button disabled={p.saving} onClick={p.onKeep} className="max-md:min-h-11">ยืนยันใช้ค่าเดิม<span className="max-md:hidden"> (ไม่มีการเปลี่ยนแปลง)</span></Button>
          ) : null}
          {dirty ? <Button disabled={p.saving} onClick={p.onRevert} className="max-md:min-h-11">คืนค่าเดิม</Button> : null}
          {dirty ? <span className="text-xs text-warn">● มีการแก้ไขที่ยังไม่บันทึก</span> : null}
        </div>
      ) : null}
    </div>
  );
}
