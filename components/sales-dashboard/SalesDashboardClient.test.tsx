import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SalesCustomerList } from "./SalesCustomerList";
import { SalesDashboardClient } from "./SalesDashboardClient";
import { BranchRank, SellerRank } from "./SalesRanks";
import { MonthlyChart, ZoneChart } from "./SalesCharts";
import { SalesKpis } from "./SalesKpis";
import { buildSalesView } from "./salesView";
import type { SalesFilters, SalesRow } from "./salesTypes";

// ข้อมูลทดสอบสมมติทั้งหมด (ไม่ใช่ข้อมูลจริง) · เทสต์ render ฝั่ง server เพื่อตรวจโครง/ข้อความ/ลิงก์/ป้ายล่าช้า
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function row(n: number, p: Partial<SalesRow>): SalesRow {
  return {
    contractId: UUID(n),
    customerId: UUID(1000 + n),
    customerName: `ลูกค้าทดสอบ ${n}`,
    branchId: "b1",
    branchName: "สาขาทดสอบ 1",
    zoneId: "z1",
    zoneName: "เขต 1",
    zoneOrder: 1,
    saleType: "new",
    saleName: "ผู้ขายทดสอบ 1",
    amName: "AM ทดสอบ",
    mailDate: "2026-11-05",
    valueTotal: 100000,
    isLate: false,
    ...p,
  };
}
const ROWS: SalesRow[] = [
  row(1, { saleType: "new" }),
  row(2, { saleType: "renew", mailDate: "2026-11-16", isLate: true, valueTotal: 250000 }),
  row(3, { saleType: "renew", mailDate: "2026-11-10", branchId: "b2", branchName: "สาขาทดสอบ 2", zoneId: "z2", zoneName: "เขต 2", zoneOrder: 2, saleName: null }),
  row(4, { saleType: "new", mailDate: null }),
];
const F: SalesFilters = { fromMonth: "2026-09", toMonth: "2026-11", zoneId: null, branchId: null, seller: null };
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("SalesDashboardClient (render ฝั่ง server)", () => {
  const out = html(<SalesDashboardClient rows={ROWS} truncated={false} currentMonth="2026-11" />);

  it("มีหัวเรื่อง ตัวกรอง แถบ sticky การ์ดสรุป กราฟ อันดับ และรายชื่อ", () => {
    expect(out).toContain("Dashboard งานขาย (New/Renew)");
    expect(out).toContain('id="sales-filters"');
    expect(out).toContain("ล้างตัวกรอง");
    expect(out).toContain("sticky");
    expect(out).toContain("แนวโน้มรายเดือน");
    expect(out).toContain("แยกตามเขต");
    expect(out).toContain("อันดับผู้ขาย");
    expect(out).toContain("ยอดรายสาขา");
    expect(out).toContain("รายชื่อลูกค้า");
  });
  it("ชื่อลูกค้าเป็นลิงก์ /customers/<id> (มีแต่ id ไม่มีชื่อใน URL)", () => {
    expect(out).toContain(`href="/customers/${UUID(1002)}?tab=contracts&amp;contract=${UUID(2)}"`);
    expect(out).not.toMatch(/href="[^"]*ลูกค้าทดสอบ/);
  });
  it("ต่อสัญญาล่าช้า: ป้ายตัวหนังสือ + tooltip · หมายเหตุไม่มีวันที่รับ Mail", () => {
    expect(out).toContain("ล่าช้า");
    expect(out).toContain('title="ต่อสัญญาล่าช้า"');
    expect(out).toContain("ไม่มีวันที่รับ Mail 1 ราย");
  });
  it("ผู้ขายไม่มีชื่อแสดงเป็น 'ไม่ระบุผู้ขาย' · ไม่มีรหัสสี hex ในผลลัพธ์", () => {
    expect(out).toContain("ไม่ระบุผู้ขาย");
    expect(out).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
  it("ข้อมูลถูกตัด → แสดงคำเตือนภาษาไทย", () => {
    expect(html(<SalesDashboardClient rows={ROWS} truncated currentMonth="2026-11" />)).toContain("แสดงข้อมูลบางส่วน");
  });
  it("ไม่มีแถว → ข้อความว่างภาษาไทย ไม่ error", () => {
    const empty = html(<SalesDashboardClient rows={[]} truncated={false} currentMonth="2026-11" />);
    expect(empty).toContain("ไม่พบงานตามตัวกรองนี้");
  });
});

describe("ชิ้นส่วนตามประเภทที่เลือก", () => {
  it("เลือก New: ไม่มี legend Renew / ไม่มีชิปล่าช้า / ไม่มีป้ายล่าช้าในอันดับ", () => {
    const v = buildSalesView(ROWS, F, { type: "new", chip: "all" });
    const charts = html(<MonthlyChart months={v.months} type="new" />) + html(<ZoneChart zones={v.zones} type="new" />);
    expect(charts).not.toContain("</i>Renew</span>"); // legend ไม่มี Renew (ตาราง sr-only ยังมีคอลัมน์ Renew ตามปกติ)
    expect(charts).toContain("</i>New</span>");
    const ranks = html(<SellerRank sellers={v.sellers} type="new" showLate={v.showLate} />) + html(<BranchRank branches={v.branches} type="new" showLate={v.showLate} />);
    expect(ranks).not.toContain("ล่าช้า");
    const list = html(<SalesCustomerList rows={v.list} chip="all" onChipChange={() => {}} showLate={v.showLate} />);
    expect(list).not.toContain("ต่อสัญญาล่าช้า</button>");
  });
  it("เลือก Renew: อันดับแสดงเฉพาะจำนวน Renew และมีป้ายล่าช้า", () => {
    const v = buildSalesView(ROWS, F, { type: "renew", chip: "all" });
    const ranks = html(<SellerRank sellers={v.sellers} type="renew" showLate={v.showLate} />);
    expect(ranks).toContain("1 ราย");
    expect(ranks).not.toContain("New 0");
    expect(ranks).toContain("ล่าช้า 1");
  });
  it("การ์ดสรุป: เลือกประเภทแล้วยังครบ 4 ใบ และไฮไลต์ใบที่เลือก", () => {
    const v = buildSalesView(ROWS, F, { type: "renew", chip: "all" });
    const out = html(<SalesKpis kpis={v.kpis} highlight={v.highlight} />);
    for (const label of ["งานใหม่ (New)", "ต่อสัญญา (Renew)", "ต่อสัญญาล่าช้า", "รวมทั้งหมด"]) expect(out).toContain(label);
    expect(out).toContain("ring-2");
  });
});
