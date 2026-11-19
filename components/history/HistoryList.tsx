"use client";

/**
 * รายการประวัติ 2 มุมมอง: ตาราง / ไทม์ไลน์ (mockup FINAL docs/mockup/history-log.html)
 *
 * Logic summary:
 *   * รับ entries ที่เรียงแล้วจากตัวแม่ (เรียงที่ฐานข้อมูลด้วย keyset — ที่นี่ไม่เรียงซ้ำ)
 *   * ทั้ง 2 มุมมองใช้ข้อมูลและฟังก์ชันอธิบาย (describeAudit) ชุดเดียวกัน
 *   * แถว "แก้หลังปิด": แถบสี + ป้ายกุญแจ + บอกว่าเดือนของข้อมูลปิดแล้ว (ค่าที่ส่ง Dashboard ยังเป็นค่าเดิม)
 *   * กดทั้งแถวเพื่อกาง/ซ่อนรายละเอียด (ปุ่มลูกศรไว้สำหรับคีย์บอร์ด) · กลุ่มการกรอกปกติโหลดรายการย่อยตอนกาง
 *   * ⚠ แสดงข้อมูลลูกค้าบนจอเท่านั้น — ไม่ log ไม่ใส่ URL
 */
import { useEffect, useState } from "react";

import { cx } from "@/components/ui";

import { HistoryIcon } from "./HistoryIcons";
import type { VisitDetail } from "./historyData";
import { changePhrase, describeAudit, formatMonthKey, formatThaiDate, formatThaiDateTime } from "./historyDiff";
import type { ExportCtx } from "./historyExport";
import { bucketByDay } from "./historyGroups";
import { ACTION_LABEL, kindLabel, kindOfTable } from "./historyLabels";
import type { AuditEntry, HistoryEntry, ViewMode, VisitGroupEntry } from "./historyTypes";

export interface HistoryListProps {
  entries: HistoryEntry[];
  view: ViewMode;
  lookup: ExportCtx;
  openKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
  loadGroupDetails: (ids: readonly string[]) => Promise<VisitDetail[] | null>;
}

const ACT_CLASS = {
  insert: "bg-ok-soft text-ok",
  update: "bg-accent-soft text-accent-strong",
  delete: "bg-danger-soft text-danger",
} as const;
const DOT_CLASS = { insert: "bg-ok", update: "bg-accent", delete: "bg-danger" } as const;

function PostCloseBadge() {
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border-[1.5px] border-warn bg-surface px-2.5 py-px text-xs font-bold text-fg"
      title="แก้ข้อมูลของเดือนที่ปิดแล้ว · ค่าที่ส่ง Dashboard ยังเป็นค่าเดิมจนกว่าจะสั่งคำนวณ snapshot ใหม่"
    >
      <HistoryIcon name="lock" className="text-warn" />
      แก้หลังปิดเดือน
    </span>
  );
}

function personText(e: HistoryEntry, lookup: ExportCtx): { name: string; sub: string } {
  if (e.type === "group") return { name: e.userId ? (lookup.personName(e.userId) ?? "ไม่ระบุชื่อ") : "ระบบ", sub: "ผู้กรอกผลบริการ" };
  const r = e.row;
  return {
    name: r.changedBy ? (lookup.personName(r.changedBy) ?? "ไม่ระบุชื่อ") : "ระบบ",
    sub: lookup.positionLabel(r.actorPositionCode),
  };
}

function whereText(e: HistoryEntry, lookup: ExportCtx): { branch: string; sub: string } {
  if (e.type === "group") {
    const names = e.branchIds.map((b) => lookup.branchName(b)).filter((x): x is string => !!x);
    return { branch: names.length > 2 ? `${names.slice(0, 2).join(" / ")} +${names.length - 2}` : names.join(" / ") || "-", sub: "หลายสัญญา" };
  }
  const r = e.row;
  const c = lookup.contract(r.contractId);
  return {
    branch: (r.branchId ? lookup.branchName(r.branchId) : null) ?? "-",
    sub: c ? `${c.contractNo}${c.customerName ? ` · ${c.customerName}` : ""}` : "",
  };
}

function monthNote(e: AuditEntry, closed: boolean) {
  const mk = e.row.monthKey;
  if (!mk) return null;
  return closed ? (
    <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-fg">
      <HistoryIcon name="lock" className="text-warn" /> ข้อมูลเดือน {formatMonthKey(mk)} (ปิดแล้ว)
    </span>
  ) : (
    <span className="mt-0.5 block text-xs text-fg-muted">ข้อมูลเดือน {formatMonthKey(mk)}</span>
  );
}

function ChangeText({ e, lookup, closed }: { e: HistoryEntry; lookup: ExportCtx; closed: boolean }) {
  if (e.type === "group") {
    return (
      <span>
        <span className="mr-1 inline-block rounded-md border border-border-strong bg-surface-3 px-2 py-px text-xs text-fg-muted">กรอก {e.count} รายการ</span>
        กรอกผลบริการประจำเดือน {e.count} รายการ
      </span>
    );
  }
  const d = describeAudit(e.row, lookup);
  return (
    <span>
      <span className={cx("mr-1 inline-block rounded-md px-2 py-px text-xs font-semibold", ACT_CLASS[e.row.action])}>{ACTION_LABEL[e.row.action]}</span>
      {d.headline}
      {closed && <PostCloseBadge />}
    </span>
  );
}

function GroupDetail({ e, load }: { e: VisitGroupEntry; load: HistoryListProps["loadGroupDetails"] }) {
  const [rows, setRows] = useState<VisitDetail[] | null | undefined>(undefined);
  const [shown, setShown] = useState(10);
  useEffect(() => {
    let alive = true;
    void load(e.visitIds).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [e.visitIds, load]);

  return (
    <div className="text-[12.5px]">
      <div className="text-xs text-fg-muted">
        รายการย่อยของกลุ่มนี้ <b className="text-fg">{e.count}</b> รายการ · กรอกเมื่อ {formatThaiDateTime(e.firstAt)}–{formatThaiDateTime(e.at).slice(-5)}
      </div>
      {rows === undefined && <p className="m-0 mt-2 text-fg-muted">กำลังโหลดรายการย่อย…</p>}
      {rows === null && <p role="alert" className="m-0 mt-2 text-danger">โหลดรายการย่อยไม่สำเร็จ ลองกางใหม่อีกครั้ง</p>}
      {rows && (
        <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface">
          {rows.slice(0, shown).map((r) => (
            <div key={r.id} className="flex flex-wrap gap-x-3 border-t border-border px-2.5 py-1.5 first:border-t-0">
              <span className="w-28 flex-none text-fg-muted">{r.contractNo}</span>
              <span className="min-w-0 flex-1 break-words">{r.customerName}</span>
              <span className="text-fg-muted">เข้าบริการ {formatThaiDate(r.visitDate)}</span>
            </div>
          ))}
          {rows.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + 20)} className="min-h-9 w-full border-t border-border px-2.5 py-1.5 text-left text-xs text-accent-strong hover:bg-surface-2 max-[767px]:min-h-11">
              แสดงเพิ่ม (เหลือ {rows.length - shown} รายการที่โหลดไว้)
            </button>
          )}
          {e.count > rows.length && <div className="border-t border-border px-2.5 py-1.5 text-xs text-fg-muted">แสดงสูงสุด {rows.length} รายการแรกจากทั้งหมด {e.count}</div>}
        </div>
      )}
    </div>
  );
}

function Detail({ e, lookup, closed, load }: { e: HistoryEntry; lookup: ExportCtx; closed: boolean; load: HistoryListProps["loadGroupDetails"] }) {
  if (e.type === "group") return <GroupDetail e={e} load={load} />;
  const r = e.row;
  const d = describeAudit(r, lookup);
  const who = personText(e, lookup);
  const where = whereText(e, lookup);
  return (
    <div className="text-[12.5px]">
      {closed && (
        <div role="note" className="mb-2 flex items-start gap-2 rounded-lg border border-warn bg-warn-soft px-3 py-2">
          <HistoryIcon name="lock" className="mt-0.5 text-warn" />
          <div>
            <b>แก้หลังปิดเดือน</b> — แก้เมื่อ {formatThaiDateTime(r.changedAt)} แต่เป็นข้อมูลของเดือน {r.monthKey ? formatMonthKey(r.monthKey) : ""} ที่ปิดแล้ว
            <div className="text-xs text-fg-muted">ระบบไม่ล็อกข้อมูล แต่ค่าที่ส่ง Dashboard ยังเป็นค่าเดิม จนกว่าจะสั่ง “คำนวณ snapshot ใหม่” ที่หน้าส่งข้อมูลและสรุปงานประจำเดือน</div>
          </div>
        </div>
      )}
      {d.changes.length > 0 ? (
        <ul className="m-0 list-none space-y-1 p-0">
          {d.changes.map((c) => (
            <li key={c.key} className="break-words">
              {changePhrase(c)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-fg-muted">ไม่มีช่องที่ผู้ใช้เห็นเปลี่ยน</p>
      )}
      <div className="mt-2 text-xs text-fg-muted">
        ตาราง <b className="text-fg">{r.tableName}</b> · {kindLabel(kindOfTable(r.tableName))} · ผู้ทำ <b className="text-fg">{who.name}</b>
        {who.sub ? ` (${who.sub})` : ""} · สาขา {where.branch}
        {where.sub ? ` · ${where.sub}` : ""}
      </div>
    </div>
  );
}

function rowClick(ev: React.MouseEvent, toggle: () => void) {
  if ((ev.target as HTMLElement).closest("a,button")) return;
  if (typeof window !== "undefined" && String(window.getSelection?.() ?? "") !== "") return; // กำลังลากเลือกข้อความ
  toggle();
}

export function HistoryList({ entries, view, lookup, openKeys, onToggle, loadGroupDetails }: HistoryListProps) {
  if (view === "timeline") {
    return (
      <div className="max-w-3xl px-4 pb-1 pt-1.5">
        {bucketByDay(entries).map((b) => (
          <section key={b.day} aria-label={formatThaiDate(b.day)}>
            <h3 className="mb-1 mt-3.5 text-xs font-semibold text-fg-muted">{formatThaiDate(b.day)}</h3>
            {b.entries.map((e) => {
              const closed = e.type === "audit" && lookup.isPostClose(e.row);
              const open = openKeys.has(e.key);
              const who = personText(e, lookup);
              const where = whereText(e, lookup);
              return (
                <div
                  key={e.key}
                  className={cx("flex gap-3 py-1.5", closed && "my-1 rounded-r-lg bg-warn-soft pl-2.5 pr-2 shadow-[inset_3px_0_0_var(--warn)]")}
                >
                  <div className="flex w-2.5 flex-none flex-col items-center">
                    <span className={cx("mt-1.5 size-[9px] flex-none", e.type === "group" ? "rounded-sm bg-fg-faint" : cx("rounded-full", DOT_CLASS[e.row.action]))} />
                    <span className="w-px flex-1 bg-border" />
                  </div>
                  <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
                    <ChangeText e={e} lookup={lookup} closed={closed} />
                    <div className="text-xs text-fg-muted">
                      {formatThaiDateTime(e.at)} · {who.name}
                      {who.sub ? ` (${who.sub})` : ""} · {where.branch}
                      {where.sub ? ` · ${where.sub}` : ""}
                      {e.type === "audit" && e.row.monthKey ? (
                        <span className={closed ? "font-semibold text-fg" : undefined}> · ข้อมูลเดือน {formatMonthKey(e.row.monthKey)}{closed ? " (ปิดแล้ว)" : ""}</span>
                      ) : null}{" "}
                      ·{" "}
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => onToggle(e.key)}
                        className="min-h-7 rounded-md px-1.5 text-xs text-accent-strong hover:bg-surface-3 max-[767px]:min-h-11"
                      >
                        {open ? "ซ่อนรายละเอียด" : "รายละเอียด"}
                      </button>
                    </div>
                    {open && (
                      <div className="py-1.5">
                        <Detail e={e} lookup={lookup} closed={closed} load={loadGroupDetails} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr>
            {["เวลา", "ใคร", "สาขา · สัญญา", "ข้อมูล", "การเปลี่ยนแปลง"].map((h) => (
              <th key={h} scope="col" className="border-b border-border bg-surface-2 px-3 py-2.5 text-left text-xs font-semibold text-fg-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const closed = e.type === "audit" && lookup.isPostClose(e.row);
            const open = openKeys.has(e.key);
            const who = personText(e, lookup);
            const where = whereText(e, lookup);
            const tdBase = cx("border-b border-border px-3 py-2 align-top", closed ? "bg-warn-soft" : "group-hover:bg-surface-2");
            return (
              <FragmentRows key={e.key}>
                <tr className="group cursor-pointer" onClick={(ev) => rowClick(ev, () => onToggle(e.key))}>
                  <td className={cx(tdBase, "whitespace-nowrap", closed && "shadow-[inset_4px_0_0_var(--warn)]")}>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${open ? "ซ่อน" : "ดู"}รายละเอียด`}
                      onClick={() => onToggle(e.key)}
                      className="-ml-1.5 mr-0.5 inline-flex min-h-7 min-w-7 items-center justify-center rounded-md align-middle text-accent-strong hover:bg-surface-3"
                    >
                      <HistoryIcon name="chevron" className={open ? "rotate-90" : ""} />
                    </button>
                    {formatThaiDateTime(e.at)}
                  </td>
                  <td className={tdBase}>
                    {who.name}
                    {who.sub && <small className="block text-xs text-fg-muted">{who.sub}</small>}
                  </td>
                  <td className={tdBase}>
                    {where.branch}
                    {where.sub && <small className="block text-xs text-fg-muted">{where.sub}</small>}
                  </td>
                  <td className={tdBase}>
                    {e.type === "group" ? "ผลบริการ" : kindLabel(kindOfTable(e.row.tableName))}
                    {e.type === "audit" && monthNote(e, closed)}
                  </td>
                  <td className={tdBase}>
                    <ChangeText e={e} lookup={lookup} closed={closed} />
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={5} className="border-b border-border bg-surface-2 px-4 py-3 pl-11">
                      <Detail e={e} lookup={lookup} closed={closed} load={loadGroupDetails} />
                    </td>
                  </tr>
                )}
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
