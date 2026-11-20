import { describe, expect, it } from "vitest";

import {
  defaultSalesFilters,
  filterSummary,
  formatDate,
  formatMoney,
  formatMoneyShort,
  monthOptions,
  monthShort,
  windowStartDate,
  windowStartMonth,
} from "./salesFormat";

describe("รูปแบบแสดงผล", () => {
  it("เดือนย่อ + ปี ค.ศ.", () => {
    expect(monthShort("2026-09")).toBe("ก.ย. 2026");
    expect(monthShort("2027-01")).toBe("ม.ค. 2027");
  });
  it("วันที่ · ว่าง/ผิดรูปแบบ = '-'", () => {
    expect(formatDate("2026-11-16")).toBe("16 พ.ย. 2026");
    expect(formatDate("2026-11-05")).toBe("5 พ.ย. 2026");
    expect(formatDate(null)).toBe("-");
    expect(formatDate("16/11/2026")).toBe("-");
  });
  it("เงิน: เต็มและแบบย่อ (ล้าน)", () => {
    expect(formatMoney(1234567.4)).toBe("1,234,567");
    expect(formatMoneyShort(999_999)).toBe("999,999");
    expect(formatMoneyShort(1_234_000)).toBe("1.23 ล้าน");
  });
});

describe("หน้าต่างข้อมูล/ตัวกรองเริ่มต้น", () => {
  it("12 เดือน นับรวมเดือนนี้ · ข้ามปีได้", () => {
    expect(windowStartMonth("2026-11")).toBe("2025-12");
    expect(windowStartDate("2026-11")).toBe("2025-12-01");
    const opts = monthOptions("2026-11");
    expect(opts).toHaveLength(12);
    expect(opts[0]).toBe("2025-12");
    expect(opts.at(-1)).toBe("2026-11");
  });
  it("ตัวกรองเริ่มต้น = 3 เดือนล่าสุด ทุกเขต/สาขา/คน", () => {
    expect(defaultSalesFilters("2026-11")).toEqual({
      fromMonth: "2026-09",
      toMonth: "2026-11",
      zoneId: null,
      branchId: null,
      seller: null,
    });
    expect(defaultSalesFilters("2026-01").fromMonth).toBe("2025-11");
  });
});

describe("filterSummary", () => {
  const f = defaultSalesFilters("2026-11");
  it("ค่าเริ่มต้น", () => {
    expect(filterSummary(f, { zoneName: null, branchName: null })).toBe("ก.ย. 2026 – พ.ย. 2026 · ทุกเขต · ทุกสาขา · ทุกคน");
  });
  it("เดือนเดียว · ระบุเขต/สาขา/ผู้ขาย · ผู้ขายว่าง = ไม่ระบุ", () => {
    expect(
      filterSummary({ ...f, fromMonth: "2026-11", seller: "ผู้ขาย ก" }, { zoneName: "เขต 2", branchName: "สาขา ข" }),
    ).toBe("พ.ย. 2026 · เขต 2 · สาขา ข · ผู้ขาย ก");
    expect(filterSummary({ ...f, seller: "" }, { zoneName: null, branchName: null })).toContain("ไม่ระบุผู้ขาย");
  });
});
