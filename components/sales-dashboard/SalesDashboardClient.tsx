"use client";

/**
 * Dashboard งานขาย (New/Renew) — ตัวหน้า (mockup FINAL docs/mockup/sales-dashboard.html ?v=b · DECISIONS 2.91)
 *
 * Logic summary:
 *   * รับแถวสัญญาที่ server โหลดมาแล้ว (ตามสิทธิ์ RLS) → กรอง/รวมยอดฝั่ง client ด้วย buildSalesView (pure · มีเทสต์)
 *   * สถานะตัวกรอง (เดือน/เขต/สาขา/ผู้ขาย + ประเภทงาน + ชิป) อยู่ในหน่วยความจำของหน้า ไม่ใส่ URL (ชื่อผู้ขายเป็นข้อความอิสระ · PDPA)
 *   * ประเภทงาน (ทั้งหมด/New/Renew) มีชุดเดียวที่แถบ sticky → กรองกราฟ อันดับ และรายชื่อ · การ์ดสรุปไม่กรองแต่ไฮไลต์
 *   * ลำดับหน้า: หัวเรื่อง → ชุดตัวกรองเต็ม → แถบ sticky → การ์ดสรุป → กราฟคู่ → อันดับคู่ → รายชื่อลูกค้า
 *   * ⚠ ข้อมูลลูกค้า ห้าม console.log
 */
import { useMemo, useState } from "react";

import { Alert } from "@/components/ui";

import { SalesCustomerList } from "./SalesCustomerList";
import { MonthlyChart, ZoneChart } from "./SalesCharts";
import { SalesFilterBar, type BranchOption, type RefOption } from "./SalesFilterBar";
import { SalesKpis } from "./SalesKpis";
import { BranchRank, SellerRank } from "./SalesRanks";
import { SalesStickyBar } from "./SalesStickyBar";
import { distinctSellers } from "./salesAggregate";
import { defaultSalesFilters, filterSummary, monthOptions } from "./salesFormat";
import type { SalesFilters, SalesRow } from "./salesTypes";
import { buildSalesView, type ListChip, type SalesTypeFilter } from "./salesView";

export interface SalesDashboardClientProps {
  rows: readonly SalesRow[];
  /** ข้อมูลเกินเพดานที่โหลด (ตัดบางส่วน) */
  truncated: boolean;
  /** เดือนปัจจุบันตามเวลาไทย 'YYYY-MM' */
  currentMonth: string;
}

export function SalesDashboardClient({ rows, truncated, currentMonth }: SalesDashboardClientProps) {
  const [filters, setFilters] = useState<SalesFilters>(() => defaultSalesFilters(currentMonth));
  const [type, setType] = useState<SalesTypeFilter>("all");
  const [chip, setChip] = useState<ListChip>("all");

  const months = useMemo(() => monthOptions(currentMonth), [currentMonth]);

  const { zones, branches } = useMemo(() => {
    const z = new Map<string, RefOption & { order: number }>();
    const b = new Map<string, BranchOption>();
    for (const r of rows) {
      if (!z.has(r.zoneId)) z.set(r.zoneId, { id: r.zoneId, name: r.zoneName, order: r.zoneOrder });
      if (!b.has(r.branchId)) b.set(r.branchId, { id: r.branchId, name: r.branchName, zoneId: r.zoneId });
    }
    return {
      zones: [...z.values()].sort((a, c) => a.order - c.order),
      branches: [...b.values()].sort((a, c) => a.name.localeCompare(c.name, "th")),
    };
  }, [rows]);
  const sellers = useMemo(() => distinctSellers(rows), [rows]);
  const hasUnnamedSeller = useMemo(() => rows.some((r) => !(r.saleName ?? "").trim()), [rows]);

  const view = useMemo(() => buildSalesView(rows, filters, { type, chip }), [rows, filters, type, chip]);

  const summary = filterSummary(filters, {
    zoneName: zones.find((z) => z.id === filters.zoneId)?.name ?? null,
    branchName: branches.find((b) => b.id === filters.branchId)?.name ?? null,
  });

  const reset = () => {
    setFilters(defaultSalesFilters(currentMonth));
    setType("all");
    setChip("all");
  };
  const listKey = `${filters.fromMonth}|${filters.toMonth}|${filters.zoneId}|${filters.branchId}|${filters.seller}|${type}|${chip}`;

  return (
    <div className="mx-auto max-w-[1200px] p-4 max-[767px]:p-3">
      <h1 className="m-0 text-[22px] font-bold max-[767px]:text-xl">Dashboard งานขาย (New/Renew)</h1>
      <p className="mb-3.5 mt-0.5 text-[13px] text-fg-muted">ยอดงานใหม่ (New) และต่อสัญญา (Renew) แยกตามสาขา เขต และผู้ขาย · นับตามเดือนที่รับ Mail</p>

      {truncated && (
        <Alert variant="warn" title="แสดงข้อมูลบางส่วน" className="mb-3">
          ข้อมูลมากกว่าที่หน้านี้โหลดได้ในครั้งเดียว ตัวเลขอาจต่ำกว่าจริง ลองจำกัดช่วงเดือนให้สั้นลง หรือแจ้งผู้ดูแลระบบ
        </Alert>
      )}

      <SalesFilterBar
        filters={filters}
        months={months}
        zones={zones}
        branches={branches}
        sellers={sellers}
        hasUnnamedSeller={hasUnnamedSeller}
        onChange={(f) => setFilters(f)}
        onReset={reset}
      />

      <SalesStickyBar
        type={type}
        onTypeChange={(t) => {
          setType(t);
          if (t === "new") setChip("all");
        }}
        summary={summary}
      />

      <div className="grid gap-3.5">
        <SalesKpis kpis={view.kpis} highlight={view.highlight} />

        {view.noMailCount > 0 && (
          <p className="m-0 text-[12.5px] text-fg-muted">ไม่มีวันที่รับ Mail {view.noMailCount.toLocaleString("th-TH")} ราย (ไม่นับในยอดและกราฟรายเดือน)</p>
        )}

        <div className="grid grid-cols-2 gap-3.5 max-[1000px]:grid-cols-1 [&>*]:min-w-0">
          <MonthlyChart months={view.months} type={type} />
          <ZoneChart zones={view.zones} type={type} />
        </div>

        <div className="grid grid-cols-2 gap-3.5 max-[1000px]:grid-cols-1 [&>*]:min-w-0">
          <SellerRank sellers={view.sellers} type={type} showLate={view.showLate} />
          <BranchRank branches={view.branches} type={type} showLate={view.showLate} />
        </div>

        <SalesCustomerList key={listKey} rows={view.list} chip={chip} onChipChange={setChip} showLate={view.showLate} />
      </div>
    </div>
  );
}
