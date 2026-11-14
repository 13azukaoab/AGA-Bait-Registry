import { describe, it, expect } from "vitest";
import {
  defaultMakeupMonth,
  missedMonths,
  missedResolutionStatus,
  needsDecision,
  makeupCountsInSnapshot,
} from "./missedResolution";
import { isMissedService } from "./missedService";
import type { Contract, MissedServiceResolution, Visit } from "./types";

// สัญญา 1/1–31/12/2026 บริการเดือนละครั้ง (ตัวอย่างจาก DECISIONS 2.41)
const c: Contract = { id: "c1", startDate: "2026-01-01", termYears: 1, valueTotal: 24000 };

const routine = (date: string, makeupForMonth?: string): Visit => ({
  contractId: "c1",
  visitDate: date,
  visitType: "routine",
  ...(makeupForMonth ? { makeupForMonth } : {}),
});

const makeup = (missedMonth: string, makeupMonth: string): MissedServiceResolution => ({
  contractId: "c1",
  missedMonth,
  kind: "makeup",
  makeupMonth,
});
const waived: MissedServiceResolution = { contractId: "c1", missedMonth: "2026-05", kind: "waived" };

describe("isMissedService + การเข้าชดเชย", () => {
  it("การเข้าที่ผูกเป็นชดเชยของเดือนอื่น ไม่นับเป็น routine ของเดือนตัวเอง", () => {
    // มิ.ย. มีครั้งเดียว และผูกเป็นชดเชย พ.ค. → มิ.ย. ตกบริการ
    expect(isMissedService(c, "2026-06", [routine("2026-06-10", "2026-05")])).toBe(true);
  });
  it("มิ.ย. มี 2 ครั้ง (ปกติ + ชดเชย) → มิ.ย. ไม่ตก", () => {
    const v = [routine("2026-06-03"), routine("2026-06-20", "2026-05")];
    expect(isMissedService(c, "2026-06", v)).toBe(false);
  });
});

describe("missedMonths", () => {
  it("คืนเฉพาะเดือนบริการที่ผ่านไปแล้วและไม่มี routine (ไม่นับเดือนปัจจุบัน)", () => {
    const v = ["01", "02", "03", "04", "06"].map((m) => routine(`2026-${m}-10`));
    expect(missedMonths(c, v, "2026-07")).toEqual(["2026-05"]);
  });
  it("การเข้าชดเชยไม่ปิดเดือนที่ตกในรายการ (ประวัติจริงเสมอ)", () => {
    const v = [
      ...["01", "02", "03", "04", "06"].map((m) => routine(`2026-${m}-10`)),
      routine("2026-06-20", "2026-05"),
    ];
    expect(missedMonths(c, v, "2026-07")).toEqual(["2026-05"]);
  });
  it("สัญญาจบแล้ว ไม่คืนเดือนหลังสัญญา", () => {
    const v = ["01", "02", "03", "04", "06", "07", "08", "09", "10", "11", "12"].map((m) =>
      routine(`2026-${m}-10`),
    );
    expect(missedMonths(c, v, "2027-03")).toEqual(["2026-05"]);
  });
});

describe("missedResolutionStatus (5 สถานะ)", () => {
  it("ไม่มีการตัดสิน → pending (รอตัดสิน)", () => {
    expect(missedResolutionStatus(c, "2026-05", undefined, [], "2026-07")).toBe("pending");
  });
  it("ไม่ชดเชย → waived · ไม่ค้างในรายการต้องทำ", () => {
    const s = missedResolutionStatus(c, "2026-05", waived, [], "2026-07");
    expect(s).toBe("waived");
    expect(needsDecision(s)).toBe(false);
  });
  it("ชดเชย ม.ค. 2027 ยังไม่ถึง → makeup_scheduled (ชดเชย → เดือน)", () => {
    const s = missedResolutionStatus(c, "2026-05", makeup("2026-05", "2027-01"), [], "2026-11");
    expect(s).toBe("makeup_scheduled");
    expect(needsDecision(s)).toBe(false);
  });
  it("อยู่ในเดือนชดเชยแล้ว แต่ยังไม่ไป → ยัง makeup_scheduled (รอสิ้นเดือน)", () => {
    expect(missedResolutionStatus(c, "2026-05", makeup("2026-05", "2027-01"), [], "2027-01")).toBe(
      "makeup_scheduled",
    );
  });
  it("มีการเข้าที่ผูกไว้ → made_up (ชดเชยแล้ว)", () => {
    const v = [routine("2027-01-12", "2026-05")];
    const s = missedResolutionStatus(c, "2026-05", makeup("2026-05", "2027-01"), v, "2027-01");
    expect(s).toBe("made_up");
    expect(needsDecision(s)).toBe(false);
  });
  it("ชดเชย ม.ค. 2027 ไม่มีการเข้า → สิ้น ม.ค. = makeup_not_done และกลับไปรอตัดสิน", () => {
    const s = missedResolutionStatus(c, "2026-05", makeup("2026-05", "2027-01"), [], "2027-02");
    expect(s).toBe("makeup_not_done");
    expect(needsDecision(s)).toBe(true);
  });
  it("ตก พ.ค. ชดเชย มิ.ย. แต่ มิ.ย. มีครั้งเดียวที่ไม่ได้ผูก → makeup_not_done", () => {
    const v = [routine("2026-06-10")];
    expect(missedResolutionStatus(c, "2026-05", makeup("2026-05", "2026-06"), v, "2026-07")).toBe(
      "makeup_not_done",
    );
  });
  it("ตก พ.ค. ชดเชย มิ.ย. มี 2 ครั้ง (ผูก 1) → made_up และ มิ.ย. ไม่ตก", () => {
    const v = [routine("2026-06-03"), routine("2026-06-20", "2026-05")];
    expect(missedResolutionStatus(c, "2026-05", makeup("2026-05", "2026-06"), v, "2026-07")).toBe(
      "made_up",
    );
    expect(isMissedService(c, "2026-06", v)).toBe(false);
  });
  it("การเข้าที่ผูกไว้แต่อยู่คนละเดือนกับเดือนชดเชย ไม่นับว่าชดเชยแล้ว", () => {
    const v = [routine("2027-02-05", "2026-05")];
    expect(missedResolutionStatus(c, "2026-05", makeup("2026-05", "2027-01"), v, "2027-03")).toBe(
      "makeup_not_done",
    );
  });
  it("การเข้าที่ผูกไว้ต้องเป็นของสัญญาเดียวกัน", () => {
    const v: Visit[] = [{ ...routine("2027-01-12", "2026-05"), contractId: "other" }];
    expect(missedResolutionStatus(c, "2026-05", makeup("2026-05", "2027-01"), v, "2027-02")).toBe(
      "makeup_not_done",
    );
  });
  it("pending ต้องอยู่ในรายการต้องทำ", () => {
    expect(needsDecision("pending")).toBe(true);
  });
});

describe("defaultMakeupMonth", () => {
  it("ค่าเริ่มต้น = เดือนถัดจากเดือนบริการสุดท้าย (ไม่ใช้ end_date)", () => {
    expect(defaultMakeupMonth(c)).toBe("2027-01");
    expect(defaultMakeupMonth({ ...c, startDate: "2026-04-03" })).toBe("2027-04");
    expect(defaultMakeupMonth({ ...c, termYears: 3 })).toBe("2029-01");
  });
});

describe("makeupCountsInSnapshot (กติกาเดียวที่รอเจ้าของยืนยัน)", () => {
  const r = makeup("2026-05", "2027-01");
  it("policy scheduled: เลือกชดเชยไว้ = นับ แม้ไม่มีการเข้า", () => {
    expect(makeupCountsInSnapshot(r, [], "scheduled")).toBe(true);
  });
  it("policy visited: ไม่มีการเข้าที่ผูกไว้ = ไม่นับ", () => {
    expect(makeupCountsInSnapshot(r, [], "visited")).toBe(false);
  });
  it("policy visited: มีการเข้าที่ผูกไว้ในเดือนชดเชย = นับ", () => {
    expect(makeupCountsInSnapshot(r, [routine("2027-01-12", "2026-05")], "visited")).toBe(true);
  });
  it("ไม่ชดเชย ไม่นับทุก policy", () => {
    expect(makeupCountsInSnapshot(waived, [], "scheduled")).toBe(false);
    expect(makeupCountsInSnapshot(waived, [], "visited")).toBe(false);
  });
});
