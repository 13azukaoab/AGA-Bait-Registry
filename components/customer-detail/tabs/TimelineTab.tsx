"use client";

/**
 * แท็บ "ไทม์ไลน์" — ใครแก้อะไร เมื่อไหร่ ของลูกค้ารายนี้ (audit_log · เห็นเฉพาะ host — RLS ของ audit_log บังคับ)
 *
 * Logic summary:
 *   * แสดง "การเปลี่ยนแปลง" (เพิ่ม/แก้/ลบ) ล่าสุด 300 รายการ · การกรอกผลบริการครั้งแรกไม่อยู่ใน audit_log (ดูที่แท็บประวัติทำบริการ)
 *   * ข้อความเป็นภาษาคน: "แก้สัญญา: มูลค่า, ระยะสัญญา" — แสดงเฉพาะ "ชื่อช่องที่เปลี่ยน" ไม่แสดงค่าเก่า/ใหม่ (กันข้อมูลส่วนบุคคลรั่ว · server ไม่ส่งค่ามา)
 *   * ป้าย "แก้หลังปิดเดือน" ยังไม่แสดง — ต้องใช้วันปิดเดือน/คำนวณใหม่ต่อขอบเขต (อยู่ในหน้าปิดเดือน SPEC §8.2) · กรองสัญญา/เรื่อง · แบ่งหน้าละ 12
 */
import { useState } from "react";

import { Pager } from "@/components/ui";

import { auditTableLabel, bangkokDate, describeAudit, fmtDate, paginate } from "../logic";
import { CONTROL_CLASS, Empty, FilterField, Hint, Tag } from "../parts";
import type { CustomerDetailData } from "../types";

const PAGE_TL = 12;
const ACT_TONE = { insert: "ok", update: "info", delete: "miss" } as const;
const ACT_TEXT = { insert: "เพิ่ม", update: "แก้ไข", delete: "ลบ" } as const;

function timeOf(ts: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
}

export function TimelineTab({ data }: { data: CustomerDetailData }) {
  const [contract, setContract] = useState("all");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(1);
  const all = data.audit ?? [];
  const contractNo = new Map(data.contracts.map((c) => [c.id, c.no]));
  const kinds = [...new Set(all.map((e) => auditTableLabel(e.tableName)))];
  const rows = all.filter((e) => (contract === "all" || e.contractId === contract) && (kind === "all" || auditTableLabel(e.tableName) === kind));
  const pg = paginate(rows, page, PAGE_TL);

  if (data.audit === null) return <Empty>ไทม์ไลน์ดูได้เฉพาะ host</Empty>;

  let day = "";
  return (
    <div data-clarity-mask="True">
      <Hint>
        ใครแก้อะไร เมื่อไหร่ ของลูกค้ารายนี้ (เห็นเฉพาะ host) · แสดงเฉพาะ<b>การเปลี่ยนแปลง</b>และ<b>ชื่อช่องที่เปลี่ยน</b> — การกรอกผลบริการปกติดูที่แท็บ “ประวัติทำบริการ”
      </Hint>
      <div className="mb-3 flex flex-wrap gap-3">
        <FilterField label="สัญญา" htmlFor="f-tl-contract">
          <select
            id="f-tl-contract"
            className={CONTROL_CLASS}
            value={contract}
            onChange={(e) => {
              setContract(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">ทุกสัญญา</option>
            {data.contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.no}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="เรื่องที่แก้" htmlFor="f-tl-kind">
          <select
            id="f-tl-kind"
            className={CONTROL_CLASS}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">ทุกเรื่อง</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </FilterField>
      </div>
      {rows.length === 0 ? (
        <Empty>ไม่มีรายการตามเงื่อนไขที่เลือก</Empty>
      ) : (
        <>
          <ul className="m-0 list-none border-l-2 border-border p-0 pl-4">
            {pg.slice.map((e) => {
              const d = bangkokDate(e.at);
              const newDay = d !== day;
              day = d;
              return (
                <li key={e.id} className="relative pb-3">
                  {newDay ? <h4 className="m-0 mb-1 text-xs font-semibold text-fg-muted">{fmtDate(d)}</h4> : null}
                  <span
                    aria-hidden="true"
                    className={`absolute -left-[23px] top-1.5 size-2.5 rounded-full border-2 bg-surface ${e.action === "delete" ? "border-danger" : e.action === "insert" ? "border-ok" : "border-accent"}`}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <b className="tabular-nums">{timeOf(e.at)}</b>
                    <span>{e.byName ?? "—"}</span>
                    <Tag tone={ACT_TONE[e.action]}>{ACT_TEXT[e.action]}</Tag>
                    <Tag tone="na">{auditTableLabel(e.tableName)}</Tag>
                  </div>
                  <div className="mt-0.5 text-[13px]">{describeAudit(e)}</div>
                  <div className="text-xs text-fg-muted">
                    {e.contractId && contractNo.get(e.contractId) ? `${contractNo.get(e.contractId)} · ` : ""}
                    {e.monthKey ? `ข้อมูลเดือน ${e.monthKey}` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager page={pg.page} pageSize={PAGE_TL} total={rows.length} onPageChange={setPage} className="mt-2 max-md:[&_button]:min-h-11" />
        </>
      )}
    </div>
  );
}
