/**
 * เทส M30 ฝั่งหน้าเปิดงาน: ระยะสัญญาเป็นเดือน (12 = 1 ปี · 36 = 3 ปี · อื่น = Custom)
 * ครอบคลุม: เดือนบริการ/วันสิ้นสุด/Tier ของ Custom · 12 ≡ 1 ปี · 36 ≡ 3 ปี · Renew gap กับสัญญาเก่า Custom ·
 * แถวแก้ของสัญญา Custom ไม่ถูกเปลี่ยนเป็น 12 · payload ส่ง p_term_months · ข้อความ AG016/AG017
 */
import { describe, expect, it } from "vitest";

import { TIER_RULES } from "@/lib/rules/__fixtures__/tierRules";
import { termMonthsOf } from "@/lib/service/termMonths";

import type { BranchOption } from "./branchMatch";
import { applyDraftPatch, canSave, checkDraft, createDraft } from "./draftRow";
import { draftFromSaved, isEditUnchanged } from "./editRow";
import { describeDbError } from "./errors";
import { renewGapBlockReason } from "./renewRules";
import { autoEndDate, endDateWarning, monthsOf, tierFor } from "./rowCalc";
import { buildSaveParams } from "./savePayload";
import type { RenewalLink, SavedContract } from "./types";

const branches: BranchOption[] = [{ id: "b1", name: "นครปฐม", zoneId: "z1", zoneName: "เขต 1" }];

describe("ระยะ Custom — เดือนบริการ / วันสิ้นสุด / Tier", () => {
  it("15/01/2026 + 5 เดือน → บริการ ม.ค.–พ.ค. 2026 · จบ 14/06/2026", () => {
    expect(monthsOf("2026-01-15", 5)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
    expect(autoEndDate("2026-01-15", 5)).toBe("2026-06-14");
  });
  it("50,000 / 5 เดือน → L1 (มูลค่าจริง ไม่ขยายเป็นต่อปี) · key ใช้กลุ่มสี 1 ปี", () => {
    const t = tierFor(50000, 5, TIER_RULES);
    expect(t?.label).toBe("L1");
    expect(t?.key).toBe("l1");
    expect(t?.annual).toBe(50000);
  });
  it("12 เดือน ≡ 1 ปี · 36 เดือน ≡ 3 ปี", () => {
    expect(tierFor(150000, 12, TIER_RULES)?.label).toBe("XL1");
    expect(tierFor(150000, 36, TIER_RULES)?.label).toBe("L3");
    expect(autoEndDate("2026-01-01", 36)).toBe("2028-12-31");
    expect(monthsOf("2026-01-01", 36)).toHaveLength(36);
  });
  it("31 ม.ค. + 1 เดือน → จบ 28 ก.พ. (ตัดที่วันสุดท้ายของเดือน)", () => {
    expect(autoEndDate("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("ระยะไม่ถูกต้อง (0 / 37 / ทศนิยม) → null/ว่าง ไม่ throw", () => {
    expect(tierFor(50000, 0, TIER_RULES)).toBeNull();
    expect(tierFor(50000, 37, TIER_RULES)).toBeNull();
    expect(autoEndDate("2026-01-15", 2.5)).toBeNull();
    expect(monthsOf("2026-01-15", 99)).toEqual([]);
  });
  it("คำเตือนวันสิ้นสุดของ Custom ตามสูตรเดือน", () => {
    expect(endDateWarning("2026-01-15", "2026-06-14", 5)).toBeNull();
    expect(endDateWarning("2026-01-15", "2026-07-14", 5)).toMatch(/^ระยะ \d+ วัน$/);
  });
});

describe("แถวร่างที่เป็น Custom", () => {
  const base = {
    ...createDraft(),
    contractNo: "CT26-0000001",
    customerName: "บจก. ตัวอย่าง",
    saleName: "พนักงานขาย",
    branchText: "นครปฐม",
    startDate: "2026-01-15",
    value1y: "50,000.00",
  };
  it("ช่อง 1 ปี = 12 · ช่อง 3 ปี = 36 · Custom ใช้จำนวนเดือนที่กำหนด (มูลค่าอยู่ช่อง 1 ปี)", () => {
    expect(checkDraft(base, branches, undefined).termMonths).toBe(12);
    expect(checkDraft({ ...base, value1y: "", value3y: "150,000" }, branches, undefined).termMonths).toBe(36);
    const c = checkDraft({ ...base, customTermMonths: 5 }, branches, undefined);
    expect(c.termMonths).toBe(5);
    expect(c.valueTotal).toBe(50000);
  });
  it("วันสิ้นสุดเติมอัตโนมัติตามจำนวนเดือน Custom", () => {
    expect(applyDraftPatch({ ...base, customTermMonths: 5 }, {}).endDate).toBe("2026-06-14");
  });
  it("Custom ที่เป็น 12 / 36 / 0 / 40 = ผิด (บล็อกการบันทึก)", () => {
    for (const bad of [12, 36, 0, 40]) {
      const c = checkDraft({ ...base, customTermMonths: bad }, branches, undefined);
      expect(canSave(c)).toBe(false);
      expect(c.errors.value).toMatch(/Custom/);
      expect(c.termMonths).toBeNull();
    }
  });
  it("payload ส่ง p_term_months (ไม่ส่ง p_term_years)", () => {
    const c = checkDraft({ ...base, customTermMonths: 5 }, branches, undefined);
    const p = buildSaveParams(base, {
      branchId: "b1",
      termMonths: c.termMonths as number,
      valueTotal: 50000,
      endDate: c.endDate,
    });
    expect(p.p_term_months).toBe(5);
    expect("p_term_years" in p).toBe(false);
    const p36 = buildSaveParams(base, { branchId: "b1", termMonths: 36, valueTotal: 1, endDate: null });
    expect(p36.p_term_months).toBe(36);
  });
});

function saved(over: Partial<SavedContract> = {}): SavedContract {
  return {
    contractId: "c1",
    customerId: "u1",
    customerName: "บจก. ตัวอย่าง",
    branchId: "b1",
    contractNo: "CT26-0000001",
    saleType: "new",
    status: "active",
    sellerName: "ขาย",
    sellerRole: "sale",
    isUrgent: false,
    renewedFrom: null,
    renewUnlinkedReason: null,
    mailReceivedDate: "",
    firstServiceDate: "",
    firstServiceTime: "",
    note: "",
    startDate: "2026-01-15",
    endDate: "2026-06-14",
    termMonths: 5,
    valueTotal: 50000,
    teamIds: [],
    updatedAt: "2026-01-01T00:00:00Z",
    files: [],
    auditCount: null,
    auditCountFailed: false,
    customerTypeCode: null,
    ...over,
  } as SavedContract;
}

describe("แก้สัญญา Custom ที่บันทึกแล้ว (กันระยะถูกเปลี่ยนเป็น 12 เงียบๆ · AG017)", () => {
  it("คงจำนวนเดือนเดิม + มูลค่าอยู่ช่อง 1 ปี + ตรวจแล้วระยะยังเป็น 5", () => {
    const d = draftFromSaved(saved(), { branches });
    expect(d.customTermMonths).toBe(5);
    expect(d.value1y).toBe("50,000.00");
    expect(d.endTouched).toBe(false); // ตรงสูตร 5 เดือน → คำนวณใหม่ตามวันเริ่มได้
    const c = checkDraft(d, branches, undefined);
    expect(c.termMonths).toBe(5);
    const p = buildSaveParams(d, { branchId: "b1", termMonths: 5, valueTotal: 50000, endDate: c.endDate }, {
      contractId: "c1",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });
    expect(p.p_term_months).toBe(5);
  });
  it("สัญญา 12/36 เดือนไม่มี customTermMonths", () => {
    expect(draftFromSaved(saved({ termMonths: 12, endDate: "2027-01-14" }), { branches }).customTermMonths).toBeNull();
    const d36 = draftFromSaved(saved({ termMonths: 36, endDate: "2028-12-31" }), { branches });
    expect(d36.customTermMonths).toBeNull();
    expect(d36.value3y).toBe("50,000.00");
  });
  it("เปลี่ยนจำนวนเดือนนับเป็นการแก้ (ปุ่มบันทึกเปิด)", () => {
    const d = draftFromSaved(saved(), { branches });
    expect(isEditUnchanged(d, { ...d, customTermMonths: 6 })).toBe(false);
  });
});

describe("Renew gap กับสัญญาเก่าที่เป็น Custom (นับจากเดือนจริง ไม่ใช่ 12)", () => {
  // 15/01/2026 + 5 เดือน (ไม่มี end_date) → จบ 14/06/2026 → Renew ได้ถึง ส.ค. 2026
  const link: RenewalLink = {
    contractId: "o",
    contractNo: "OLD",
    customerId: "u",
    customerName: "x",
    branchId: "b1",
    oldDates: { startDate: "2026-01-15", termMonths: 5 },
  };
  it("เริ่ม 31/08/2026 = Renew ได้ · 01/09/2026 = เกินช่วง", () => {
    expect(renewGapBlockReason(link, "2026-08-31")).toBeNull();
    expect(renewGapBlockReason(link, "2026-09-01")).toMatch(/สิงหาคม 2026/);
  });
  it("ถ้าคิดผิดเป็น 12 เดือน เดือน ก.ย. 2026 จะผ่าน — ของจริงต้องไม่ผ่าน", () => {
    const as12: RenewalLink = { ...link, oldDates: { startDate: "2026-01-15", termMonths: 12 } };
    expect(renewGapBlockReason(as12, "2026-09-01")).toBeNull();
    expect(renewGapBlockReason(link, "2026-09-01")).not.toBeNull();
  });
  it("มี end_date จริง → ใช้ end_date", () => {
    const withEnd: RenewalLink = { ...link, oldDates: { startDate: "2026-01-15", endDate: "2026-07-31", termMonths: 5 } };
    expect(renewGapBlockReason(withEnd, "2026-09-30")).toBeNull();
    expect(renewGapBlockReason(withEnd, "2026-10-01")).not.toBeNull();
  });
});

describe("อ่าน term_months จากฐานข้อมูล", () => {
  it("ค่าถูกต้องผ่าน · ผิดรูปแบบ throw (ไม่ fallback เป็น 12)", () => {
    expect(termMonthsOf(5)).toBe(5);
    expect(termMonthsOf("36")).toBe(36);
    for (const bad of [null, undefined, 0, 37, 2.5, "x"]) {
      expect(() => termMonthsOf(bad)).toThrow();
    }
  });
});

describe("ข้อความ error M30", () => {
  it("AG016 / AG017 เป็นข้อความไทย (ไม่โชว์ข้อความดิบของ DB)", () => {
    for (const code of ["AG016", "AG017"]) {
      const msg = describeDbError({ code, message: "raw db message" });
      expect(msg).toMatch(/ระยะ/);
      expect(msg).not.toMatch(/raw db message/);
    }
  });
});
