"use client";

/**
 * CustomerDetailClient — โครงหน้า "รายละเอียดลูกค้า" (SPEC §8 หน้า 4 · mockup FINAL `docs/mockup/customer-detail.html`)
 *
 * Logic summary:
 *   * รับข้อมูลที่ server โหลดแล้ว (data.ts) · ถือ state ของหน้า: แท็บ · สัญญาที่เลือก · ตัวกรองสถานี/ประวัติ (คงไว้ตอนสลับแท็บ)
 *   * ลิงก์เจาะจงจากหน้าอื่น: `/customers/<id>?tab=stations&contract=<contract_id>&station=AG-04&status=pending_removal&type=AG`
 *     (ใช้เฉพาะรหัส/คีย์ ไม่ใส่ข้อมูลลูกค้าใน URL) · เปลี่ยนแท็บ = อัปเดต URL แบบ replace (ไม่เพิ่มประวัติเบราว์เซอร์)
 *   * ตกบริการคำนวณครั้งเดียวที่นี่ (computeMissed · lib/rules) แล้วส่งให้การ์ดตัวเลข + แท็บประวัติ → ตัวเลขตรงกันเสมอ
 *   * หลังบันทึก (ข้อมูลติดต่อ / ตัดสินตกบริการ) → router.refresh() ให้ server อ่านค่าใหม่จากฐานข้อมูล (ไม่บวก/ลบเอง)
 *   * ไทม์ไลน์ = host เท่านั้น (สิทธิ์ใน customerPermissions · RLS ของ audit_log บังคับอีกชั้น)
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Alert, Toast } from "@/components/ui";

import { AlertsBar, Header, Kpis, type GotoOpts, type TabKey } from "./Header";
import { InfoPanel } from "./InfoPanel";
import { computeMissed, customerPermissions } from "./logic";
import { ContractsTab } from "./tabs/ContractsTab";
import { DashTab } from "./tabs/DashTab";
import { FilesTab } from "./tabs/FilesTab";
import { initialStationUi, StationsTab, type StationUi } from "./tabs/StationsTab";
import { TimelineTab } from "./tabs/TimelineTab";
import { initialVisitUi, VisitsTab, type VisitUi } from "./tabs/VisitsTab";
import type { CustomerDetailData } from "./types";

export interface InitialView {
  tab?: string;
  contract?: string;
  status?: string;
  type?: string;
  station?: string;
}

const TAB_ORDER: [TabKey, string][] = [
  ["dash", "ภาพรวม"],
  ["contracts", "สัญญา"],
  ["stations", "สถานี"],
  ["visits", "ประวัติทำบริการ"],
  ["files", "ไฟล์แนบ"],
  ["timeline", "ไทม์ไลน์"],
];

const STATION_STATUSES = ["active", "pending_removal", "removed", "lost", "withdrawn"] as const;

function isTab(v: string | undefined): v is TabKey {
  return !!v && TAB_ORDER.some(([k]) => k === v);
}

export function CustomerDetailClient({ data, initial }: { data: CustomerDetailData; initial: InitialView }) {
  const router = useRouter();
  const perm = customerPermissions(data.role);
  const contractIds = new Set(data.contracts.map((c) => c.id));
  const initContract = initial.contract && contractIds.has(initial.contract) ? initial.contract : null;

  const initTab: TabKey = isTab(initial.tab) && (initial.tab !== "timeline" || perm.timeline) ? initial.tab : initial.station ? "stations" : "dash";
  const [tab, setTab] = useState<TabKey>(initTab);
  const [selected, setSelected] = useState<string | null>(initContract);
  const [toast, setToast] = useState("");
  const [stationUi, setStationUi] = useState<StationUi>(() => {
    const specific = !!(initial.type || initial.status || initial.station);
    return {
      ...initialStationUi,
      attn: !specific,
      contractId: initContract ?? "all",
      type: initial.type === "IG" || initial.type === "IC" || initial.type === "AG" ? initial.type : "all",
      status: (STATION_STATUSES as readonly string[]).includes(initial.status ?? "") ? (initial.status as StationUi["status"]) : "all",
      q: initial.station ?? "",
    };
  });
  const [visitUi, setVisitUi] = useState<VisitUi>({ ...initialVisitUi, contractId: initContract ?? "all" });

  const missed = useMemo(
    () =>
      computeMissed({
        contracts: data.contracts,
        visits: data.visits,
        resolutions: data.resolutions,
        customerId: data.customer.id,
        currentMonth: data.currentMonth,
        deadlineMonths: data.makeupDeadlineMonths,
      }),
    [data],
  );

  function writeUrl(t: TabKey, contractId: string | null) {
    try {
      const qs = new URLSearchParams({ tab: t });
      if (contractId) qs.set("contract", contractId);
      window.history.replaceState(null, "", `?${qs.toString()}`);
    } catch {
      /* ไม่เป็นไร — URL อัปเดตไม่ได้ ไม่กระทบการใช้งาน */
    }
  }

  function changeTab(t: TabKey, contractId: string | null = selected) {
    setTab(t);
    writeUrl(t, contractId);
  }

  function goto(t: TabKey, opts: GotoOpts = {}) {
    if (opts.contractId) setSelected(opts.contractId);
    if (t === "stations") {
      setStationUi({
        ...initialStationUi,
        attn: false,
        contractId: opts.contractId ?? "all",
        type: opts.type === "IG" || opts.type === "IC" || opts.type === "AG" ? opts.type : "all",
        status: (STATION_STATUSES as readonly string[]).includes(opts.status ?? "") ? (opts.status as StationUi["status"]) : "all",
      });
    }
    if (t === "visits") setVisitUi({ ...initialVisitUi, contractId: opts.contractId ?? "all" });
    changeTab(t, opts.contractId ?? selected);
    requestAnimationFrame(() => document.getElementById("detail-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  const visibleTabs = TAB_ORDER.filter(([k]) => k !== "timeline" || perm.timeline);
  const counts: Partial<Record<TabKey, number>> = {
    contracts: data.contracts.length,
    stations: data.stations.length,
    visits: data.visits.length,
    files: data.files.length,
    timeline: data.audit?.length,
  };

  function onTabKey(e: React.KeyboardEvent) {
    const ids = visibleTabs.map(([k]) => k);
    const i = ids.indexOf(tab);
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % ids.length;
    else if (e.key === "ArrowLeft") n = (i + ids.length - 1) % ids.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = ids.length - 1;
    else return;
    e.preventDefault();
    const next = ids[n] as TabKey;
    changeTab(next);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  }

  return (
    <div className="p-4 max-[640px]:p-3">
      <nav aria-label="เส้นทาง" className="mb-2 text-xs text-fg-muted">
        <Link href="/customers" className="text-accent-strong underline">
          ทะเบียนลูกค้า/สัญญา
        </Link>
        <span aria-hidden="true"> › </span>
        <span>รายละเอียดลูกค้า</span>
      </nav>

      <Header data={data} onGoto={goto} />
      {data.contracts.length === 0 ? (
        <Alert variant="info" title="ลูกค้ารายนี้ยังไม่มีสัญญา" className="mb-3">
          เพิ่มสัญญาได้ที่หน้าเปิดงานเข้าทะเบียนบริการ
        </Alert>
      ) : null}
      <Kpis data={data} missed={missed} onGoto={goto} />
      <AlertsBar data={data} onGoto={goto} />

      <div className="grid items-start gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        <InfoPanel data={data} />
        <div className="min-w-0 rounded-xl border border-border bg-surface">
          <div role="tablist" aria-label="หมวดข้อมูลลูกค้า" onKeyDown={onTabKey} className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-2">
            {visibleTabs.map(([k, label]) => {
              const on = tab === k;
              return (
                <button
                  key={k}
                  id={`tab-${k}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="detail-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => changeTab(k)}
                  className={`flex-none whitespace-nowrap rounded-t-md border-b-2 px-3 text-[13px] max-md:min-h-11 md:min-h-10 ${on ? "border-accent font-semibold text-accent-strong" : "border-transparent text-fg-muted hover:text-fg"}`}
                >
                  {label}
                  {counts[k] !== undefined ? <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 text-xs text-fg-muted">{counts[k]}</span> : null}
                </button>
              );
            })}
          </div>
          <div id="detail-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0} className="p-3.5 outline-none max-[640px]:p-3">
            {tab === "dash" ? <DashTab data={data} contractId={selected} onToast={setToast} /> : null}
            {tab === "contracts" ? <ContractsTab data={data} selected={selected} onPick={setSelected} onGoto={goto} /> : null}
            {tab === "stations" ? <StationsTab data={data} ui={stationUi} onUi={setStationUi} /> : null}
            {tab === "visits" ? <VisitsTab data={data} ui={visitUi} onUi={setVisitUi} missed={missed} onToast={setToast} onChanged={() => router.refresh()} /> : null}
            {tab === "files" ? <FilesTab data={data} onToast={setToast} /> : null}
            {tab === "timeline" && perm.timeline ? <TimelineTab data={data} /> : null}
          </div>
        </div>
      </div>
      <Toast message={toast} onClose={() => setToast("")} />
    </div>
  );
}
