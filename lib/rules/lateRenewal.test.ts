import { describe, expect, it } from "vitest";

import { isLateRenewal } from "./lateRenewal";

describe("isLateRenewal (DECISIONS 2.91)", () => {
  it("Renew วันที่ 15 = ไม่ล่าช้า · 16 = ล่าช้า · 31 = ล่าช้า · 1 = ไม่ล่าช้า", () => {
    expect(isLateRenewal("renew", "2026-11-15")).toBe(false);
    expect(isLateRenewal("renew", "2026-11-16")).toBe(true);
    expect(isLateRenewal("renew", "2026-12-31")).toBe(true);
    expect(isLateRenewal("renew", "2026-11-01")).toBe(false);
  });
  it("New วันที่ 20 = ไม่ล่าช้า", () => {
    expect(isLateRenewal("new", "2026-11-20")).toBe(false);
  });
  it("ไม่มีวันที่ / ว่าง / รูปแบบผิด = ไม่ล่าช้า", () => {
    expect(isLateRenewal("renew", null)).toBe(false);
    expect(isLateRenewal("renew", undefined)).toBe(false);
    expect(isLateRenewal("renew", "")).toBe(false);
    expect(isLateRenewal("renew", "20/11/2026")).toBe(false);
    expect(isLateRenewal("renew", "2026-13-20")).toBe(false);
  });
  it("วันที่ตามปฏิทิน ไม่เลื่อนเพราะเขตเวลา (ตัวเลขวันที่เท่าที่ระบุ)", () => {
    expect(isLateRenewal("renew", "2026-11-16T00:00:00")).toBe(false); // รับเฉพาะ YYYY-MM-DD ล้วน
    expect(isLateRenewal("renew", "2026-03-16")).toBe(true);
  });
});
