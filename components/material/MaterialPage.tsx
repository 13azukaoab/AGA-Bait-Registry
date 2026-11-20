/**
 * /material — สรุปงานบริการรายเดือน (server component ล้วน · ไม่มี state ฝั่ง client)
 *
 * Logic summary:
 *   * ตัวกรอง (เดือน / สาขา) และแท็บ ใช้ลิงก์/ฟอร์ม GET → เปลี่ยน URL แล้ว server คำนวณใหม่ (กดแชร์ลิงก์ได้ · ไม่ต้องมี JS)
 *   * แท็บ "การใช้อุปกรณ์": การ์ดรวม → 2 มุมมองวัสดุ (ตามประเภทงาน · ตามประเภทลูกค้า New/Renew · DECISIONS 2.90 ทาง ก)
 *     → ตารางแยกสาขา (มี % เทียบเดือนก่อน + ก./กล่อง AG)
 *   * แท็บ "สรุปรายทีม": เวลาทำงานรวม · ชม./คน เทียบเกณฑ์ Workload (M25 / 2.88)
 *   * กราฟ = แท่ง CSS (ไม่เพิ่มไลบรารี) · ทุกกราฟมีตัวเลขในตารางข้างๆ ให้ screen reader/พิมพ์ใช้ได้
 *   * ไม่แสดงชื่อลูกค้า (PDPA) · ตัวเลขทุกช่องมาจาก viewModel.ts
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { Alert } from "@/components/ui";
import { monthChoices, monthLabel } from "@/lib/service/months";
import { TEAM_KIND_LABEL } from "@/lib/service/teamKind";

import { fmtDec1, fmtHours, fmtInt, fmtPct } from "./format";
import { baitTotalG, pctChange, sharePct, type Materials } from "./logic";
import styles from "./material.module.css";
import type { MaterialPageData } from "./materialData";
import type { MaterialView } from "./viewModel";

export type MaterialTab = "mat" | "team";

interface Props {
  data: MaterialPageData;
  view: MaterialView;
  tab: MaterialTab;
  branchId: string | null;
  currentMonth: string;
}

const CARD = "rounded-card border border-border bg-surface p-4 shadow-[var(--shadow)]";

function href(month: string, tab: MaterialTab, branchId: string | null): string {
  const q = new URLSearchParams({ month, tab });
  if (branchId) q.set("branch", branchId);
  return `/material?${q.toString()}`;
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-fg-muted">— ไม่มีเดือนก่อนให้เทียบ</span>;
  const tone = pct > 0 ? "text-ok" : pct < 0 ? "text-danger" : "text-fg-muted";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "•";
  return (
    <span className={tone}>
      <span aria-hidden="true">{arrow} </span>
      {fmtPct(pct)} เทียบเดือนก่อน
    </span>
  );
}

function StatCard({ label, accent, value, unit, sub }: { label: string; accent: string; value: string; unit: string; sub: ReactNode }) {
  return (
    <div className={`${CARD} border-l-4 ${accent}`}>
      <div className="text-[13px] text-fg-muted">{label}</div>
      <div className="num mt-1 text-[26px] leading-tight font-bold text-fg">
        {value} <span className="text-sm font-normal text-fg-muted">{unit}</span>
      </div>
      <div className="mt-1 text-xs">{sub}</div>
    </div>
  );
}

/** แท่งซ้อน 1 แถว: เหยื่อนอก / เหยื่อใน / เคมีผง (กรัมทั้งหมด) · ความกว้างเทียบค่ามากสุดของชุด */
function Bar({ label, m, max }: { label: string; m: Materials; max: number }) {
  const total = m.outsideG + m.insideG + m.powderG;
  const w = (v: number) => (max > 0 ? `${(v / max) * 100}%` : "0%");
  return (
    <div className="grid grid-cols-[minmax(90px,150px)_1fr_auto] items-center gap-2 text-[13px] max-[480px]:grid-cols-[1fr_auto]">
      <span className="min-w-0 break-words text-fg-muted max-[480px]:col-span-2">{label}</span>
      <div
        className={styles.track}
        role="img"
        aria-label={`${label}: เหยื่อนอก ${fmtInt(m.outsideG)} ก. เหยื่อใน ${fmtInt(m.insideG)} ก. เคมีผง ${fmtDec1(m.powderG)} ก.`}
      >
        <div className={`${styles.seg} ${styles.segOut}`} style={{ width: w(m.outsideG) }} />
        <div className={`${styles.seg} ${styles.segIn}`} style={{ width: w(m.insideG) }} />
        <div className={`${styles.seg} ${styles.segPow}`} style={{ width: w(m.powderG) }} />
      </div>
      <span className="num text-right font-semibold">{fmtInt(total)} ก.</span>
    </div>
  );
}

function BarLegend() {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      <span><i className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-baseline ${styles.dotOut}`} />เหยื่อนอก (IG+IC)</span>
      <span><i className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-baseline ${styles.dotIn}`} />เหยื่อใน (AG)</span>
      <span><i className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-baseline ${styles.dotPow}`} />เคมีผง (กรัม)</span>
    </div>
  );
}

interface UsageRow {
  key: string;
  label: string;
  sub?: boolean;
  now: Materials;
  prev: Materials;
}

function UsageTable({ caption, rows, total, totalLabel }: { caption: string; rows: UsageRow[]; total: Materials; totalLabel: string }) {
  const th = "bg-surface-2 px-2.5 py-2 text-xs font-semibold text-fg-muted whitespace-nowrap";
  const td = "num border-b border-border px-2.5 py-2 text-right whitespace-nowrap";
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${th} text-left`}>กลุ่ม</th>
            <th scope="col" className={`${th} text-right`}>เหยื่อนอก IG+IC (ก.)</th>
            <th scope="col" className={`${th} text-right`}>เหยื่อใน AG (ก.)</th>
            <th scope="col" className={`${th} text-right`}>เคมีผง (จุด)</th>
            <th scope="col" className={`${th} text-right`}>เคมีผง (ก.)</th>
            <th scope="col" className={`${th} text-right`}>ไม้ล่อ (ชิ้น)</th>
            <th scope="col" className={`${th} text-right`}>เทียบเดือนก่อน</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className={`min-w-[170px] border-b border-border px-2.5 py-2 text-left font-normal ${r.sub ? "pl-7 text-fg-muted" : "font-semibold"}`}>
                {r.label}
                <span className="num ml-1.5 text-xs font-normal text-fg-muted">({fmtInt(r.now.visits)} ครั้ง)</span>
              </th>
              <td className={td}>{fmtInt(r.now.outsideG)}</td>
              <td className={td}>{fmtInt(r.now.insideG)}</td>
              <td className={td}>{fmtInt(r.now.powderPoints)}</td>
              <td className={td}>{fmtDec1(r.now.powderG)}</td>
              <td className={td}>{fmtInt(r.now.timberPcs)}</td>
              <td className={td}>
                <Delta pct={pctChange(baitTotalG(r.now), r.prev.visits > 0 ? baitTotalG(r.prev) : null)} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-2 font-bold">
            <th scope="row" className="min-w-[170px] px-2.5 py-2 text-left">{totalLabel}</th>
            <td className={`${td} border-b-0`}>{fmtInt(total.outsideG)}</td>
            <td className={`${td} border-b-0`}>{fmtInt(total.insideG)}</td>
            <td className={`${td} border-b-0`}>{fmtInt(total.powderPoints)}</td>
            <td className={`${td} border-b-0`}>{fmtDec1(total.powderG)}</td>
            <td className={`${td} border-b-0`}>{fmtInt(total.timberPcs)}</td>
            <td className={`${td} border-b-0`} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function WorkCards({ view }: { view: MaterialView }) {
  const { work, workPrev } = view;
  const items: { key: string; label: string; now: Materials; prev: Materials }[] = [
    { key: "routine", label: "บริการประจำเดือน", now: work.routine, prev: workPrev.routine },
    { key: "makeup", label: "ชดเชย (ส่วนหนึ่งของประจำเดือน)", now: work.makeup, prev: workPrev.makeup },
    { key: "problem", label: "แก้ไขปัญหา", now: work.problem, prev: workPrev.problem },
  ];
  return (
    <section aria-labelledby="mat-cards">
      <h2 id="mat-cards" className="mt-0 mb-2 text-base font-bold">สรุปตามประเภทงาน</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3.5">
        {items.map((r) => {
          const bait = baitTotalG(r.now);
          const row = "flex justify-between gap-2 text-[13px] text-fg-muted";
          return (
            <div key={r.key} className={CARD}>
              <div className="text-[13px] font-semibold text-fg-muted">{r.label}</div>
              <div className="num mt-1 text-[24px] leading-tight font-bold">
                {fmtInt(bait)} <span className="text-sm font-normal text-fg-muted">ก. เหยื่อรวม</span>
              </div>
              <div
                className={`${styles.track} my-2`}
                role="img"
                aria-label={`เหยื่อนอก ${sharePct(r.now.outsideG, bait)}% เหยื่อใน ${sharePct(r.now.insideG, bait)}%`}
              >
                <div className={`${styles.seg} ${styles.segOut}`} style={{ width: `${sharePct(r.now.outsideG, bait)}%` }} />
                <div className={`${styles.seg} ${styles.segIn}`} style={{ width: `${sharePct(r.now.insideG, bait)}%` }} />
              </div>
              <div className={row}><span>นอก IG+IC</span><b className="num text-fg">{fmtInt(r.now.outsideG)} ก.</b></div>
              <div className={row}><span>ใน AG</span><b className="num text-fg">{fmtInt(r.now.insideG)} ก.</b></div>
              <div className={row}><span>เคมีผง</span><b className="num text-fg">{fmtInt(r.now.powderPoints)} จุด</b></div>
              <div className={row}><span>ไม้ล่อ</span><b className="num text-fg">{fmtInt(r.now.timberPcs)} ชิ้น</b></div>
              <div className="mt-2 text-xs">
                <Delta pct={pctChange(bait, r.prev.visits > 0 ? baitTotalG(r.prev) : null)} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CompareChart({ view }: { view: MaterialView }) {
  const { work, customer } = view;
  const rows = [
    { key: "routine", label: "บริการประจำเดือน", m: work.routine },
    { key: "problem", label: "แก้ไขปัญหา", m: work.problem },
    { key: "new", label: "ลูกค้า New", m: customer.new },
    { key: "renew", label: "ลูกค้า Renew", m: customer.renew },
  ];
  const max = Math.max(...rows.map((r) => r.m.outsideG + r.m.insideG + r.m.powderG), 1);
  return (
    <section className={CARD} aria-labelledby="mat-compare">
      <h2 id="mat-compare" className="m-0 text-base font-bold">กราฟเปรียบเทียบ</h2>
      <p className="mt-1 mb-3 text-[13px] text-fg-muted">วัสดุที่ใช้ แยกเป็น 4 กลุ่ม (ตัวเลขละเอียดดูในตารางด้านล่าง)</p>
      <div className="grid gap-3">
        <BarLegend />
        {rows.map((r) => (
          <Bar key={r.key} label={r.label} m={r.m} max={max} />
        ))}
      </div>
      <p className="mt-3 mb-0 text-xs text-fg-muted">
        New/Renew กับประเภทงานเป็นคนละมุม ตัวเลขจึงทับกัน รวมกันไม่ได้
      </p>
    </section>
  );
}

function InspectionSection({ view }: { view: MaterialView }) {
  const { inspection, inspectionPrev } = view;
  const th = "bg-surface-2 px-2.5 py-2 text-xs font-semibold text-fg-muted whitespace-nowrap";
  const td = "num border-b border-border px-2.5 py-2 text-right whitespace-nowrap";
  const table = (caption: string, head: string, rows: { key: string; name: string; c: { visits: number; customers: number } }[]) => (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${th} text-left`}>{head}</th>
            <th scope="col" className={`${th} text-right`}>เข้า (ครั้ง)</th>
            <th scope="col" className={`${th} text-right`}>ลูกค้า (ราย)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={3} className="px-3 py-4 text-center text-fg-muted">ยังไม่มีการตรวจภายใน</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="border-b border-border px-2.5 py-2 text-left font-normal">{r.name}</th>
              <td className={td}>{fmtInt(r.c.visits)}</td>
              <td className={td}>{fmtInt(r.c.customers)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className={CARD} aria-labelledby="mat-inspect">
      <h2 id="mat-inspect" className="m-0 text-base font-bold">ตรวจภายใน</h2>
      <p className="mt-1 mb-3 text-[13px] text-fg-muted">การเข้าที่ติ๊ก &ldquo;ตรวจภายใน&rdquo; ในเดือนนี้ · ลูกค้าเดียวกันเข้าหลายครั้งนับเป็น 1 ราย</p>
      <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <div className="num text-[26px] leading-tight font-bold">{fmtInt(inspection.visits)} <span className="text-sm font-normal text-fg-muted">ครั้ง</span></div>
          <div className="text-xs"><Delta pct={pctChange(inspection.visits, inspectionPrev.visits)} /></div>
        </div>
        <div>
          <div className="num text-[26px] leading-tight font-bold">{fmtInt(inspection.customers)} <span className="text-sm font-normal text-fg-muted">ราย</span></div>
          <div className="text-xs"><Delta pct={pctChange(inspection.customers, inspectionPrev.customers)} /></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 max-[767px]:grid-cols-1 [&>*]:min-w-0">
        {table("ตรวจภายในแยกสาขา", "สาขา", view.inspectionByBranch.map((r) => ({ key: r.branch.id, name: r.branch.name, c: r.count })))}
        {table("ตรวจภายในแยกทีม", "ทีม", view.inspectionByTeam.map((r) => ({ key: r.team.id, name: r.team.name, c: r.count })))}
      </div>
    </section>
  );
}

function WorkSection({ view }: { view: MaterialView }) {
  const { work, workPrev } = view;
  const routine: UsageRow = { key: "routine", label: "บริการประจำเดือน", now: work.routine, prev: workPrev.routine };
  const makeup: UsageRow = { key: "makeup", label: "└ ชดเชย (ตกบริการเดือนก่อน)", sub: true, now: work.makeup, prev: workPrev.makeup };
  const problem: UsageRow = { key: "problem", label: "แก้ไขปัญหา (รวมเหยื่อติดตั้ง AG)", now: work.problem, prev: workPrev.problem };
  const rows = [routine, makeup, problem];
  return (
    <section className={CARD} aria-labelledby="mat-work">
      <h2 id="mat-work" className="m-0 text-base font-bold">มุมมอง 1 · ตามประเภทงาน</h2>
      <p className="mt-1 mb-3 text-[13px] text-fg-muted">
        บริการประจำเดือน = การเข้ารอบ (รวมชดเชย) · แก้ไขปัญหา = เข้าแก้ปัญหา/ติดตามผล รวมเหยื่อที่ติดตั้งกล่อง AG
      </p>
      <UsageTable caption="การใช้วัสดุแยกตามประเภทงาน" rows={rows} total={work.all} totalLabel="รวมทุกประเภทงาน" />
    </section>
  );
}

function CustomerSection({ view }: { view: MaterialView }) {
  const { customer, customerPrev } = view;
  const rows: UsageRow[] = [
    { key: "new", label: "ลูกค้าใหม่ (New)", now: customer.new, prev: customerPrev.new },
    { key: "renew", label: "ลูกค้าต่อสัญญา (Renew)", now: customer.renew, prev: customerPrev.renew },
  ];
  if (customer.unknown.visits > 0) {
    rows.push({ key: "unknown", label: "ไม่ระบุประเภท", now: customer.unknown, prev: customerPrev.unknown });
  }
  return (
    <section className={CARD} aria-labelledby="mat-cust">
      <h2 id="mat-cust" className="m-0 text-base font-bold">มุมมอง 2 · ตามประเภทลูกค้า (New / Renew)</h2>
      <p className="mt-1 mb-3 text-[13px] text-fg-muted">วัสดุทั้งหมดที่ใช้กับลูกค้ากลุ่มนั้น (ทั้งรอบประจำเดือนและแก้ปัญหา)</p>
      <UsageTable caption="การใช้วัสดุแยกตามประเภทลูกค้า" rows={rows} total={customer.all} totalLabel="รวมทุกกลุ่มลูกค้า" />
    </section>
  );
}

function BranchTable({ view }: { view: MaterialView }) {
  const th = "bg-surface-2 px-2.5 py-2 text-xs font-semibold text-fg-muted whitespace-nowrap";
  const td = "num border-b border-border px-2.5 py-2 text-right whitespace-nowrap";
  return (
    <section aria-labelledby="mat-branch">
      <h2 id="mat-branch" className="mt-0 mb-2 text-base font-bold">ตารางรวมทุกวัสดุ แยกสาขา</h2>
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">การใช้วัสดุแยกสาขา เทียบเดือนก่อน และ ก./กล่อง AG</caption>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left`}>สาขา</th>
              <th scope="col" className={`${th} text-right`}>เหยื่อนอก (ก.)</th>
              <th scope="col" className={`${th} text-right`}>เหยื่อใน (ก.)</th>
              <th scope="col" className={`${th} text-right`}>เหยื่อรวม (ก.)</th>
              <th scope="col" className={`${th} text-right`}>เทียบเดือนก่อน</th>
              <th scope="col" className={`${th} text-right`}>เคมีผง (จุด)</th>
              <th scope="col" className={`${th} text-right`}>เคมีผง (ก.)</th>
              <th scope="col" className={`${th} text-right`}>ไม้ล่อ (ชิ้น)</th>
              <th scope="col" className={`${th} text-right`}>กล่อง AG ที่ตรวจ</th>
              <th scope="col" className={`${th} text-right`}>ก./กล่อง AG</th>
            </tr>
          </thead>
          <tbody>
            {view.branches.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-fg-muted">เดือนนี้ยังไม่มีการบันทึกบริการ</td></tr>
            )}
            {view.branches.map((r) => (
              <tr key={r.branch.id}>
                <th scope="row" className="min-w-[100px] border-b border-border px-2.5 py-2 text-left font-semibold">{r.branch.name}</th>
                <td className={td}>{fmtInt(r.now.outsideG)}</td>
                <td className={td}>{fmtInt(r.now.insideG)}</td>
                <td className={td}>{fmtInt(baitTotalG(r.now))}</td>
                <td className={td}><Delta pct={r.baitPctVsPrev} /></td>
                <td className={td}>{fmtInt(r.now.powderPoints)}</td>
                <td className={td}>{fmtDec1(r.now.powderG)}</td>
                <td className={td}>{fmtInt(r.now.timberPcs)}</td>
                <td className={td}>{fmtInt(r.agChecked)}</td>
                <td className={td}>
                  {r.gPerAgBox === null ? "—" : fmtDec1(r.gPerAgBox)}
                  {r.gPerAgBox !== null && r.gPerAgBoxPrev !== null && (
                    <span className="ml-1 text-xs text-fg-muted">(ก่อน {fmtDec1(r.gPerAgBoxPrev)})</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MaterialTabContent({ data, view }: { data: MaterialPageData; view: MaterialView }) {
  const { all, allPrev } = view;
  const hasPrev = allPrev.visits > 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3.5">
        <StatCard
          label="NEMESIS (เหยื่อ) ที่ใช้"
          accent={styles.statNem ?? ""}
          value={fmtInt(baitTotalG(all))}
          unit="ก."
          sub={<Delta pct={pctChange(baitTotalG(all), hasPrev ? baitTotalG(allPrev) : null)} />}
        />
        <StatCard
          label="เคมีผง (ปลวกสวน)"
          accent={styles.statPow ?? ""}
          value={fmtInt(all.powderPoints)}
          unit={`จุด · ≈${fmtDec1(all.powderG)} ก.`}
          sub={<Delta pct={pctChange(all.powderPoints, hasPrev ? allPrev.powderPoints : null)} />}
        />
        <StatCard
          label="ไม้ล่อที่เปลี่ยน"
          accent={styles.statWood ?? ""}
          value={fmtInt(all.timberPcs)}
          unit="ชิ้น"
          sub={<Delta pct={pctChange(all.timberPcs, hasPrev ? allPrev.timberPcs : null)} />}
        />
      </div>
      <Alert variant="info">
        งานซ่อมที่ทำในการเข้ารอบปกติถูกนับเป็น &ldquo;บริการประจำเดือน&rdquo; · วัสดุตอนเปิดงาน/ติดตั้งยังไม่ได้บันทึกในระบบ
        (เพิ่มหลังเปิดใช้งาน) จึงยังไม่รวมในตัวเลข ยกเว้นเหยื่อติดตั้ง AG ที่บันทึกตอนติดตั้งแล้ว · เทียบกับ {monthLabel(data.prevMonth)}
      </Alert>
      <WorkCards view={view} />
      <CompareChart view={view} />
      <WorkSection view={view} />
      <CustomerSection view={view} />
      <InspectionSection view={view} />
      <BranchTable view={view} />
    </div>
  );
}

function TeamTabContent({ data, view }: { data: MaterialPageData; view: MaterialView }) {
  const th = "bg-surface-2 px-2.5 py-2 text-xs font-semibold text-fg-muted whitespace-nowrap";
  const td = "num border-b border-border px-2.5 py-2 text-right whitespace-nowrap";
  const maxPer = Math.max(data.thresholds.central, ...view.teams.map((t) => t.workload.perPerson ?? 0), 1);
  const over = view.teams.filter((t) => t.workload.level === "over");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {over.length > 0 && (
        <Alert variant="warn" title="มีทีมเกินเกณฑ์ภาระงาน">
          {over.map((t) => `${t.team.name} (${fmtDec1(t.workload.perPerson ?? 0)} ชม./คน)`).join(" · ")}
        </Alert>
      )}
      <p className="m-0 text-[13px] text-fg-muted">
        เกณฑ์ภาระงานค่ากลาง <b className="num text-fg">{fmtDec1(data.thresholds.central)}</b> ชม./คน/เดือน (ตั้งในหน้าตั้งค่า) ·
        ชม./คน = เวลาทำงานรวมของทีม ÷ จำนวนคนในทีม · การเข้าที่ไปพร้อมหลายทีมนับเวลาเต็มให้ทุกทีม
      </p>
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">สรุปรายทีม เวลาทำงานและภาระงานต่อคน</caption>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left`}>ทีม</th>
              <th scope="col" className={`${th} text-right`}>ประเภท</th>
              <th scope="col" className={`${th} text-right`}>เข้า (ครั้ง)</th>
              <th scope="col" className={`${th} text-right`}>เวลารวม (ชม.)</th>
              <th scope="col" className={`${th} text-right`}>จำนวนคน</th>
              <th scope="col" className={`${th} min-w-[180px] text-left`}>ชม./คน เทียบเกณฑ์</th>
            </tr>
          </thead>
          <tbody>
            {view.teams.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-fg-muted">เดือนนี้ยังไม่มีเวลาทำงานที่บันทึก</td></tr>
            )}
            {view.teams.map(({ team, visits, minutes, workload }) => (
              <tr key={team.id}>
                <th scope="row" className="border-b border-border px-2.5 py-2 text-left font-semibold">{team.name}</th>
                <td className={td}>{TEAM_KIND_LABEL[team.kind]}</td>
                <td className={td}>{fmtInt(visits)}</td>
                <td className={td}>{fmtHours(minutes)}</td>
                <td className={td}>{workload.level === "no-headcount" ? "ยังไม่ตั้ง" : fmtInt(workload.headcount)}</td>
                <td className="border-b border-border px-2.5 py-2">
                  {workload.perPerson === null ? (
                    <span className="text-fg-muted">ตั้งจำนวนคนในหน้าตั้งค่าก่อน</span>
                  ) : (
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <div
                        className="relative h-2.5 rounded-full bg-surface-3"
                        role="img"
                        aria-label={`${fmtDec1(workload.perPerson)} ชม./คน เกณฑ์ ${fmtDec1(workload.threshold)}`}
                      >
                        <div
                          className={`${styles.workFill} ${workload.level === "over" ? styles.workFillOver : ""}`}
                          style={{ width: `${Math.min(100, (workload.perPerson / maxPer) * 100)}%` }}
                        />
                        <span className={styles.capMark} style={{ left: `${(workload.threshold / maxPer) * 100}%` }} />
                      </div>
                      <span className={`num font-semibold ${workload.level === "over" ? "text-warn" : ""}`}>
                        {fmtDec1(workload.perPerson)}
                        {workload.level === "over" && <span className="ml-1 text-xs">เกินเกณฑ์</span>}
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MaterialPage({ data, view, tab, branchId, currentMonth }: Props) {
  const months = monthChoices(currentMonth);
  const tabLink = (id: MaterialTab, label: string) => (
    <Link
      key={id}
      href={href(data.month, id, branchId)}
      aria-current={tab === id ? "page" : undefined}
      className={`inline-flex min-h-[44px] items-center rounded-[7px] px-4 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        tab === id ? "bg-accent font-semibold text-accent-fg" : "text-fg-muted hover:bg-surface-3"
      }`}
    >
      {label}
    </Link>
  );
  const ctl = `${styles.ctl} min-h-10 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg`;
  return (
    <div className={`${styles.root} min-w-0 max-w-full p-4 max-[640px]:p-3`}>
      <div className="mb-3">
        <h1 className="m-0 text-[22px] font-bold text-fg max-[600px]:text-xl">สรุปงานบริการรายเดือน</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          สรุปการใช้อุปกรณ์ (เหยื่อ NEMESIS · เคมีผง · ไม้ล่อ) และภาระงานรายทีม · {monthLabel(data.month)} · ไม่มีข้อมูลลูกค้ารายราย
        </p>
      </div>

      {view.truncated && (
        <Alert variant="warn" title="ข้อมูลมากเกินกว่าจะโหลดครบ">
          ตัวเลขด้านล่างอาจต่ำกว่าจริง ลองเลือกสาขาให้แคบลง หรือแจ้งผู้ดูแลระบบ
        </Alert>
      )}

      <nav aria-label="หัวข้อสรุป" className="my-3 inline-flex max-w-full flex-wrap gap-[3px] rounded-[10px] border border-border bg-surface-2 p-[3px]">
        {tabLink("mat", "การใช้อุปกรณ์")}
        {tabLink("team", "สรุปรายทีม")}
      </nav>

      <form method="get" action="/material" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <label className="grid gap-1 text-xs text-fg-muted">
          เดือน
          <select name="month" defaultValue={data.month} className={ctl}>
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-fg-muted">
          สาขา
          <select name="branch" defaultValue={branchId ?? ""} className={ctl}>
            <option value="">ทุกสาขา</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${styles.ctl} min-h-10 cursor-pointer rounded-lg border border-accent bg-accent px-4 text-[13px] font-semibold text-accent-fg hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-md:min-h-[44px]`}>
          ดูข้อมูล
        </button>
      </form>

      {tab === "mat" ? <MaterialTabContent data={data} view={view} /> : <TeamTabContent data={data} view={view} />}
    </div>
  );
}
