import { describe, it, expect } from "vitest";
import {
  isRenewed,
  lastServiceMonth,
  linkedMakeupVisit,
  missedMonths,
  missedResolutionStatus,
  needsDecision,
  trackingStartMonth,
} from "./missedResolution";
import { isMissedService } from "./missedService";
import type { Contract, MissedServiceResolution, Visit } from "./types";

// สัญญา 1/1–31/12/2026 บริการเดือนละครั้ง ตั้งสถานีในระบบ ม.ค. 2026 (ตัวอย่างจาก DECISIONS 2.41)
const c: Contract = {
  id: "c1",
  startDate: "2026-01-01",
  termMonths: 12,
  valueTotal: 24000,
  stationsInitializedAt: "2026-01-05",
};

const routine = (date: string, makeupForMonth?: string): Visit => ({
  contractId: "c1",
  visitDate: date,
  visitType: "routine",
  ...(makeupForMonth ? { makeupForMonth } : {}),
});

const madeUp = (missedMonth: string, makeupMonth: string): MissedServiceResolution => ({
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

describe("trackingStartMonth (DECISIONS 2.46: นับตกบริการตั้งแต่เดือนที่ตั้งสถานีในระบบ)", () => {
  it("= เดือนที่ตั้งสถานี · ยังไม่ตั้งสถานี = null", () => {
    expect(trackingStartMonth(c)).toBe("2026-01");
    expect(trackingStartMonth({ ...c, stationsInitializedAt: "2026-03-20" })).toBe("2026-03");
    expect(trackingStartMonth({ ...c, stationsInitializedAt: undefined })).toBeNull();
  });
  it("ตั้งสถานีก่อนเดือนเริ่มสัญญา → ใช้เดือนเริ่มสัญญา", () => {
    expect(trackingStartMonth({ ...c, stationsInitializedAt: "2025-12-28" })).toBe("2026-01");
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
  it("ไม่นับเดือนก่อนตั้งสถานีในระบบ (สัญญาเก่าที่นำเข้าไม่มีประวัติการเข้า)", () => {
    const late = { ...c, stationsInitializedAt: "2026-04-02" };
    const v = ["04", "06"].map((m) => routine(`2026-${m}-10`));
    expect(missedMonths(late, v, "2026-07")).toEqual(["2026-05"]);
  });
  it("ยังไม่ตั้งสถานี → ไม่มีเดือนที่ตก", () => {
    expect(missedMonths({ ...c, stationsInitializedAt: undefined }, [], "2026-07")).toEqual([]);
  });
  it("สัญญายกเลิก → ไม่มีเดือนที่ตก (ปิดเรื่องไม่ได้ จึงไม่แสดง)", () => {
    expect(missedMonths({ ...c, cancelledAt: "2026-09-01" }, [], "2026-07")).toEqual([]);
  });
});

describe("linkedMakeupVisit", () => {
  it("หาการเข้า routine ของสัญญาเดียวกันที่ผูกกับเดือนที่ตก และอยู่หลังเดือนที่ตก", () => {
    const v = routine("2027-01-12", "2026-05");
    expect(linkedMakeupVisit("c1", "2026-05", [routine("2027-01-03"), v])).toBe(v);
  });
  it("สัญญาอื่น / ไม่ใช่ routine / ไม่หลังเดือนที่ตก → ไม่นับ", () => {
    expect(linkedMakeupVisit("c1", "2026-05", [{ ...routine("2027-01-12", "2026-05"), contractId: "x" }])).toBeUndefined();
    expect(
      linkedMakeupVisit("c1", "2026-05", [{ ...routine("2027-01-12", "2026-05"), visitType: "problem" }]),
    ).toBeUndefined();
    expect(linkedMakeupVisit("c1", "2026-05", [routine("2026-05-20", "2026-05")])).toBeUndefined();
  });
});

describe("missedResolutionStatus (DECISIONS 2.45)", () => {
  it("ไม่มีการตัดสิน ไม่มีการเข้าชดเชย → pending (รอตัดสิน) · อยู่ในรายการต้องทำ", () => {
    const s = missedResolutionStatus(c, "2026-05", undefined, []);
    expect(s).toBe("pending");
    expect(needsDecision(s)).toBe(true);
  });
  it("ไม่ชดเชย → waived · ไม่ค้างในรายการต้องทำ", () => {
    const s = missedResolutionStatus(c, "2026-05", waived, []);
    expect(s).toBe("waived");
    expect(needsDecision(s)).toBe(false);
  });
  it("มีการเข้าชดเชยที่ผูกไว้ (เดือนไหนก็ได้หลังเดือนที่ตก) → made_up (ชดเชยแล้ว)", () => {
    const v = [routine("2027-01-12", "2026-05")];
    const s = missedResolutionStatus(c, "2026-05", madeUp("2026-05", "2027-01"), v);
    expect(s).toBe("made_up");
    expect(needsDecision(s)).toBe(false);
  });
  it("ชดเชยแล้วนับจากการเข้าจริง แม้หน้าจอยังไม่ได้โหลดแถวการตัดสิน", () => {
    expect(missedResolutionStatus(c, "2026-05", undefined, [routine("2026-09-12", "2026-05")])).toBe(
      "made_up",
    );
  });
  it("แถว makeup ค้างแต่ไม่มีการเข้าที่ผูก (เลิกผูก/ลบการเข้าแล้ว) → กลับเป็น pending", () => {
    expect(missedResolutionStatus(c, "2026-05", madeUp("2026-05", "2027-01"), [])).toBe("pending");
  });
  it("ตก พ.ค. ชดเชย มิ.ย. มี 2 ครั้ง (ผูก 1) → made_up และ มิ.ย. ไม่ตก", () => {
    const v = [routine("2026-06-03"), routine("2026-06-20", "2026-05")];
    expect(missedResolutionStatus(c, "2026-05", undefined, v)).toBe("made_up");
    expect(isMissedService(c, "2026-06", v)).toBe(false);
  });
  it("การตัดสินของเดือน/สัญญาอื่นไม่มีผล", () => {
    expect(missedResolutionStatus(c, "2026-05", { ...waived, missedMonth: "2026-06" }, [])).toBe("pending");
    expect(missedResolutionStatus(c, "2026-05", { ...waived, contractId: "x" }, [])).toBe("pending");
  });
});

describe("lastServiceMonth", () => {
  it("เดือนบริการสุดท้าย = เดือนเริ่ม + ปี×12 − 1 (ไม่ใช้ end_date)", () => {
    expect(lastServiceMonth(c)).toBe("2026-12");
    expect(lastServiceMonth({ ...c, startDate: "2026-04-03" })).toBe("2027-03");
    expect(lastServiceMonth({ ...c, termMonths: 36 })).toBe("2028-12");
  });
});

describe("ต่อสัญญาแล้ว → ตกบริการที่ค้างเป็นโมฆะ (DECISIONS 2.47)", () => {
  const renewal: Contract = { id: "c2", startDate: "2027-01-01", termMonths: 12, valueTotal: 24000, renewedFromContractId: "c1" };
  it("isRenewed = มีสัญญาอื่นที่ renewedFromContractId = สัญญานี้", () => {
    expect(isRenewed(c, [c, renewal])).toBe(true);
    expect(isRenewed(renewal, [c, renewal])).toBe(false);
    expect(isRenewed(c, [c])).toBe(false);
  });
  it("รอตัดสิน + ต่อสัญญาแล้ว → void_renewed (ไม่อยู่ในรายการต้องทำ)", () => {
    const s = missedResolutionStatus(c, "2026-05", undefined, [], true);
    expect(s).toBe("void_renewed");
    expect(needsDecision(s)).toBe(false);
  });
  it("ชดเชยไปแล้วก่อนต่อสัญญา → คง made_up", () => {
    expect(missedResolutionStatus(c, "2026-05", undefined, [routine("2026-09-12", "2026-05")], true)).toBe("made_up");
  });
  it("สัญญาใหม่ (ที่ต่อมา) ถูกยกเลิก → ไม่นับว่าต่อแล้ว → กลับเป็นรอตัดสิน (DECISIONS 2.48)", () => {
    const cancelledRenewal = { ...renewal, cancelledAt: "2027-02-10" };
    expect(isRenewed(c, [c, cancelledRenewal])).toBe(false);
    expect(isRenewed(c, [c, cancelledRenewal, { ...renewal, id: "c3" }])).toBe(true);
    const renewed = isRenewed(c, [c, cancelledRenewal]);
    expect(missedResolutionStatus(c, "2026-05", undefined, [], renewed)).toBe("pending");
  });
  it("ไม่ชดเชยไปแล้วก่อนต่อสัญญา → คง waived", () => {
    expect(missedResolutionStatus(c, "2026-05", waived, [], true)).toBe("waived");
  });
});

describe("normalise เดือนจาก DB (L2)", () => {
  it("makeupForMonth / missedMonth แบบ 'YYYY-MM-01' ใช้ได้", () => {
    const v = [routine("2027-01-12", "2026-05-01")];
    expect(linkedMakeupVisit("c1", "2026-05-01", v)).toBe(v[0]);
    expect(missedResolutionStatus(c, "2026-05", { ...waived, missedMonth: "2026-05-01" }, [])).toBe("waived");
    expect(missedResolutionStatus(c, "2026-05-01", undefined, v)).toBe("made_up");
  });
  it("stationsInitializedAt แบบ timestamptz → เดือนตามเวลาไทย", () => {
    expect(trackingStartMonth({ ...c, stationsInitializedAt: "2026-03-31T18:00:00Z" })).toBe("2026-04");
    expect(trackingStartMonth({ ...c, stationsInitializedAt: "2026-03-31T16:00:00+00:00" })).toBe("2026-03");
  });
});

describe("M30 — ตกบริการของสัญญาสั้น (ข้อ 7)", () => {
  const short: Contract = {
    id: "c1",
    startDate: "2026-01-15",
    termMonths: 5,
    valueTotal: 20000,
    stationsInitializedAt: "2026-01-20",
  };
  it("เดือนบริการ = 5 เดือนจริง · เดือนบริการสุดท้าย = พ.ค. 2026", () => {
    expect(lastServiceMonth(short)).toBe("2026-05");
    expect(missedMonths(short, [routine("2026-02-10")], "2026-09")).toEqual([
      "2026-01", "2026-03", "2026-04", "2026-05",
    ]);
  });
  it("หลังสัญญาจบ (มิ.ย.) ไม่นับตกบริการ", () => {
    expect(isMissedService(short, "2026-06", [])).toBe(false);
    expect(isMissedService(short, "2026-05", [])).toBe(true);
  });
  it("ข้อ 5: 12 เดือน ≡ 1 ปีเดิม (เดือนบริการสุดท้าย ธ.ค.)", () => {
    expect(lastServiceMonth({ ...short, startDate: "2026-01-01", termMonths: 12 })).toBe("2026-12");
    expect(lastServiceMonth({ ...short, startDate: "2026-01-01", termMonths: 36 })).toBe("2028-12");
  });
});
