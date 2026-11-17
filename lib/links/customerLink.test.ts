import { describe, expect, it } from "vitest";

import { customerDetailHref, customerLinkContexts } from "./customerLink";

const CUS = "0b6f3c1e-1111-4a2b-9c3d-aaaaaaaaaaaa";
const CON = "7d2e9a40-2222-4b3c-8d4e-bbbbbbbbbbbb";

describe("customerDetailHref", () => {
  it("ไม่มี context = ลิงก์เปล่า", () => {
    expect(customerDetailHref(CUS)).toBe(`/customers/${CUS}`);
  });

  it("ชื่อลูกค้าทั่วไป → แท็บสัญญา + id สัญญา", () => {
    expect(customerDetailHref(CUS, customerLinkContexts.contract(CON))).toBe(`/customers/${CUS}?tab=contracts&contract=${CON}`);
  });

  it("ตกบริการ → แท็บประวัติทำบริการ + id สัญญา", () => {
    expect(customerDetailHref(CUS, customerLinkContexts.missed(CON))).toBe(`/customers/${CUS}?tab=visits&contract=${CON}`);
  });

  it("AG รอถอด → แท็บสถานี กรอง AG + pending_removal (ไม่มีป้ายจุดใน URL)", () => {
    const href = customerDetailHref(CUS, customerLinkContexts.agPendingRemoval(CON));
    expect(href).toBe(`/customers/${CUS}?tab=stations&contract=${CON}&status=pending_removal&type=AG`);
    expect(href).not.toContain("station=");
  });

  it("id ลูกค้าไม่ใช่ UUID / ว่าง → null (ไม่ทำลิงก์พัง)", () => {
    expect(customerDetailHref("abc")).toBeNull();
    expect(customerDetailHref("")).toBeNull();
    expect(customerDetailHref(null)).toBeNull();
    expect(customerDetailHref(undefined)).toBeNull();
    expect(customerDetailHref("../admin")).toBeNull();
    expect(customerDetailHref(`${CUS}/../x`)).toBeNull();
  });

  it("id สัญญาไม่ใช่ UUID → ตัดทิ้ง ไม่ส่งต่อใน query", () => {
    expect(customerDetailHref(CUS, { tab: "visits", contractId: "ชื่อบริษัท" })).toBe(`/customers/${CUS}?tab=visits`);
  });

  it("แปลง id เป็นตัวพิมพ์เล็ก", () => {
    expect(customerDetailHref(CUS.toUpperCase())).toBe(`/customers/${CUS}`);
  });

  it("query มีเฉพาะ id/enum — ไม่มีอักขระไทย/ช่องว่าง", () => {
    const href = customerDetailHref(CUS, customerLinkContexts.agPendingRemoval(CON)) ?? "";
    expect(href).toMatch(/^\/customers\/[0-9a-f-]+\?[a-z_=&0-9A-Z-]+$/);
  });
});
