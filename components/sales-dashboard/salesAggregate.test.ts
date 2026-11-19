import { describe, expect, it } from "vitest";

import {
  countNoMailDate,
  distinctSellers,
  filterSales,
  groupByBranch,
  groupByMonth,
  groupByZone,
  mailMonth,
  monthsBetween,
  rankSellers,
  sumRows,
} from "./salesAggregate";
import type { SalesFilters, SalesRow } from "./salesTypes";

// ข้อมูลทดสอบสมมติทั้งหมด (ไม่ใช่ข้อมูลจริง)
let seq = 0;
function row(p: Partial<SalesRow>): SalesRow {
  seq += 1;
  return {
    contractId: `c${seq}`,
    customerId: `u${seq}`,
    customerName: `ลูกค้าทดสอบ ${seq}`,
    branchId: "b1",
    branchName: "สาขา ก",
    zoneId: "z1",
    zoneName: "เขต 1",
    zoneOrder: 1,
    saleType: "new",
    saleName: "ผู้ขาย 1",
    amName: "AM 1",
    mailDate: "2026-11-10",
    valueTotal: 100,
    isLate: false,
    ...p,
  };
}

const ALL: SalesFilters = { fromMonth: "2026-09", toMonth: "2026-11", zoneId: null, branchId: null, seller: null };

const DATA: SalesRow[] = [
  row({ saleType: "new", valueTotal: 100, mailDate: "2026-09-05" }),
  row({ saleType: "renew", valueTotal: 200, mailDate: "2026-09-15", isLate: false }),
  row({ saleType: "renew", valueTotal: 300, mailDate: "2026-10-16", isLate: true }),
  row({ saleType: "new", valueTotal: 400, mailDate: "2026-11-02", branchId: "b2", branchName: "สาขา ข", saleName: "ผู้ขาย 2" }),
  row({
    saleType: "renew",
    valueTotal: 500,
    mailDate: "2026-11-20",
    isLate: true,
    branchId: "b3",
    branchName: "สาขา ค",
    zoneId: "z2",
    zoneName: "เขต 2",
    zoneOrder: 2,
    saleName: "ผู้ขาย 2",
  }),
  row({ saleType: "new", valueTotal: 999, mailDate: "2026-08-31" }), // นอกช่วงเดือน
  row({ saleType: "renew", valueTotal: 50, mailDate: null, saleName: null, amName: null }), // ไม่มีวันที่รับ Mail
];

describe("mailMonth / monthsBetween", () => {
  it("แปลงวันที่เป็นเดือน · ว่าง/รูปแบบผิด = null", () => {
    expect(mailMonth("2026-11-16")).toBe("2026-11");
    expect(mailMonth(null)).toBeNull();
    expect(mailMonth("2026-13-01")).toBeNull();
    expect(mailMonth("xx")).toBeNull();
  });
  it("ช่วงเดือนข้ามปี ครบทุกเดือน · กลับด้าน = []", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-11", "2026-11")).toEqual(["2026-11"]);
    expect(monthsBetween("2026-12", "2026-11")).toEqual([]);
    expect(monthsBetween("bad", "2026-11")).toEqual([]);
  });
});

describe("filterSales / countNoMailDate", () => {
  it("กรองตามเดือนของวันที่รับ Mail (ตัดนอกช่วง และแถวไม่มีวันที่)", () => {
    const r = filterSales(DATA, ALL);
    expect(r).toHaveLength(5);
    expect(r.every((x) => x.mailDate !== null && x.mailDate >= "2026-09-01" && x.mailDate <= "2026-11-30")).toBe(true);
  });
  it("เรียงวันที่รับ Mail ใหม่→เก่า", () => {
    const dates = filterSales(DATA, ALL).map((x) => x.mailDate);
    expect(dates).toEqual(["2026-11-20", "2026-11-02", "2026-10-16", "2026-09-15", "2026-09-05"]);
  });
  it("ตัวกรองเขต/สาขา/ผู้ขาย/ช่วงเดือน ทำงานร่วมกัน", () => {
    expect(filterSales(DATA, { ...ALL, zoneId: "z2" })).toHaveLength(1);
    expect(filterSales(DATA, { ...ALL, branchId: "b2" })).toHaveLength(1);
    expect(filterSales(DATA, { ...ALL, seller: "ผู้ขาย 2" })).toHaveLength(2);
    expect(filterSales(DATA, { ...ALL, fromMonth: "2026-10", toMonth: "2026-10" })).toHaveLength(1);
    expect(filterSales(DATA, { ...ALL, zoneId: "z1", seller: "ผู้ขาย 2" })).toHaveLength(1);
  });
  it("ช่วงเดือนกลับด้าน = ไม่มีแถว", () => {
    expect(filterSales(DATA, { ...ALL, fromMonth: "2026-11", toMonth: "2026-09" })).toEqual([]);
  });
  it("นับสัญญาที่ไม่มีวันที่รับ Mail ตามตัวกรองขอบเขต (ไม่ขึ้นกับเดือน)", () => {
    expect(countNoMailDate(DATA, ALL)).toBe(1);
    expect(countNoMailDate(DATA, { ...ALL, zoneId: "z2" })).toBe(0);
    expect(countNoMailDate(DATA, { ...ALL, seller: "" })).toBe(1); // "" = ไม่ระบุผู้ขาย
    expect(countNoMailDate(DATA, { ...ALL, seller: "ผู้ขาย 1" })).toBe(0);
  });
});

describe("sumRows — ยอด New/Renew และต่อสัญญาล่าช้า", () => {
  it("รวมราย + มูลค่า แยก New / Renew · ล่าช้าเป็นส่วนหนึ่งของ Renew", () => {
    const t = sumRows(filterSales(DATA, ALL));
    expect(t).toEqual({ newCount: 2, newValue: 500, renewCount: 3, renewValue: 1000, lateCount: 2, lateValue: 800 });
  });
  it("New ที่ตั้ง isLate=true โดยพลาด ก็ไม่ถูกนับเป็นล่าช้า (ล่าช้าเฉพาะ Renew)", () => {
    const t = sumRows([row({ saleType: "new", isLate: true, valueTotal: 10 })]);
    expect(t.lateCount).toBe(0);
    expect(t.newCount).toBe(1);
  });
  it("ไม่มีแถว = ศูนย์ทุกช่อง", () => {
    expect(sumRows([])).toEqual({ newCount: 0, newValue: 0, renewCount: 0, renewValue: 0, lateCount: 0, lateValue: 0 });
  });
});

describe("groupByBranch / groupByZone", () => {
  const rows = filterSales(DATA, ALL);
  it("รวมต่อสาขา เรียงตามเขตแล้วชื่อสาขา", () => {
    const g = groupByBranch(rows);
    expect(g.map((b) => b.branchName)).toEqual(["สาขา ก", "สาขา ข", "สาขา ค"]);
    expect(g[0]).toMatchObject({ newCount: 1, newValue: 100, renewCount: 2, renewValue: 500, lateCount: 1, lateValue: 300 });
    expect(g[1]).toMatchObject({ newCount: 1, newValue: 400, renewCount: 0 });
    expect(g[2]).toMatchObject({ renewCount: 1, lateCount: 1, lateValue: 500, zoneName: "เขต 2" });
  });
  it("รวมต่อเขต และผลรวมทุกเขต = ยอดรวมทั้งหมด", () => {
    const z = groupByZone(rows);
    expect(z.map((x) => x.zoneName)).toEqual(["เขต 1", "เขต 2"]);
    const total = sumRows(rows);
    expect(z.reduce((s, x) => s + x.newCount + x.renewCount, 0)).toBe(total.newCount + total.renewCount);
    expect(z.reduce((s, x) => s + x.lateCount, 0)).toBe(total.lateCount);
    expect(z.reduce((s, x) => s + x.newValue + x.renewValue, 0)).toBe(total.newValue + total.renewValue);
  });
});

describe("groupByMonth", () => {
  it("ครบทุกเดือนในช่วง เดือนที่ไม่มีงานเป็น 0", () => {
    const rows = filterSales(DATA, { ...ALL, fromMonth: "2026-09", toMonth: "2026-12" });
    const g = groupByMonth(rows, "2026-09", "2026-12");
    expect(g.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(g[0]).toMatchObject({ newCount: 1, renewCount: 1, lateCount: 0 });
    expect(g[1]).toMatchObject({ newCount: 0, renewCount: 1, lateCount: 1 });
    expect(g[3]).toMatchObject({ newCount: 0, renewCount: 0, lateCount: 0 });
  });
});

describe("rankSellers", () => {
  const rows = filterSales(DATA, ALL);
  it("เรียงตามมูลค่ารวมมาก→น้อย", () => {
    const r = rankSellers(rows, "sale");
    expect(r.map((s) => [s.name, s.totalValue])).toEqual([
      ["ผู้ขาย 2", 900],
      ["ผู้ขาย 1", 600],
    ]);
    expect(r[0]).toMatchObject({ contractCount: 2, newCount: 1, renewCount: 1, lateCount: 1 });
  });
  it("มูลค่าเท่ากัน เรียงตามชื่อ · ไม่มีชื่อ = กลุ่ม ''", () => {
    const r = rankSellers(
      [row({ saleName: "ข", valueTotal: 5 }), row({ saleName: "ก", valueTotal: 5 }), row({ saleName: null, valueTotal: 9 })],
      "sale",
    );
    expect(r.map((s) => s.name)).toEqual(["", "ก", "ข"]);
  });
  it("จัดอันดับตาม AM ได้", () => {
    const r = rankSellers([row({ amName: "AM x", valueTotal: 1 }), row({ amName: "AM y", valueTotal: 2 })], "am");
    expect(r.map((s) => s.name)).toEqual(["AM y", "AM x"]);
  });
  it("ไม่มีแถว = รายการว่าง", () => {
    expect(rankSellers([], "sale")).toEqual([]);
  });
});

describe("distinctSellers", () => {
  it("ไม่ซ้ำ ข้ามค่าว่าง เรียงตามชื่อ", () => {
    expect(distinctSellers(DATA)).toEqual(["ผู้ขาย 1", "ผู้ขาย 2"]);
  });
});
