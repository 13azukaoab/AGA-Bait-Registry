import { describe, it, expect } from "vitest";
import { isMissedService } from "./missedService";
import { missedMonths } from "./missedResolution";
import { buildBranchSnapshot } from "./snapshot";
import { isPausedMonth, pausedServiceMonths, pauseMakeupMonths } from "./pause";
import { TIER_RULES } from "./__fixtures__/tierRules";
import type { BranchRef, Contract, Visit } from "./types";

// ข้อมูลสมมติทั้งหมด (M29 · DECISIONS 2.52 / 2.63 / 2.87)
const branch: BranchRef = { area: "เขต 1", branch: "สาขาสมมติ" };

const base: Contract = {
  id: "c1",
  startDate: "2026-01-01",
  termMonths: 12,
  valueTotal: 24000,
  stationsInitializedAt: "2026-01-05",
};

const routine = (date: string, extra: Partial<Visit> = {}): Visit => ({
  contractId: "c1",
  visitDate: date,
  visitType: "routine",
  ...extra,
});

describe("isPausedMonth (เดือนที่เริ่มพัก = พัก · เดือนที่กลับมาต่อ = ใช้งาน)", () => {
  const c: Contract = { ...base, pauses: [{ from: "2026-03-15", resumedAt: "2026-05-10" }] };

  it("เดือนก่อนพัก ไม่พัก", () => {
    expect(isPausedMonth(c, "2026-02")).toBe(false);
  });
  it("เดือนที่เริ่มพัก (กลางเดือน) นับว่าพักทั้งเดือน", () => {
    expect(isPausedMonth(c, "2026-03")).toBe(true);
  });
  it("เดือนระหว่างพัก", () => {
    expect(isPausedMonth(c, "2026-04")).toBe(true);
  });
  it("เดือนที่กลับมาต่อ = ใช้งานแล้ว", () => {
    expect(isPausedMonth(c, "2026-05")).toBe(false);
  });
  it("ยังไม่กลับมาต่อ → ทุกเดือนตั้งแต่เริ่มพักนับว่าพัก", () => {
    const open: Contract = { ...base, pauses: [{ from: "2026-03-01" }] };
    expect(isPausedMonth(open, "2026-03")).toBe(true);
    expect(isPausedMonth(open, "2026-11")).toBe(true);
    expect(isPausedMonth(open, "2026-02")).toBe(false);
  });
  it("พักแล้วกลับมาต่อในเดือนเดียวกัน → ไม่มีเดือนพัก", () => {
    const same: Contract = { ...base, pauses: [{ from: "2026-03-02", resumedAt: "2026-03-20" }] };
    expect(isPausedMonth(same, "2026-03")).toBe(false);
  });
  it("ไม่มี pauses / ว่าง → ไม่พัก", () => {
    expect(isPausedMonth(base, "2026-03")).toBe(false);
    expect(isPausedMonth({ ...base, pauses: [] }, "2026-03")).toBe(false);
  });
  it("รับเดือน 'YYYY-MM-01' และวันที่เวลาจาก DB ได้", () => {
    expect(isPausedMonth(c, "2026-04-01")).toBe(true);
    const tz: Contract = { ...base, pauses: [{ from: "2026-02-28T18:00:00+00:00" }] };
    expect(isPausedMonth(tz, "2026-03")).toBe(true); // 1 มี.ค. 01:00 เวลาไทย
  });
  it("หลายช่วงพัก", () => {
    const multi: Contract = {
      ...base,
      pauses: [
        { from: "2026-02-01", resumedAt: "2026-03-01" },
        { from: "2026-06-10", resumedAt: "2026-08-01" },
      ],
    };
    expect(["2026-01", "2026-02", "2026-03", "2026-05", "2026-06", "2026-07", "2026-08"].map((m) => isPausedMonth(multi, m)))
      .toEqual([false, true, false, false, true, true, false]);
  });
});

describe("isMissedService + พักสัญญา (2.52: ไม่นับตกบริการช่วงพัก)", () => {
  it("เดือนที่พักครอบเดือนที่ไม่มีบริการ → ไม่ตก", () => {
    const c: Contract = { ...base, pauses: [{ from: "2026-03-01", resumedAt: "2026-06-01" }] };
    expect(isMissedService(c, "2026-03", [])).toBe(false);
    expect(isMissedService(c, "2026-04", [])).toBe(false);
    expect(isMissedService(c, "2026-05", [])).toBe(false);
  });
  it("กลับมาต่อแล้ว → เดือนที่กลับมาต่อและหลังจากนั้นนับตกตามปกติ", () => {
    const c: Contract = { ...base, pauses: [{ from: "2026-03-01", resumedAt: "2026-06-12" }] };
    expect(isMissedService(c, "2026-06", [])).toBe(true);
    expect(isMissedService(c, "2026-07", [])).toBe(true);
    expect(isMissedService(c, "2026-07", [routine("2026-07-03")])).toBe(false);
  });
  it("เดือนก่อนพักยังตกได้ตามปกติ", () => {
    const c: Contract = { ...base, pauses: [{ from: "2026-03-01", resumedAt: "2026-06-01" }] };
    expect(isMissedService(c, "2026-02", [])).toBe(true);
  });
  it("missedMonths ข้ามเดือนที่พัก (พักข้ามปี)", () => {
    const c: Contract = {
      ...base,
      startDate: "2026-09-01",
      stationsInitializedAt: "2026-09-02",
      pauses: [{ from: "2026-11-20", resumedAt: "2027-02-05" }],
    };
    expect(missedMonths(c, [], "2027-04")).toEqual(["2026-09", "2026-10", "2027-02", "2027-03"]);
  });
});

describe("buildBranchSnapshot + พักสัญญา (2.87: Dashboard ไม่นับเดือนที่พัก)", () => {
  const c: Contract = { ...base, pauses: [{ from: "2026-03-10", resumedAt: "2026-05-02" }] };

  it("ไม่นับเดือนที่พัก แต่นับเดือนก่อนและหลัง", () => {
    expect(buildBranchSnapshot(branch, [c], "2026-02", TIER_RULES).cust).toBe(1);
    expect(buildBranchSnapshot(branch, [c], "2026-03", TIER_RULES).cust).toBe(0);
    expect(buildBranchSnapshot(branch, [c], "2026-04", TIER_RULES).cust).toBe(0);
    expect(buildBranchSnapshot(branch, [c], "2026-05", TIER_RULES).cust).toBe(1);
  });
  it("เดือนที่พักไม่มีมูลค่า (value / vS / tier count = 0)", () => {
    const row = buildBranchSnapshot(branch, [c], "2026-04", TIER_RULES);
    expect(row.value).toBe(0);
    expect(row.vS).toBe(0);
    expect(row.s1).toBe(0);
    expect(row.value_annual).toBe(0);
  });
  it("พักข้ามเดือน/ปี: นับเฉพาะสัญญาที่ไม่พักในสาขาเดียวกัน", () => {
    const other: Contract = { id: "c2", startDate: "2026-09-01", termMonths: 12, valueTotal: 60000 };
    const paused: Contract = {
      id: "c3",
      startDate: "2026-09-01",
      termMonths: 12,
      valueTotal: 24000,
      pauses: [{ from: "2026-12-31", resumedAt: "2027-01-01" }],
    };
    const dec = buildBranchSnapshot(branch, [other, paused], "2026-12", TIER_RULES);
    expect(dec.cust).toBe(1);
    expect(dec.value).toBe(60000);
    const jan = buildBranchSnapshot(branch, [other, paused], "2027-01", TIER_RULES);
    expect(jan.cust).toBe(2);
    expect(jan.value).toBe(84000);
  });
  it("การเข้าชดเชยของเดือนที่พักหลังสัญญาจบ (host บันทึก) นับในเดือนที่เข้าจริง", () => {
    const p: Contract = { ...base, pauses: [{ from: "2026-11-01", resumedAt: "2026-12-15" }] };
    const visits = [routine("2027-01-20", { makeupForMonth: "2026-11-01" })];
    expect(buildBranchSnapshot(branch, [p], "2027-01", TIER_RULES, visits).cust).toBe(1);
    expect(buildBranchSnapshot(branch, [p], "2027-02", TIER_RULES, visits).cust).toBe(0);
  });
});

describe("pausedServiceMonths / pauseMakeupMonths (2.87: ต้องชดเชยให้ครบ)", () => {
  const c: Contract = { ...base, pauses: [{ from: "2026-03-10", resumedAt: "2026-06-02" }] };

  it("เดือนบริการที่พัก (ก่อนเดือน upto) — ตัดนอกอายุสัญญา", () => {
    expect(pausedServiceMonths(c, "2026-12")).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(pausedServiceMonths(c, "2026-05")).toEqual(["2026-03", "2026-04"]);
    const tail: Contract = { ...base, pauses: [{ from: "2026-11-01" }] };
    expect(pausedServiceMonths(tail, "2027-06")).toEqual(["2026-11", "2026-12"]);
  });
  it("ชดเชยแล้ว / ยังค้าง แยกรายเดือน", () => {
    const visits = [routine("2026-07-08", { makeupForMonth: "2026-04-01" })];
    expect(pauseMakeupMonths(c, visits, "2026-08")).toEqual([
      { month: "2026-03", madeUpMonth: undefined },
      { month: "2026-04", madeUpMonth: "2026-07" },
      { month: "2026-05", madeUpMonth: undefined },
    ]);
  });
  it("ยังไม่ตั้งสถานี / สัญญายกเลิก → ไม่มีรายการค้างชดเชย", () => {
    expect(pauseMakeupMonths({ ...c, stationsInitializedAt: undefined }, [], "2026-08")).toEqual([]);
    expect(pauseMakeupMonths({ ...c, cancelledAt: "2026-07-01" }, [], "2026-08")).toEqual([]);
  });
  it("เดือนที่พักก่อนเดือนตั้งสถานี ไม่ต้องชดเชย (นับตั้งแต่ตั้งสถานี — 2.46)", () => {
    const late: Contract = { ...c, stationsInitializedAt: "2026-04-03" };
    expect(pauseMakeupMonths(late, [], "2026-08").map((x) => x.month)).toEqual(["2026-04", "2026-05"]);
  });
  it("การเข้าชดเชยของเดือนที่พัก ไม่นับเป็นบริการประจำของเดือนตัวเอง", () => {
    const visits = [routine("2026-07-08", { makeupForMonth: "2026-04-01" })];
    expect(isMissedService(c, "2026-07", visits)).toBe(true);
  });
});
