import { describe, expect, it } from "vitest";

import { buildSalesView, filterByType } from "./salesView";
import type { SalesFilters, SalesRow } from "./salesTypes";

// ข้อมูลทดสอบสมมติทั้งหมด
let n = 0;
function row(p: Partial<SalesRow>): SalesRow {
  n += 1;
  return {
    contractId: `c${n}`,
    customerId: `u${n}`,
    customerName: `ลูกค้าทดสอบ ${n}`,
    branchId: "b1",
    branchName: "สาขา ก",
    zoneId: "z1",
    zoneName: "เขต 1",
    zoneOrder: 1,
    saleType: "new",
    saleName: "ผู้ขาย 1",
    amName: null,
    salesDate: "2026-11-10",
    dateSource: "mail",
    valueTotal: 100,
    isLate: false,
    ...p,
  };
}
const F: SalesFilters = { fromMonth: "2026-10", toMonth: "2026-11", zoneId: null, branchId: null, seller: null };
const ROWS = [
  row({ saleType: "new", valueTotal: 100, branchId: "b1", branchName: "สาขา ก" }),
  row({ saleType: "new", valueTotal: 700, branchId: "b2", branchName: "สาขา ข", saleName: "ผู้ขาย 2" }),
  row({ saleType: "renew", valueTotal: 300, salesDate: "2026-10-20", isLate: true, branchId: "b1", branchName: "สาขา ก" }),
  row({ saleType: "renew", valueTotal: 200, salesDate: "2026-10-05", branchId: "b2", branchName: "สาขา ข", saleName: "ผู้ขาย 2" }),
  row({ saleType: "renew", valueTotal: 50, salesDate: null }),
];

describe("filterByType", () => {
  it("all = ทุกแถว · new / renew = เฉพาะประเภท", () => {
    expect(filterByType(ROWS, "all")).toHaveLength(5);
    expect(filterByType(ROWS, "new")).toHaveLength(2);
    expect(filterByType(ROWS, "renew")).toHaveLength(3);
  });
});

describe("buildSalesView", () => {
  it("ทั้งหมด: การ์ดสรุปครบ · ไม่ไฮไลต์ · นับไม่มีวันที่รับ Mail แยกต่างหาก", () => {
    const v = buildSalesView(ROWS, F, { type: "all", chip: "all" });
    expect(v.kpis).toMatchObject({ newCount: 2, newValue: 800, renewCount: 2, renewValue: 500, lateCount: 1, lateValue: 300 });
    expect(v.kpis.lateShareOfRenew).toBeCloseTo(0.5);
    expect(v.highlight).toBeNull();
    expect(v.showLate).toBe(true);
    expect(v.list).toHaveLength(4);
  });

  it("เลือก New: การ์ดสรุปยังครบ แต่กราฟ/อันดับ/รายชื่อเหลือเฉพาะ New · ไม่แสดงล่าช้า", () => {
    const v = buildSalesView(ROWS, F, { type: "new", chip: "late" });
    expect(v.kpis.renewCount).toBe(2);
    expect(v.highlight).toBe("new");
    expect(v.showLate).toBe(false);
    expect(v.list.every((r) => r.saleType === "new")).toBe(true);
    expect(v.list).toHaveLength(2); // ชิป late ถูกมองเป็น all ตอนเลือก New
    expect(v.sellers.every((s) => s.renewCount === 0 && s.lateCount === 0)).toBe(true);
    expect(v.months.reduce((s, m) => s + m.renewCount, 0)).toBe(0);
    expect(v.zones.every((z) => z.renewCount === 0)).toBe(true);
  });

  it("เลือก Renew: อันดับสาขา/ผู้ขายเรียงตามมูลค่า Renew", () => {
    const v = buildSalesView(ROWS, F, { type: "renew", chip: "all" });
    expect(v.highlight).toBe("renew");
    expect(v.branches.map((b) => [b.branchName, b.renewValue])).toEqual([
      ["สาขา ก", 300],
      ["สาขา ข", 200],
    ]);
    expect(v.sellers.map((s) => s.name)).toEqual(["ผู้ขาย 1", "ผู้ขาย 2"]);
    expect(v.list).toHaveLength(2);
  });

  it("ทั้งหมด: อันดับสาขาเรียงตามมูลค่า New+Renew", () => {
    const v = buildSalesView(ROWS, F, { type: "all", chip: "all" });
    expect(v.branches.map((b) => b.branchName)).toEqual(["สาขา ข", "สาขา ก"]); // 900 > 400
  });

  it("ชิป late (ทั้งหมด/Renew): รายชื่อเหลือเฉพาะต่อสัญญาล่าช้า", () => {
    expect(buildSalesView(ROWS, F, { type: "all", chip: "late" }).list.map((r) => r.isLate)).toEqual([true]);
    expect(buildSalesView(ROWS, F, { type: "renew", chip: "late" }).list).toHaveLength(1);
  });

  it("ไม่มีแถวตรงตัวกรอง = ศูนย์ทุกส่วน ไม่ error", () => {
    const v = buildSalesView([], F, { type: "all", chip: "all" });
    expect(v.kpis.lateShareOfRenew).toBe(0);
    expect(v.list).toEqual([]);
    expect(v.months.map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
  });
});
