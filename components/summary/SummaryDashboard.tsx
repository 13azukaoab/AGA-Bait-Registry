"use client";

/**
 * Dashboard สรุปมูลค่า (ส่วน public ของจอ 13 — SPEC §8) — ตัวกรอง + KPI + การ์ดส่วนกลาง/ต่างจังหวัด
 * + กราฟรายเดือน + Ranking สาขา + ตาราง 16 ฟิลด์
 *
 * ตรรกะ (สรุป):
 *  - รับแถวทั้งหมดจาก server (v_branch_summary) แล้วกรอง/รวมยอดในเครื่องผู้ใช้ — ตัวเลขทั้งหมดเป็นยอดรวมรายสาขา
 *    ไม่มีข้อมูลรายลูกค้า (PDPA)
 *  - ตัวกรอง "หน่วยงาน/เขต/สาขา" ใช้กับ KPI, Ranking และตาราง · การ์ดส่วนกลาง/ต่างจังหวัดและกราฟใช้เขต/สาขา
 *    แต่ไม่กรองหน่วยงาน (เพราะต้องเทียบสองหน่วยงาน)
 *  - ตัวกรอง Tier ใช้กับ KPI/การ์ด/กราฟ/Ranking (ตารางแสดงครบทุก Tier เพราะเป็นรูปแบบ 16 ฟิลด์เดิม)
 *  - ไม่มีข้อมูลเป้าหมาย (target) ในระบบ จึงไม่แสดง "% ของเป้า" ตาม mockup
 */
import { useMemo, useState, type ReactNode } from "react";

import { Alert } from "@/components/ui/Alert";
import { TierBadge } from "@/components/ui/TierBadge";

import {
  TIERS,
  changePct,
  filterRows,
  groupByMonth,
  rankBranches,
  shiftMonth,
  sortByBranchOrder,
  sortZones,
  sumFields,
  sumMetrics,
  buildTrend,
  ymToKey,
  type Division,
  type RankSort,
  type SummaryRow,
  type Tier,
} from "./calc";
import { formatBahtShort, formatInt, formatPct, formatShare } from "./format";
import { TrendChart } from "./TrendChart";

type Props = { rows: readonly SummaryRow[] };

const DIVISION_TABS: readonly { id: Division | "all"; label: string }[] = [
  { id: "all", label: "ทั้งประเทศ" },
  { id: "central", label: "ส่วนกลาง" },
  { id: "province", label: "ต่างจังหวัด" },
];

/** สีของปุ่มกรอง Tier — ใช้กลุ่มสีของ tier (ไม่ระบุปี) ตาม CLAUDE.md */
const TIER_CHIP: Record<Tier, string> = {
  S: "bg-[var(--tier-s-soft)] text-[var(--tier-s)]",
  M: "bg-[var(--tier-m-soft)] text-[var(--tier-m)]",
  L: "bg-[var(--tier-l-soft)] text-[var(--tier-l)]",
  XL: "bg-[var(--tier-xl-soft)] text-[var(--tier-xl)]",
};

const RANK_BADGE = [
  "bg-warn text-accent-fg",
  "bg-border-strong text-fg",
  "bg-[var(--tier-xl-soft)] text-[var(--tier-xl)]",
];

const RANK_PREVIEW = 10;

const cardClass = "rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)]";
const selectClass =
  "h-[34px] w-full min-w-0 cursor-pointer rounded-lg border border-border-strong bg-surface px-2 text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-fg-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        {children}
      </select>
    </label>
  );
}

/** ตัวเลข % เปลี่ยนแปลง: ▲ เขียว / ▼ แดง · null = ไม่มีฐานเทียบ */
function Delta({ value, suffix }: { value: number | null; suffix: string }) {
  if (value === null) return <span className="text-fg-faint">— ไม่มีข้อมูลเทียบ {suffix}</span>;
  const up = value > 0;
  const down = value < 0;
  return (
    <span className={up ? "text-ok" : down ? "text-danger" : "text-fg-muted"}>
      {up ? "▲ " : down ? "▼ " : ""}
      {formatPct(value)} {suffix}
    </span>
  );
}

export function SummaryDashboard({ rows }: Props) {
  const byMonth = useMemo(() => groupByMonth(rows), [rows]);
  const months = useMemo(() => [...byMonth.keys()].sort().reverse(), [byMonth]);

  const [month, setMonth] = useState<string>(months[0] ?? "");
  const [division, setDivision] = useState<Division | "all">("all");
  const [zoneRaw, setZoneRaw] = useState("all");
  const [branchRaw, setBranchRaw] = useState("all");
  const [tiers, setTiers] = useState<ReadonlySet<Tier>>(new Set());
  const [sortBy, setSortBy] = useState<RankSort>("value");
  const [showAllRank, setShowAllRank] = useState(false);

  const monthRows = useMemo(() => byMonth.get(month) ?? [], [byMonth, month]);

  // รายการเขต/สาขาใน dropdown — ตามหน่วยงานที่เลือก (เขต 9 คร่อม 2 หน่วยงาน)
  const divisionRows = useMemo(
    () => filterRows(monthRows, { division, zone: "all", branch: "all" }),
    [monthRows, division],
  );
  const zones = useMemo(() => sortZones(divisionRows.map((r) => r.zone)), [divisionRows]);
  const zone = zones.includes(zoneRaw) ? zoneRaw : "all";
  const branchChoices = useMemo(
    () => sortByBranchOrder(filterRows(divisionRows, { division: "all", zone, branch: "all" })),
    [divisionRows, zone],
  );
  const branch = branchChoices.some((r) => r.branch === branchRaw) ? branchRaw : "all";

  const scoped = useMemo(
    () => sortByBranchOrder(filterRows(monthRows, { division, zone, branch })),
    [monthRows, division, zone, branch],
  );
  const scopedAnyDivision = useMemo(
    () => filterRows(monthRows, { division: "all", zone, branch }),
    [monthRows, zone, branch],
  );

  // เดือนเทียบ: เดือนก่อนหน้า (MoM) และเดือนเดียวกันปีก่อน (YoY) — ใช้ตัวกรองชุดเดียวกัน
  const prevMonthRows = useMemo(
    () => filterRows(byMonth.get(shiftMonth(month, -1)) ?? [], { division, zone, branch }),
    [byMonth, month, division, zone, branch],
  );
  const prevYearRows = useMemo(
    () => filterRows(byMonth.get(shiftMonth(month, -12)) ?? [], { division, zone, branch }),
    [byMonth, month, division, zone, branch],
  );
  const hasPrevMonth = byMonth.has(shiftMonth(month, -1));
  const hasPrevYear = byMonth.has(shiftMonth(month, -12));

  const totals = useMemo(() => sumMetrics(scoped, tiers), [scoped, tiers]);
  const prevMonthTotals = useMemo(() => sumMetrics(prevMonthRows, tiers), [prevMonthRows, tiers]);
  const prevYearTotals = useMemo(() => sumMetrics(prevYearRows, tiers), [prevYearRows, tiers]);

  const central = useMemo(
    () => sumMetrics(scopedAnyDivision.filter((r) => r.division === "central"), tiers),
    [scopedAnyDivision, tiers],
  );
  const province = useMemo(
    () => sumMetrics(scopedAnyDivision.filter((r) => r.division === "province"), tiers),
    [scopedAnyDivision, tiers],
  );
  const divisionValueSum = central.value + province.value;

  const ranking = useMemo(
    () => rankBranches(scoped, prevMonthRows, tiers, sortBy),
    [scoped, prevMonthRows, tiers, sortBy],
  );
  const best = ranking[0] && ranking[0].value > 0 ? ranking[0] : null;

  const trend = useMemo(() => buildTrend(byMonth, { zone, branch }, tiers), [byMonth, zone, branch, tiers]);
  const fieldTotals = useMemo(() => sumFields(scoped), [scoped]);

  const countOf = (d: Division | "all") =>
    d === "all" ? monthRows.length : monthRows.filter((r) => r.division === d).length;

  const toggleTier = (t: Tier) =>
    setTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const zoneCount = new Set(monthRows.map((r) => r.zone)).size;
  const tierLabel = tiers.size ? ` · เฉพาะ Tier ${TIERS.filter((t) => tiers.has(t)).join(" + ")}` : "";
  const rankShown = showAllRank ? ranking : ranking.slice(0, RANK_PREVIEW);

  return (
    <div>
      <div className="mb-1">
        <h1 className="m-0 text-[22px] font-bold text-fg max-[600px]:text-xl">สรุปมูลค่าระบบเหยื่อ</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          ทั่วไทย {monthRows.length} สาขา · {zoneCount} เขต · Status snapshot ({ymToKey(month)}) —
          ข้อมูลที่ส่งเข้า AGA Bait Dashboard · <b>หน้า public ไม่มีข้อมูลลูกค้า</b>
        </p>
      </div>

      {/* หน่วยงาน */}
      <div
        role="group"
        aria-label="เลือกหน่วยงาน"
        className="my-4 inline-flex max-w-full flex-wrap gap-[3px] rounded-[10px] border border-border bg-surface-2 p-[3px]"
      >
        {DIVISION_TABS.map((t) => {
          const on = division === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => setDivision(t.id)}
              className={`cursor-pointer rounded-[7px] border-0 px-3.5 py-1.5 text-[12.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                on ? "bg-ok font-semibold text-accent-fg" : "bg-transparent text-fg-muted hover:bg-surface-3"
              }`}
            >
              {t.label} ({countOf(t.id)})
            </button>
          );
        })}
      </div>

      {/* ตัวกรอง */}
      <div className="mb-4 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4">
        <SelectField label="เดือน" value={month} onChange={setMonth}>
          {months.map((ym) => (
            <option key={ym} value={ym}>
              {ymToKey(ym)}
            </option>
          ))}
        </SelectField>
        <SelectField label="เขต" value={zone} onChange={setZoneRaw}>
          <option value="all">ทุกเขต</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </SelectField>
        <SelectField label="สาขา" value={branch} onChange={setBranchRaw}>
          <option value="all">ทุกสาขา</option>
          {branchChoices.map((r) => (
            <option key={r.branch} value={r.branch}>
              {r.branch}
            </option>
          ))}
        </SelectField>
        <SelectField label="เรียงอันดับตาม" value={sortBy} onChange={(v) => setSortBy(v as RankSort)}>
          <option value="value">มูลค่ารวม</option>
          <option value="cust">จำนวนลูกค้า</option>
        </SelectField>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
        <span>กรองตาม Tier:</span>
        {TIERS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tiers.has(t)}
            onClick={() => toggleTier(t)}
            className={`cursor-pointer rounded-full border-0 px-3 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${TIER_CHIP[t]} ${
              tiers.has(t) ? "shadow-[inset_0_0_0_2px_currentColor]" : "opacity-80 hover:opacity-100"
            }`}
          >
            {t}
          </button>
        ))}
        {tiers.size > 0 && (
          <button
            type="button"
            onClick={() => setTiers(new Set())}
            className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 text-xs text-accent-strong underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* KPI */}
      <div className="mb-[18px] grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-3.5 min-[601px]:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <div className="rounded-xl border border-l-4 border-border border-l-ok bg-surface px-[18px] py-4 shadow-[var(--shadow)] max-[600px]:px-3.5">
          <div className="text-xs text-fg-muted">มูลค่ารวม{tierLabel && " (ตาม Tier)"}</div>
          <div className="num mt-1.5 text-[28px] leading-[1.1] font-bold text-ok max-[600px]:text-2xl">
            {formatBahtShort(totals.value)}
          </div>
          <div className="mt-1.5 text-xs">
            {hasPrevMonth ? (
              <Delta value={changePct(totals.value, prevMonthTotals.value)} suffix="MoM" />
            ) : (
              <span className="text-fg-faint">— ไม่มีเดือนก่อนหน้า</span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-l-4 border-border border-l-ok bg-surface px-[18px] py-4 shadow-[var(--shadow)] max-[600px]:px-3.5">
          <div className="text-xs text-fg-muted">จำนวนลูกค้า</div>
          <div className="num mt-1.5 text-[28px] leading-[1.1] font-bold text-ok max-[600px]:text-2xl">
            {formatInt(totals.cust)}
          </div>
          <div className="mt-1.5 text-xs">
            {hasPrevYear ? (
              <Delta value={changePct(totals.cust, prevYearTotals.cust)} suffix="YoY" />
            ) : (
              <span className="text-fg-faint">— ไม่มีข้อมูลปีก่อน</span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-l-4 border-border border-l-ok bg-surface px-[18px] py-4 shadow-[var(--shadow)] max-[600px]:px-3.5">
          <div className="text-xs text-fg-muted">สาขาที่ดีที่สุด</div>
          <div className="mt-1.5 truncate text-[22px] leading-[1.25] font-bold text-ok max-[600px]:text-xl">
            {best ? best.branch : "—"}
          </div>
          <div className="num mt-1.5 text-xs text-ok">{best ? formatBahtShort(best.value) : "ยังไม่มียอด"}</div>
          <div className="mt-0.5 text-[11.5px] text-fg-faint">{best ? best.zone : ""}</div>
        </div>
        <div className="rounded-xl border border-l-4 border-border border-l-ok bg-surface px-[18px] py-4 shadow-[var(--shadow)] max-[600px]:px-3.5">
          <div className="text-xs text-fg-muted">จำนวนสาขา</div>
          <div className="num mt-1.5 text-[28px] leading-[1.1] font-bold text-ok max-[600px]:text-2xl">
            {formatInt(totals.branches)}
          </div>
          <div className="num mt-1.5 text-xs text-fg-faint">
            เฉลี่ย {formatBahtShort(totals.branches ? totals.value / totals.branches : 0)}/สาขา
          </div>
        </div>
      </div>

      {/* ส่วนกลาง vs ต่างจังหวัด */}
      <div className="mb-[18px] grid grid-cols-2 gap-3.5 max-[860px]:grid-cols-1">
        {(
          [
            { id: "central", title: "ส่วนกลาง", t: central, tone: "bg-accent-soft" },
            { id: "province", title: "ต่างจังหวัด", t: province, tone: "bg-warn-soft" },
          ] as const
        ).map(({ id, title, t, tone }) => (
          <section key={id} aria-label={title} className={`rounded-xl border border-border px-[18px] py-[15px] ${tone}`}>
            <h2 className="m-0 mb-2 flex justify-between text-sm font-semibold text-fg">
              {title}
              <span className="num">{divisionValueSum > 0 ? formatShare((t.value / divisionValueSum) * 100) : "—"}</span>
            </h2>
            {[
              ["มูลค่ารวม", formatBahtShort(t.value)],
              ["จำนวนลูกค้า", formatInt(t.cust)],
              ["จำนวนสาขา", formatInt(t.branches)],
              ["เฉลี่ย/สาขา", formatBahtShort(t.branches ? t.value / t.branches : 0)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-t border-border py-1 text-[12.5px] first:border-t-0">
                <span className="text-fg-muted">{k}</span>
                <b className="num text-fg">{v}</b>
              </div>
            ))}
          </section>
        ))}
      </div>

      {/* กราฟ */}
      <section className={`${cardClass} mb-[18px]`} aria-label="มูลค่ารายเดือน">
        <h2 className="m-0 mb-3 text-sm font-semibold text-fg">มูลค่ารายเดือน · ส่วนกลาง vs ต่างจังหวัด</h2>
        <TrendChart points={trend} />
      </section>

      {/* Ranking */}
      <section className={`${cardClass} mb-[18px]`} aria-label="อันดับสาขา">
        <h2 className="m-0 mb-3 text-sm font-semibold text-fg">Ranking สาขา · {ymToKey(month)}</h2>
        {ranking.length === 0 ? (
          <p className="m-0 text-[13px] text-fg-muted">ไม่มีสาขาตามตัวกรองที่เลือก</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {rankShown.map((item, i) => (
              <li
                key={item.branch}
                className="flex items-center gap-[11px] border-t border-border py-2.5 text-[13px] first:border-t-0 max-[600px]:gap-2"
              >
                <span
                  className={`grid size-6 flex-none place-items-center rounded-[7px] text-xs font-semibold ${
                    RANK_BADGE[i] ?? "bg-surface-3 text-fg-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-fg">{item.branch}</span>{" "}
                  <small className="num text-fg-muted max-[420px]:block">
                    · {item.zone} · {formatInt(item.cust)} ราย
                  </small>
                </div>
                <span
                  className={`num text-xs max-[420px]:hidden ${
                    item.mom === null ? "text-fg-faint" : item.mom > 0 ? "text-ok" : item.mom < 0 ? "text-danger" : "text-fg-muted"
                  }`}
                >
                  {item.mom === null ? "—" : `${item.mom > 0 ? "▲" : item.mom < 0 ? "▼" : ""}${formatPct(item.mom)}`}
                </span>
                <b className="num text-fg">{formatBahtShort(item.value)}</b>
              </li>
            ))}
          </ol>
        )}
        {ranking.length > RANK_PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAllRank((v) => !v)}
            className="mt-2 cursor-pointer rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-fg hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {showAllRank ? "แสดงเฉพาะ 10 อันดับแรก" : `แสดงทั้งหมด (${ranking.length} สาขา)`}
          </button>
        )}
      </section>

      {/* ตาราง 16 ฟิลด์ */}
      <h2 className="mb-2 text-[12.5px] font-semibold text-fg-muted">รายละเอียด 16 ฟิลด์ต่อสาขา (ส่งเข้า Dashboard)</h2>
      <div className="mb-3 overflow-x-auto rounded-xl border border-border bg-surface shadow-[var(--shadow)]" tabIndex={0} role="region" aria-label="ตารางรายละเอียดรายสาขา เลื่อนซ้ายขวาได้">
        <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-surface-2 text-fg-muted">
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">เขต</th>
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">สาขา</th>
              {(["S", "M", "L", "XL"] as const).flatMap((t) =>
                ([1, 3] as const).map((y) => (
                  <th key={`${t}${y}`} scope="col" className="px-2 py-2.5 text-center font-semibold">
                    <TierBadge tier={t} years={y} />
                  </th>
                )),
              )}
              {["cust", "vS", "vM", "vL", "vXL", "value"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2.5 text-right font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scoped.length === 0 ? (
              <tr>
                <td colSpan={16} className="px-3 py-6 text-center text-fg-muted">ไม่มีสาขาตามตัวกรองที่เลือก</td>
              </tr>
            ) : (
              scoped.map((r) => (
                <tr key={r.branch} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap text-fg-muted">{r.zone}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-semibold text-fg">{r.branch}</td>
                  {[r.s1, r.s3, r.m1, r.m3, r.l1, r.l3, r.xl1, r.xl3].map((v, i) => (
                    <td key={i} className="num px-2 py-2 text-center text-fg">{formatInt(v)}</td>
                  ))}
                  {[r.cust, r.vS, r.vM, r.vL, r.vXL, r.value].map((v, i) => (
                    <td key={i} className="num px-3 py-2 text-right text-fg">{formatInt(v)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {scoped.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border-strong bg-surface-2 font-bold">
                <td className="px-3 py-2.5" colSpan={2}>
                  {branch !== "all" ? "รวม" : zone !== "all" ? `รวม${zone}` : "รวมทั้งหมด"}
                </td>
                {[fieldTotals.s1, fieldTotals.s3, fieldTotals.m1, fieldTotals.m3, fieldTotals.l1, fieldTotals.l3, fieldTotals.xl1, fieldTotals.xl3].map((v, i) => (
                  <td key={i} className="num px-2 py-2.5 text-center text-fg">{formatInt(v)}</td>
                ))}
                {[fieldTotals.cust, fieldTotals.vS, fieldTotals.vM, fieldTotals.vL, fieldTotals.vXL, fieldTotals.value].map((v, i) => (
                  <td key={i} className="num px-3 py-2.5 text-right text-fg">{formatInt(v)}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <Alert variant="info">
        16 ฟิลด์ต่อแถวตรงกับรูปแบบ <b>dashboard_data.json</b> เดิม · ตารางแสดงครบทุก Tier แม้เลือกตัวกรอง Tier · ผู้ชมทั่วไปเห็นเฉพาะยอดรวมรายสาขา ไม่มีข้อมูลลูกค้ารายบุคคล
      </Alert>
    </div>
  );
}
