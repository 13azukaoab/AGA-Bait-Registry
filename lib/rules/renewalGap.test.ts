import { describe, it, expect } from "vitest";
import { effectiveEndDate, latestRenewStartMonth, renewalGapOk, unlinkedRenewAllowed } from "./renewalGap";
import { isRenewed, isSuperseded, missedResolutionStatus } from "./missedResolution";
import type { Contract } from "./types";

// M28 / DECISIONS 2.51 — Renew ได้เฉพาะสัญญาใหม่ที่เริ่มไม่เกิน 2 เดือนหลังเดือนที่สัญญาเก่าจบ
// ตรงกับ SQL `renewal_gap_ok` / `contract_effective_end_date` (20261115180000_renewal_gap_rule.sql)

const old: Contract = {
  id: "old",
  customerId: "cu1",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  termMonths: 12,
  valueTotal: 24000,
};

describe("effectiveEndDate", () => {
  it("ใช้ end_date ถ้ามี", () => {
    expect(effectiveEndDate(old)).toBe("2026-12-31");
    expect(effectiveEndDate({ ...old, endDate: "2026-11-15" })).toBe("2026-11-15");
  });
  it("end_date ว่าง → วันเริ่ม + N ปี − 1 วัน", () => {
    expect(effectiveEndDate({ ...old, endDate: undefined })).toBe("2026-12-31");
    expect(effectiveEndDate({ ...old, startDate: "2026-01-15", endDate: undefined })).toBe("2027-01-14");
    expect(effectiveEndDate({ ...old, termMonths: 36, endDate: undefined })).toBe("2028-12-31");
  });
});

describe("renewalGapOk (DECISIONS 2.51)", () => {
  it("จบ 31 ธ.ค. 2026 → เริ่ม ม.ค. / ก.พ. 2027 = Renew ได้", () => {
    expect(renewalGapOk(old, "2027-01-01")).toBe(true);
    expect(renewalGapOk(old, "2027-02-01")).toBe(true);
    expect(renewalGapOk(old, "2027-02-28")).toBe(true);
  });
  it("จบ 31 ธ.ค. 2026 → เริ่ม มี.ค. 2027 ขึ้นไป = ต้องเป็น New", () => {
    expect(renewalGapOk(old, "2027-03-01")).toBe(false);
    expect(renewalGapOk(old, "2027-06-15")).toBe(false);
  });
  it("จบกลางเดือน (14 ม.ค. 2027) → ถึง มี.ค. 2027 ได้ · เม.ย. ไม่ได้ (นับจากเดือนของ end_date ไม่ใช่เดือนบริการสุดท้าย)", () => {
    const mid = { ...old, startDate: "2026-01-15", endDate: undefined };
    expect(renewalGapOk(mid, "2027-03-31")).toBe(true);
    expect(renewalGapOk(mid, "2027-04-01")).toBe(false);
  });
  it("ซ้อนกัน (สัญญาใหม่เริ่มก่อนสัญญาเก่าจบ) = Renew ได้", () => {
    expect(renewalGapOk(old, "2026-12-01")).toBe(true);
    expect(renewalGapOk(old, "2026-06-01")).toBe(true);
  });
  it("เริ่มก่อนหรือวันเดียวกับวันเริ่มสัญญาเก่า = ไม่ใช่การต่อสัญญา", () => {
    expect(renewalGapOk(old, "2026-01-01")).toBe(false);
    expect(renewalGapOk(old, "2025-12-01")).toBe(false);
  });
  it("ข้ามปี: จบ พ.ย. → ม.ค. ได้ · ก.พ. ไม่ได้", () => {
    const nov = { ...old, endDate: "2026-11-30" };
    expect(renewalGapOk(nov, "2027-01-31")).toBe(true);
    expect(renewalGapOk(nov, "2027-02-01")).toBe(false);
  });
  it("latestRenewStartMonth = เดือนสุดท้ายที่ยังเลือก Renew ได้ (ให้หน้าจอล็อกตัวเลือก)", () => {
    expect(latestRenewStartMonth(old)).toBe("2027-02");
    expect(latestRenewStartMonth({ ...old, endDate: "2026-11-30" })).toBe("2027-01");
  });
});

describe("isSuperseded (DECISIONS 2.47 + 2.51 — ตกบริการค้างเป็นโมฆะ)", () => {
  const renewal: Contract = { ...old, id: "r", startDate: "2027-01-01", endDate: "2027-12-31", renewedFromContractId: "old" };
  const newLater: Contract = { ...old, id: "n", startDate: "2027-05-01", endDate: "2028-04-30" };

  it("มีสัญญา Renew ผูกมา → โมฆะ (เหมือน isRenewed เดิม)", () => {
    expect(isSuperseded(old, [old, renewal])).toBe(true);
    expect(isRenewed(old, [old, renewal])).toBe(true);
  });
  it("ลูกค้าเดียวกันมีสัญญา New ที่เริ่มหลังสัญญาเก่าจบ → โมฆะ", () => {
    expect(isSuperseded(old, [old, newLater])).toBe(true);
    expect(isRenewed(old, [old, newLater])).toBe(false);
  });
  it("New ที่เริ่มวันเดียวกับวันจบ หรือซ้อนช่วงสัญญาเก่า → ไม่โมฆะ", () => {
    expect(isSuperseded(old, [old, { ...newLater, startDate: "2026-12-31" }])).toBe(false);
    expect(isSuperseded(old, [old, { ...newLater, startDate: "2026-06-01" }])).toBe(false);
  });
  it("New ของลูกค้าคนอื่น → ไม่โมฆะ", () => {
    expect(isSuperseded(old, [old, { ...newLater, customerId: "cu2" }])).toBe(false);
  });
  it("Renew ที่ผูกสัญญาอื่น (ไม่ใช่สัญญานี้) ไม่นับเป็น New", () => {
    expect(isSuperseded(old, [old, { ...newLater, renewedFromContractId: "other" }])).toBe(false);
  });
  it("สัญญาใหม่ที่ถูกยกเลิก ไม่ทำให้โมฆะ (DECISIONS 2.48 ②) — ทั้ง Renew และ New", () => {
    expect(isSuperseded(old, [old, { ...renewal, cancelledAt: "2027-02-01" }])).toBe(false);
    expect(isSuperseded(old, [old, { ...newLater, cancelledAt: "2027-06-01" }])).toBe(false);
  });
  it("ใช้วันจบตามสูตร (end_date ว่าง)", () => {
    const noEnd = { ...old, startDate: "2026-01-15", endDate: undefined }; // จบ 14 ม.ค. 2027
    expect(isSuperseded(noEnd, [noEnd, { ...newLater, startDate: "2027-01-14" }])).toBe(false);
    expect(isSuperseded(noEnd, [noEnd, { ...newLater, startDate: "2027-01-15" }])).toBe(true);
  });
  it("ไม่รู้ลูกค้า (customerId ว่าง) → ใช้ได้เฉพาะกรณี Renew", () => {
    const anon = { ...old, customerId: undefined };
    expect(isSuperseded(anon, [anon, { ...newLater, customerId: undefined }])).toBe(false);
  });
  it("ไม่นับตัวเอง", () => {
    expect(isSuperseded(old, [old])).toBe(false);
  });
  it("โมฆะแล้ว เรื่องที่รอตัดสินเป็น void_renewed", () => {
    expect(missedResolutionStatus(old, "2026-05", undefined, [], isSuperseded(old, [old, newLater]))).toBe("void_renewed");
  });
});

describe("unlinkedRenewAllowed (M28 รอบ 2 — Renew ไม่ผูกสัญญาเก่า เปิดได้แค่ช่วงแรก)", () => {
  // ค่า app_settings.allow_unlinked_renew_until = วันแรกที่ "ไม่ได้แล้ว" (2027-04-01 = ใช้ได้ถึง 31 มี.ค. 2027)
  it("ก่อนวันกำหนด = ได้ · ตรงวันกำหนดหรือหลังจากนั้น = ต้องผูกสัญญาเก่า", () => {
    expect(unlinkedRenewAllowed("2027-03-31", "2027-04-01")).toBe(true);
    expect(unlinkedRenewAllowed("2027-04-01", "2027-04-01")).toBe(false);
    expect(unlinkedRenewAllowed("2027-05-10", "2027-04-01")).toBe(false);
  });
  it("รับค่า timestamp ได้ (ตัดเหลือวันที่)", () => {
    expect(unlinkedRenewAllowed("2026-11-16T10:00:00", "2027-04-01")).toBe(true);
  });
});

describe("M30 — ระยะสัญญาเป็นเดือน (ข้อ 7)", () => {
  const short: Contract = { id: "s", customerId: "cu1", startDate: "2026-01-15", termMonths: 5, valueTotal: 20000 };
  it("end_date ว่าง → เริ่ม + m เดือน − 1 วัน (5 เดือน: 15/01 → 14/06)", () => {
    expect(effectiveEndDate(short)).toBe("2026-06-14");
    expect(effectiveEndDate({ ...short, startDate: "2026-01-31", termMonths: 1 })).toBe("2026-02-28");
  });
  it("Renew ของสัญญา 5 เดือน: จบ มิ.ย. → ได้ถึง ส.ค. 2026 · ก.ย. ต้องเป็น New", () => {
    expect(latestRenewStartMonth(short)).toBe("2026-08");
    expect(renewalGapOk(short, "2026-08-31")).toBe(true);
    expect(renewalGapOk(short, "2026-09-01")).toBe(false);
  });
  it("New ที่เริ่มหลังวันจบจริงของสัญญาสั้น → สัญญาสั้นถูกแทน (isSuperseded)", () => {
    const next: Contract = { id: "n", customerId: "cu1", startDate: "2026-06-15", termMonths: 12, valueTotal: 24000 };
    expect(isSuperseded(short, [short, next])).toBe(true);
    expect(isSuperseded(short, [short, { ...next, startDate: "2026-06-14" }])).toBe(false);
  });
});
