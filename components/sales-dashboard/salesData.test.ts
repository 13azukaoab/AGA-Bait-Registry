import { describe, expect, it } from "vitest";

import { loadSalesRows, toSalesRow, type SalesRowDb } from "./salesData";

// ข้อมูลทดสอบสมมติทั้งหมด
const base: SalesRowDb = {
  id: "c1",
  customer_id: "u1",
  sale_type: "renew",
  sale_name: " ผู้ขาย 1 ",
  am_name: "",
  mail_received_date: "2026-11-16",
  value_total: "12345.50",
  customers: {
    name: "ลูกค้าทดสอบ",
    branch_id: "b1",
    branches: { name: "สาขา ก", zone_id: "z1", zones: { name: "เขต 1", sort_order: 1 } },
  },
};

// stub ของ isLateRenewal ในเทสต์เท่านั้น (สูตรจริงอยู่ lib/rules/lateRenewal.ts และมีเทสต์ของตัวเอง)
const lateStub = (t: string, d: string | null) => t === "renew" && !!d && Number(d.slice(8, 10)) > 15;

describe("toSalesRow", () => {
  it("แปลงแถว · ตัดช่องว่างชื่อ · ชื่อว่าง = null · มูลค่าเป็นตัวเลข · ส่งผลล่าช้าจากฟังก์ชันที่ฉีดเข้ามา", () => {
    const r = toSalesRow(base, lateStub);
    expect(r).toMatchObject({
      contractId: "c1",
      customerId: "u1",
      branchName: "สาขา ก",
      zoneName: "เขต 1",
      zoneOrder: 1,
      saleType: "renew",
      saleName: "ผู้ขาย 1",
      amName: null,
      valueTotal: 12345.5,
      isLate: true,
    });
  });
  it("embed เขตเป็น array ก็อ่านได้", () => {
    const r = toSalesRow({ ...base, customers: { ...base.customers!, branches: { ...base.customers!.branches!, zones: [{ name: "เขต 2", sort_order: 2 }] } } }, lateStub);
    expect(r?.zoneName).toBe("เขต 2");
  });
  it("ไม่ใช่ New/Renew หรือขาดสาขา/เขต = ข้าม (null)", () => {
    expect(toSalesRow({ ...base, sale_type: null }, lateStub)).toBeNull();
    expect(toSalesRow({ ...base, sale_type: "other" }, lateStub)).toBeNull();
    expect(toSalesRow({ ...base, customers: null }, lateStub)).toBeNull();
    expect(toSalesRow({ ...base, customers: { ...base.customers!, branches: null } }, lateStub)).toBeNull();
  });
  it("ไม่มีวันที่รับ Mail = mailDate null · มูลค่าผิดรูปแบบ = 0", () => {
    const r = toSalesRow({ ...base, mail_received_date: null, value_total: "abc" }, lateStub);
    expect(r).toMatchObject({ mailDate: null, valueTotal: 0, isLate: false });
  });
});

describe("loadSalesRows", () => {
  it("วันที่หน้าต่างรูปแบบผิด = ไม่ยิง query (คืน code)", async () => {
    const supabase = { from: () => { throw new Error("ต้องไม่ถูกเรียก"); } };
    const res = await loadSalesRows(supabase as never, "2026-11; drop", lateStub);
    expect(res).toEqual({ ok: false, code: "bad_window" });
  });
  it("error จากฐานข้อมูลคืนแค่ code ไม่คืนข้อความดิบ", async () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "not", "or", "order"]) chain[k] = () => chain;
    chain.range = async () => ({ data: null, error: { code: "42501", message: "ข้อมูลลูกค้า" } });
    const res = await loadSalesRows({ from: () => chain } as never, "2026-08-01", lateStub);
    expect(res).toEqual({ ok: false, code: "42501" });
  });
  it("ได้น้อยกว่า 1,000 แถว = จบ ไม่ตัด", async () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "not", "or", "order"]) chain[k] = () => chain;
    chain.range = async () => ({ data: [base, { ...base, id: "c2", sale_type: null }], error: null });
    const res = await loadSalesRows({ from: () => chain } as never, "2026-08-01", lateStub);
    expect(res.ok && res.rows.length).toBe(1);
    expect(res.ok && res.truncated).toBe(false);
  });
});
