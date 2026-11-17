"use client";

/**
 * แท็บ "สถานี" — ตารางสถานีของลูกค้า (IG/IC/AG) + ประวัติการตรวจรายสถานี (กางแถว)
 *
 * Logic summary:
 *   * เปิดที่มุมมอง "ต้องดู" = AG ที่ยังไม่จบ + IG/IC ที่พบปลวกเดือนนี้/เดือนก่อน + สถานีหาย/ถอนออก (isAttention) · สลับเป็น "ทุกสถานี" ได้
 *   * กรอง: สัญญา · ค้นรหัสสถานี · ชนิด · สถานะ · แบ่งหน้าละ 10 แถว
 *   * AG: F1, F2… จากฐานข้อมูล (follow_up_no คำนวณเองต่อสถานี) · IG/IC: ลำดับครั้งที่พบปลวก (บันทึกเฉพาะจุดที่พบ — exception entry)
 *   * หมดสัญญา: IG แสดง "รอเก็บ/เก็บแล้ว/ไม่เก็บ(+เหตุผล)" · IC แสดง "มอบให้ลูกค้า" (คำนวณจากชนิด+สถานะสัญญา ไม่มีช่องใหม่)
 *   * ไอคอนลูกศร = สถานีที่ย้ายมาจากสัญญาเก่า (Renew · station_transfers)
 *   * ปุ่ม "ประวัติแก้ไข" รายสถานี (ลิ้นชัก SPEC §8.2) ยังไม่ทำ — รอลิ้นชักกลางของหมวดอื่น
 */
import { useMemo } from "react";

import { Button } from "@/components/ui";
import { Pager } from "@/components/ui";

import {
  checkLinesByStation,
  fmtDate,
  filterStations,
  icHanded,
  igCollectState,
  paginate,
  sortContracts,
  stationCounts,
  stationStatusLabel,
  VISIT_TYPE_LABEL,
  type StationFilter,
} from "../logic";
import { CONTROL_CLASS, Empty, FilterChip, FilterField, Hint, Icon, TABLE_WRAP, TD_CLASS, TH_CLASS, Tag } from "../parts";
import type { CustomerDetailData, StationStatus, StationType } from "../types";

export const PAGE_ST = 10;

export interface StationUi extends StationFilter {
  page: number;
  open: Record<string, boolean>;
}

export const initialStationUi: StationUi = { attn: true, contractId: "all", type: "all", status: "all", q: "", page: 1, open: {} };

const STATUS_KEYS: StationStatus[] = ["active", "pending_removal", "removed", "lost", "withdrawn"];

export function StationsTab({ data, ui, onUi }: { data: CustomerDetailData; ui: StationUi; onUi: (next: StationUi) => void }) {
  const multi = data.contracts.length > 1;
  const contractById = useMemo(() => new Map(data.contracts.map((c) => [c.id, c])), [data.contracts]);
  const lines = useMemo(() => checkLinesByStation(data.stations, data.checks, data.visits), [data.stations, data.checks, data.visits]);
  const foundMonths = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [id, arr] of lines) m.set(id, new Set(arr.map((l) => l.date.slice(0, 7))));
    return m;
  }, [lines]);

  const scope = data.stations.filter((s) => ui.contractId === "all" || s.contractId === ui.contractId);
  const cnt = stationCounts(scope);
  const attnN = filterStations(scope, { ...ui, attn: true, contractId: "all", type: "all", status: "all", q: "" }, foundMonths, data.currentMonth).length;
  const rows = filterStations(data.stations, ui, foundMonths, data.currentMonth);
  const pg = paginate(rows, ui.page, PAGE_ST);
  const set = (patch: Partial<StationUi>) => onUi({ ...ui, page: 1, ...patch });

  return (
    <div>
      <Hint>
        IG/IC = สถานีภายนอก ตรวจทุกเดือน บันทึกเฉพาะจุดที่พบปลวก · AG = กล่องเหยื่อที่ติดเมื่อพบปลวก นับรอบติดตาม F1, F2… แยกต่อสถานี · สถานะ AG: ติดตามผล → รอถอด (พบปลวกตาย) → ถอดแล้ว (จบงาน) · <b>หาย / ถอนออก</b> แยกจากถอดแล้ว/เก็บคืนแล้ว เปลี่ยนได้ผ่านงานซ่อมตอนลงข้อมูลบริการเท่านั้น · ฝังสถานีแทนใช้เลขเดิมได้ · <Icon name="moved" /> = สถานีที่ย้ายมาจากสัญญาเก่า (Renew) · กด ▸ ดูประวัติการตรวจของจุดนั้น
      </Hint>

      <div role="group" aria-label="มุมมองรายการสถานี" className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">มุมมอง:</span>
        <FilterChip tone="pend" on={ui.attn} onClick={() => set({ attn: true })} title="AG ที่ยังไม่จบ · จุดที่พบปลวกเดือนนี้/เดือนก่อน · หาย/ถอนออก">
          <Icon name="alertc" className="size-3.5" />
          ต้องดู {attnN}
        </FilterChip>
        <FilterChip tone="na" on={!ui.attn} onClick={() => set({ attn: false })}>
          ทุกสถานี {scope.length}
        </FilterChip>
      </div>

      <div className="mb-2 flex flex-wrap gap-3">
        <FilterField label="สัญญา" htmlFor="f-st-contract">
          <select id="f-st-contract" className={CONTROL_CLASS} value={ui.contractId} onChange={(e) => set({ contractId: e.target.value })}>
            <option value="all">ทุกสัญญา</option>
            {sortContracts(data.contracts).map((k) => (
              <option key={k.id} value={k.id}>
                {k.no}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="ค้นรหัสสถานี" htmlFor="f-st-q">
          <input id="f-st-q" className={CONTROL_CLASS} value={ui.q} placeholder="เช่น AG-04" autoComplete="off" onChange={(e) => set({ q: e.target.value })} />
        </FilterField>
      </div>

      <div role="group" aria-label="กรองตามชนิดสถานี" className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">ชนิด:</span>
        <FilterChip tone="info" on={ui.type === "all"} onClick={() => set({ type: "all" })}>
          ทั้งหมด {cnt.total}
        </FilterChip>
        {(["IG", "IC", "AG"] as StationType[]).map((t) => (
          <FilterChip key={t} tone="info" on={ui.type === t} onClick={() => set({ type: t })}>
            <b>{t}</b> {cnt[t]}
          </FilterChip>
        ))}
      </div>
      <div role="group" aria-label="กรองตามสถานะสถานี" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">สถานะ:</span>
        <FilterChip tone="na" on={ui.status === "all"} onClick={() => set({ status: "all" })}>
          ทั้งหมด
        </FilterChip>
        {STATUS_KEYS.map((s) => {
          const lab = stationStatusLabel({ type: "IG", status: s });
          return (
            <FilterChip key={s} tone={lab.tone} on={ui.status === s} onClick={() => set({ status: s })}>
              {s === "active" ? "ใช้งาน · ติดตามผล" : lab.text} {cnt.byStatus[s]}
            </FilterChip>
          );
        })}
      </div>

      {data.truncated ? (
        <p role="alert" className="mb-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ข้อมูลสถานีของลูกค้ารายนี้มากเกินที่หน้านี้อ่านได้ในครั้งเดียว — รายการอาจไม่ครบ แจ้งผู้ดูแลระบบ
        </p>
      ) : null}

      {rows.length === 0 ? (
        ui.attn ? (
          <Empty>
            ไม่มีจุดที่ต้องดูตอนนี้{" "}
            <button type="button" className="min-h-11 text-accent-strong underline md:min-h-8" onClick={() => set({ attn: false })}>
              ดูทุกสถานี
            </button>
          </Empty>
        ) : (
          <Empty>
            ไม่พบสถานีตามเงื่อนไข — ลองล้างตัวกรอง{" "}
            <Button size="sm" className="max-md:min-h-11" onClick={() => onUi({ ...initialStationUi, attn: false })}>
              ล้างตัวกรอง
            </Button>
          </Empty>
        )
      ) : (
        <>
          <div className={TABLE_WRAP}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={`${TH_CLASS} w-10`} aria-label="ขยายดูประวัติ" />
                  <th scope="col" className={TH_CLASS}>รหัส</th>
                  <th scope="col" className={TH_CLASS}>ชนิด</th>
                  <th scope="col" className={TH_CLASS}>ติดตั้ง</th>
                  <th scope="col" className={TH_CLASS}>สถานะ</th>
                  <th scope="col" className={TH_CLASS}>พบปลวก / รอบ F</th>
                  <th scope="col" className={TH_CLASS}>ตรวจล่าสุด</th>
                  <th scope="col" className={TH_CLASS}>ถอด / เก็บคืน / มอบ</th>
                </tr>
              </thead>
              <tbody>
                {pg.slice.map((s) => {
                  const my = lines.get(s.id) ?? [];
                  const open = !!ui.open[s.id];
                  const last = my[my.length - 1];
                  const lab = stationStatusLabel(s);
                  const k = contractById.get(s.contractId);
                  const ig = igCollectState(s, k);
                  const handed = icHanded(s, k);
                  return (
                    <StationRows key={s.id} open={open} colSpan={8}
                      main={
                        <>
                          <td className={TD_CLASS}>
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={`ประวัติการตรวจของ ${s.code}`}
                              onClick={() => onUi({ ...ui, open: { ...ui.open, [s.id]: !open } })}
                              className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 max-md:size-11"
                            >
                              {open ? "▾" : "▸"}
                            </button>
                          </td>
                          <td className={`${TD_CLASS} font-mono`}>
                            <span className="whitespace-nowrap">{s.code}</span>
                            {s.pointLabel ? <span className="block font-sans text-xs text-fg-muted">{s.pointLabel}</span> : null}
                            {s.movedFromContractNo ? (
                              <span className="ml-1 text-fg-muted" title={`ย้ายมาจากสัญญา ${s.movedFromContractNo} (Renew) — การนับเดิมต่อเนื่อง`}>
                                <Icon name="moved" className="size-3.5" />
                                <span className="sr-only">ย้ายมาจากสัญญา {s.movedFromContractNo}</span>
                              </span>
                            ) : null}
                            {multi && k ? <div className="font-sans text-xs text-fg-muted">{k.no}</div> : null}
                          </td>
                          <td className={TD_CLASS}>
                            <span className="rounded border border-border-strong px-1.5 py-0.5 text-xs font-semibold">{s.type}</span>
                          </td>
                          <td className={TD_CLASS}>{fmtDate(s.installedAt)}</td>
                          <td className={TD_CLASS}>
                            <Tag tone={lab.tone}>{lab.text}</Tag>
                          </td>
                          <td className={TD_CLASS}>
                            {s.type === "AG" ? (my.length ? `F${my[my.length - 1]?.no ?? my.length}` : "S (ยังไม่ติดตาม)") : my.length ? `พบปลวก ${my.length} ครั้ง` : "—"}
                          </td>
                          <td className={TD_CLASS}>
                            {last ? (
                              <>
                                {fmtDate(last.date)}
                                {s.type === "AG" && last.check.caste ? <div className="text-xs text-fg-muted">{last.check.caste}</div> : null}
                              </>
                            ) : (
                              <span className="text-fg-muted">—</span>
                            )}
                          </td>
                          <td className={TD_CLASS} data-clarity-mask="True">
                            {ig === "pending" ? (
                              <Tag tone="pend">รอเก็บ</Tag>
                            ) : ig === "waived" ? (
                              <>
                                <Tag tone="na" title={s.notCollectedReason ?? undefined}>ไม่เก็บ</Tag>
                                <div className="max-w-[220px] truncate text-xs text-fg-muted" title={s.notCollectedReason ?? undefined}>
                                  {s.notCollectedReason}
                                </div>
                              </>
                            ) : s.type === "IC" && !s.removedAt && handed ? (
                              <>
                                มอบให้ลูกค้า
                                <div className="text-xs text-fg-muted">{handed === "closed" ? "เมื่อปิดสัญญา" : "ไม่ต้องเก็บ"}</div>
                              </>
                            ) : s.collectedAt ? (
                              <>
                                {fmtDate(s.collectedAt.slice(0, 10))}
                                <div className="text-xs text-fg-muted">เก็บคืน</div>
                              </>
                            ) : s.removedAt ? (
                              <>
                                {fmtDate(s.removedAt.slice(0, 10))}
                                <div className="text-xs text-fg-muted">{s.status === "lost" ? "หาย" : s.status === "withdrawn" ? "ถอนออก" : "ถอด"}</div>
                              </>
                            ) : (
                              <span className="text-fg-muted">—</span>
                            )}
                          </td>
                        </>
                      }
                      detail={
                        my.length === 0 ? (
                          <span className="text-xs text-fg-muted">
                            {s.type === "AG" ? "ติดตั้งแล้ว ยังไม่มีรอบติดตาม (F1)" : "ไม่พบปลวกในทุกรอบ — ไม่มีบันทึกผิดปกติ (exception entry)"}
                          </span>
                        ) : (
                          <table className="w-full border-collapse">
                            <thead>
                              <tr>
                                <th className={TH_CLASS}>{s.type === "AG" ? "F" : "ครั้งที่"}</th>
                                <th className={TH_CLASS}>วันที่ตรวจ</th>
                                <th className={TH_CLASS}>รอบ</th>
                                {s.type === "AG" ? <th className={TH_CLASS}>สัดส่วนปลวก</th> : null}
                                <th className={`${TH_CLASS} text-right`}>เหยื่อเติม (ก.)</th>
                                <th className={TH_CLASS}>หมายเหตุ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {my.map((l) => (
                                <tr key={`${l.check.visitId}`}>
                                  <td className={TD_CLASS}>
                                    <b>{s.type === "AG" ? `F${l.no}` : l.no}</b>
                                  </td>
                                  <td className={TD_CLASS}>{fmtDate(l.date)}</td>
                                  <td className={TD_CLASS}>
                                    <Tag tone={VISIT_TYPE_LABEL[l.visitType].tone}>{VISIT_TYPE_LABEL[l.visitType].text}</Tag>
                                  </td>
                                  {s.type === "AG" ? <td className={TD_CLASS}>{l.check.caste === "ปลวกตาย" ? <Tag tone="ok">ปลวกตาย</Tag> : l.check.caste}</td> : null}
                                  <td className={`${TD_CLASS} text-right tabular-nums`}>{l.check.baitAddedG ?? 0}</td>
                                  <td className={TD_CLASS} data-clarity-mask="True">{l.check.note || <span className="text-fg-muted">—</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} pageSize={PAGE_ST} total={rows.length} onPageChange={(p) => onUi({ ...ui, page: p })} className="mt-2 max-md:[&_button]:min-h-11" />
        </>
      )}
    </div>
  );
}

function StationRows({ main, detail, open, colSpan }: { main: React.ReactNode; detail: React.ReactNode; open: boolean; colSpan: number }) {
  return (
    <>
      <tr>{main}</tr>
      {open ? (
        <tr className="bg-surface-2">
          <td />
          <td colSpan={colSpan - 1} className="px-2.5 py-2">
            {detail}
          </td>
        </tr>
      ) : null}
    </>
  );
}
