import { describe, it, expect } from "vitest";
import { isMissedService } from "./missedService";
import type { Contract, Visit } from "./types";

const base: Contract = {
  id: "c1",
  startDate: "2026-01-01",
  termMonths: 12,
  valueTotal: 24000,
};

describe("isMissedService", () => {
  it("อยู่ในเดือนบริการ + ไม่ยกเลิก + ไม่มี routine → ตกบริการ", () => {
    expect(isMissedService(base, "2026-03", [])).toBe(true);
  });
  it("มี routine ในเดือนนั้น → ไม่ตก", () => {
    const v: Visit[] = [
      { contractId: "c1", visitDate: "2026-03-10", visitType: "routine" },
    ];
    expect(isMissedService(base, "2026-03", v)).toBe(false);
  });
  it("visit ที่ไม่ใช่ routine ไม่นับ", () => {
    const v: Visit[] = [
      { contractId: "c1", visitDate: "2026-03-10", visitType: "problem" },
    ];
    expect(isMissedService(base, "2026-03", v)).toBe(true);
  });
  it("เดือนนอกช่วงบริการ → ไม่ตก", () => {
    expect(isMissedService(base, "2027-05", [])).toBe(false);
  });
  it("สัญญายกเลิกตั้งแต่เดือนนั้น → ไม่ตก", () => {
    const c = { ...base, cancelledAt: "2026-02-15" };
    expect(isMissedService(c, "2026-03", [])).toBe(false);
  });

  it("รับเดือนแบบ 'YYYY-MM-01' จาก DB ได้", () => {
    const c = { id: "x", startDate: "2026-01-01", termMonths: 12 as const, valueTotal: 1 };
    expect(isMissedService(c, "2026-05-01", [])).toBe(true);
    expect(isMissedService(c, "2026-05-01", [{ contractId: "x", visitDate: "2026-05-09", visitType: "routine" }])).toBe(false);
  });
});
