"use client";

/**
 * แท็บ "ภาพรวม" — กราฟจำนวนจุด (สถานี) ที่พบปลวก / เปลี่ยนไม้ รายเดือนบริการ ของสัญญาที่เลือก
 *
 * Logic summary:
 *   * นับเป็น "จุด" = สถานีไม่ซ้ำต่อเดือน · พบปลวกจากผลตรวจ · เปลี่ยนไม้จาก view v_contract_monthly_timber (ฐานข้อมูลสรุปให้)
 *   * ตัวกรอง: สถานีภายนอก (IG+IC) / AG / เปลี่ยนไม้ — เลือกผสมได้ · ปิดหมดเท่ากับ "ทั้งหมด"
 *   * ช่วงเดือน: ค่าเริ่มต้น = เริ่มสัญญา…เดือนปัจจุบัน · ทั้งสัญญา · ปีที่ N (สัญญาเกิน 12 เดือน)
 *   * คัดลอก/บันทึกเป็นรูป PNG: แทน var(--x) ใน SVG เป็นสีจริงของธีมตอนนั้นแล้ววาดลง canvas (เบราว์เซอร์ล้วน ไม่ส่งข้อมูลออก)
 *   * การคำนวณทั้งหมดอยู่ใน logic.ts (termiteByMonth / dashRange / dashHeadline) — ไฟล์นี้แสดงผล
 */
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";

import { dashSvg, type DashHeader } from "../dashSvg";
import {
  dashDistinctStations,
  dashHasFind,
  dashHeadline,
  dashPoints,
  dashRange,
  fmtDate,
  monthTh,
  sortContracts,
  termiteByMonth,
  termText,
  type DashFilter,
  type DashMonth,
  type Tone,
} from "../logic";
import { CONTROL_CLASS, FilterChip, FilterField, Hint, Icon, TABLE_WRAP, TD_CLASS, TH_CLASS, Tag } from "../parts";
import type { CustomerDetailData } from "../types";

const STATE_LABEL: Record<DashMonth["state"], { text: string; tone: Tone }> = {
  ok: { text: "บริการครบ", tone: "ok" },
  miss: { text: "ตกบริการ", tone: "miss" },
  now: { text: "เดือนนี้ ยังไม่เข้า", tone: "pend" },
  fut: { text: "ยังไม่ถึง", tone: "na" },
  cx: { text: "ยกเลิก", tone: "na" },
  pre: { text: "ยังไม่นับ", tone: "na" },
};

const CHART_VARS = {
  "--c-ext": "var(--ok)",
  "--c-ag": "var(--danger)",
  "--c-timber": "color-mix(in srgb, var(--warn) 75%, var(--surface) 25%)",
} as React.CSSProperties;

function filterLabel(f: DashFilter): string {
  const a: string[] = [];
  if (f.ext) a.push("สถานีภายนอก (IG+IC)");
  if (f.ag) a.push("AG");
  if (f.timber) a.push("เปลี่ยนไม้");
  return a.join(" + ");
}

/** แทน var(--x) ด้วยสีจริง (ผ่าน element ทดลอง — รองรับ color-mix) แล้วคืน PNG blob */
async function svgToPng(svgText: string, host: HTMLElement): Promise<Blob | null> {
  const probe = document.createElement("span");
  host.appendChild(probe);
  const resolved = svgText.replace(/var\((--[a-z0-9-]+)\)/g, (_m, v: string) => {
    probe.style.color = "";
    probe.style.color = `var(${v})`;
    return getComputedStyle(probe).color || "#888";
  });
  probe.remove();
  const m = resolved.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = w * 2;
      cv.height = h * 2;
      const ctx = cv.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, w, h);
      cv.toBlob((b) => resolve(b), "image/png");
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(resolved)}`;
  });
}

export function DashTab({
  data,
  contractId,
  onToast,
}: {
  data: CustomerDetailData;
  contractId: string | null;
  onToast: (msg: string) => void;
}) {
  const contracts = sortContracts(data.contracts);
  const [cid, setCid] = useState<string>(contractId && contracts.some((c) => c.id === contractId) ? contractId : (contracts[0]?.id ?? ""));
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [f, setF] = useState<DashFilter>({ ext: true, ag: true, timber: true });
  const [full, setFull] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  const k = contracts.find((c) => c.id === cid) ?? contracts[0];
  const all = useMemo(
    () => (k ? termiteByMonth({ contract: k, stations: data.stations, checks: data.checks, visits: data.visits, timber: data.timber, currentMonth: data.currentMonth }) : []),
    [k, data.stations, data.checks, data.visits, data.timber, data.currentMonth],
  );
  if (!k) return <p className="m-0 text-[13px] text-fg-muted">ลูกค้ารายนี้ยังไม่มีสัญญา</p>;

  const dr = dashRange(all, from, to);
  const rows = dr.rows;
  const past = rows.filter((r) => r.state !== "fut");
  const hasF = dashHasFind(f);
  const word = hasF ? "พบปลวก" : "เปลี่ยนไม้";
  const val = (r: DashMonth) => (hasF ? dashPoints(r, f) : r.t);
  const found = past.filter((r) => val(r) > 0);
  const best = found.reduce<DashMonth | null>((a, r) => (!a || val(r) > val(a) ? r : a), null);
  const allOn = f.ext && f.ag && f.timber;
  const headline = dashHeadline(rows, f);
  const header: DashHeader = {
    t1: headline,
    t2: `สัญญา ${k.no} · ${monthTh(dr.from)} – ${monthTh(dr.to)} · แสดง: ${filterLabel(f)}`,
    foot: `AGA Bait Registry · สร้างเมื่อ ${fmtDate(data.today)} · จุด = จำนวนสถานี นับ 1 สถานีต่อ 1 เดือน`,
  };
  const yearStarts = k.termMonths > 12 ? all.map((_, i) => i).filter((i) => i % 12 === 0) : [];

  function toggle(key: keyof DashFilter) {
    setF((cur) => {
      const all3 = cur.ext && cur.ag && cur.timber;
      const next = all3 ? { ext: false, ag: false, timber: false, [key]: true } : { ...cur, [key]: !cur[key] };
      return !next.ext && !next.ag && !next.timber ? { ext: true, ag: true, timber: true } : (next as DashFilter);
    });
  }

  async function exportPng(mode: "copy" | "save") {
    const blob = await svgToPng(dashSvg(rows, f, { hdr: header }), hostRef.current ?? document.body);
    if (!blob) return onToast("สร้างรูปไม่สำเร็จ");
    const download = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `termite-points-${k?.no ?? "contract"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    if (mode === "save") {
      download();
      return onToast("บันทึกรูปกราฟแล้ว");
    }
    if (navigator.clipboard && "ClipboardItem" in window) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return onToast("คัดลอกรูปกราฟแล้ว — วางที่อื่นได้เลย (Ctrl+V)");
      } catch {
        download();
        return onToast("คัดลอกไม่ได้ในเบราว์เซอร์นี้ จึงบันทึกเป็นไฟล์รูปให้แทน");
      }
    }
    download();
    onToast("เบราว์เซอร์นี้คัดลอกรูปไม่ได้ จึงบันทึกเป็นไฟล์รูปให้แทน");
  }

  const cols: { head: string; get: (r: DashMonth) => number; codes: (r: DashMonth) => string[]; bold?: boolean }[] = [];
  if (f.ext) cols.push({ head: "IG", get: (r) => r.ig, codes: (r) => r.igL }, { head: "IC", get: (r) => r.ic, codes: (r) => r.icL });
  if (f.ag) cols.push({ head: "AG", get: (r) => r.ag, codes: (r) => r.agL });
  if (hasF) cols.push({ head: "รวมพบปลวก (จุด)", get: (r) => dashPoints(r, f), codes: (r) => [...(f.ext ? [...r.igL, ...r.icL] : []), ...(f.ag ? r.agL : [])], bold: true });
  if (f.timber) cols.push({ head: "เปลี่ยนไม้ (จุด)", get: (r) => r.t, codes: (r) => r.tL, bold: true });

  return (
    <div ref={hostRef} style={CHART_VARS}>
      <div className="mb-3 flex flex-wrap gap-3">
        <FilterField label="สัญญา" htmlFor="f-da-contract">
          <select
            id="f-da-contract"
            className={CONTROL_CLASS}
            value={k.id}
            onChange={(e) => {
              setCid(e.target.value);
              setFrom(null);
              setTo(null);
            }}
          >
            {contracts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.no} · {termText(x.termMonths)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="ตั้งแต่เดือน" htmlFor="f-da-from">
          <select id="f-da-from" className={CONTROL_CLASS} value={dr.from} onChange={(e) => setFrom(e.target.value)}>
            {all.map((r) => (
              <option key={r.month} value={r.month}>
                {monthTh(r.month)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="ถึงเดือน" htmlFor="f-da-to">
          <select id="f-da-to" className={CONTROL_CLASS} value={dr.to} onChange={(e) => setTo(e.target.value)}>
            {all.map((r) => (
              <option key={r.month} value={r.month}>
                {monthTh(r.month)}
              </option>
            ))}
          </select>
        </FilterField>
      </div>

      <div role="group" aria-label="เลือกช่วงเวลาลัด" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">ช่วง:</span>
        <FilterChip tone="na" on={dr.toNow && !dr.full} onClick={() => (setFrom(null), setTo(null))}>
          จนถึงปัจจุบัน
        </FilterChip>
        <FilterChip tone="na" on={dr.full} onClick={() => (setFrom(null), setTo(""))}>
          ทั้งสัญญา
        </FilterChip>
        {yearStarts.map((i, n) => {
          const a = all[i]?.month ?? "";
          const b = all[Math.min(i + 11, all.length - 1)]?.month ?? "";
          return (
            <FilterChip key={a} tone="na" on={dr.from === a && dr.to === b} onClick={() => (setFrom(a), setTo(b))}>
              ปีที่ {n + 1}
            </FilterChip>
          );
        })}
        <span className="text-xs text-fg-muted">
          · แสดง {monthTh(dr.from)} – {monthTh(dr.to)} ({rows.length} เดือน)
        </span>
      </div>

      <div className="mb-3 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <Stat value={dashDistinctStations(rows, f)} label={`สถานีที่เคย${word} (นับสถานีละ 1 ครั้งทั้งช่วง)`} />
        <Stat value={best ? `${monthTh(best.month)} · ${val(best)} จุด` : "—"} label={`เดือนที่${word}มากสุด`} small />
        <Stat value={`${found.length} / ${past.length}`} label={`เดือนที่${word} / เดือนที่ผ่านมา`} />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="m-0 mr-auto text-[15px] font-semibold">{headline}</h3>
        <Button size="sm" className="max-md:min-h-11" onClick={() => setFull(true)} title="ดูกราฟขยายเต็มจอ">
          <Icon name="max" /> ขยายเต็มจอ
        </Button>
        <Button size="sm" className="max-md:min-h-11" onClick={() => void exportPng("copy")} title="คัดลอกกราฟเป็นรูปภาพ แล้ววาง (Ctrl+V) ที่อื่นได้">
          <Icon name="copy" /> คัดลอกเป็นรูป
        </Button>
        <Button size="sm" className="max-md:min-h-11" onClick={() => void exportPng("save")} title="บันทึกกราฟเป็นไฟล์ PNG">
          <Icon name="download" /> บันทึกเป็นรูป
        </Button>
      </div>

      <div role="group" aria-label="เลือกข้อมูลที่แสดงในกราฟ (เลือกผสมได้)" className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">แสดง:</span>
        <FilterChip tone="na" on={allOn} onClick={() => setF({ ext: true, ag: true, timber: true })}>
          ทั้งหมด
        </FilterChip>
        <FilterChip tone="ok" on={f.ext} onClick={() => toggle("ext")} title="IG + IC">
          <Swatch c="--c-ext" />
          สถานีภายนอก
        </FilterChip>
        <FilterChip tone="miss" on={f.ag} onClick={() => toggle("ag")}>
          <Swatch c="--c-ag" />
          AG
        </FilterChip>
        <FilterChip tone="pend" on={f.timber} onClick={() => toggle("timber")} title="จุด (สถานี) ที่เปลี่ยนไม้ในเดือนนั้น">
          <Swatch c="--c-timber" />
          เปลี่ยนไม้
        </FilterChip>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-2" data-clarity-mask="True" dangerouslySetInnerHTML={{ __html: dashSvg(rows, f) }} />
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-fg-muted" aria-label="คำอธิบายกราฟ">
        {f.ext ? <span><Swatch c="--c-ext" />สถานีภายนอก (IG+IC)</span> : null}
        {f.ag ? <span><Swatch c="--c-ag" />AG</span> : null}
        {f.timber ? <span><Swatch c="--c-timber" />เปลี่ยนไม้</span> : null}
        <span className="text-danger">ตก = เดือนตกบริการ</span>
      </div>
      <Hint className="mt-2">
        ทุกอย่างนับเป็น<b>จุด (จำนวนสถานี)</b> · ช่วงบน = จุดที่พบปลวก (สถานีภายนอก + AG) · ช่วงล่าง = จุดที่เปลี่ยนไม้ · <b>กราฟนับรายเดือน</b>: สถานีเดิมที่พบอีกในเดือนถัดไปนับซ้ำได้ (เช่น ม.ค. พบจุด 1,2,3,4 = 4 จุด · ก.พ. พบจุด 2,3,4 = 3 จุด) ส่วนการ์ด “สถานีที่เคย…” นับสถานีละ 1 ครั้งทั้งช่วง (ตัวอย่างนี้ = 4 สถานี) · รวมเดือนที่ AG บันทึก “ปลวกตาย” · ชี้ที่แท่งเพื่อดูรายละเอียด · ค่าเริ่มต้นแสดงถึงเดือนปัจจุบัน
      </Hint>

      <div className={`${TABLE_WRAP} max-h-[360px] overflow-auto`}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className={TH_CLASS}>เดือนบริการ</th>
              {cols.map((c) => (
                <th key={c.head} scope="col" className={`${TH_CLASS} text-right`}>{c.head}</th>
              ))}
              <th scope="col" className={TH_CLASS}>สถานะเดือน</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const fut = r.state === "fut";
              const lab = STATE_LABEL[r.state];
              return (
                <tr key={r.month} className={fut ? "opacity-60" : undefined}>
                  <td className={TD_CLASS}>{monthTh(r.month)}</td>
                  {cols.map((c) => {
                    const codes = !fut ? c.codes(r) : [];
                    return (
                      <td key={c.head} className={`${TD_CLASS} text-right tabular-nums`} title={codes.length ? `${c.head} · ${monthTh(r.month)} · ${codes.join(", ")}` : undefined}>
                        {fut ? "—" : c.bold ? <b>{c.get(r)}</b> : c.get(r)}
                      </td>
                    );
                  })}
                  <td className={TD_CLASS}>
                    <Tag tone={lab.tone}>{lab.text}</Tag>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {full ? (
        <div role="dialog" aria-modal="true" aria-label="กราฟจำนวนจุด ขยายเต็มจอ" className="fixed inset-0 z-50 flex flex-col bg-surface" style={CHART_VARS}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <b className="text-[15px]">{headline}</b>
            <span className="text-xs text-fg-muted">{header.t2}</span>
            <span className="ml-auto flex gap-2">
              <Button size="sm" className="max-md:min-h-11" onClick={() => void exportPng("copy")}>
                <Icon name="copy" /> คัดลอกเป็นรูป
              </Button>
              <Button size="sm" className="max-md:min-h-11" onClick={() => void exportPng("save")}>
                <Icon name="download" /> บันทึกเป็นรูป
              </Button>
              <Button size="sm" variant="primary" className="max-md:min-h-11" autoFocus onClick={() => setFull(false)}>
                <Icon name="x" /> ปิด
              </Button>
            </span>
          </div>
          <div className="flex-1 overflow-auto p-4" dangerouslySetInnerHTML={{ __html: dashSvg(rows, f, { tall: 430 }) }} />
        </div>
      ) : null}
    </div>
  );
}

function Swatch({ c }: { c: string }) {
  return <i aria-hidden="true" className="mr-1.5 inline-block size-2.5 rounded-sm align-baseline" style={{ background: `var(${c})` }} />;
}

function Stat({ value, label, small }: { value: React.ReactNode; label: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className={`${small ? "pt-0.5 text-base" : "text-xl"} font-bold tabular-nums`}>{value}</div>
      <div className="text-xs text-fg-muted">{label}</div>
    </div>
  );
}
