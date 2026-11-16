/**
 * เทสกฎ Renew ของหน้าเปิดงาน (M28 · DECISIONS 2.51)
 * ครอบคลุม: ช่วง/เลยช่วง 2 เดือน · Renew ไม่ผูก (เหตุผล/ช่วงเปิด) · พารามิเตอร์ RPC · ข้อความ AG010–AG014 · AG009 ยังเหมือนเดิม
 */
import { describe, expect, it } from "vitest";

import type { BranchOption } from "./branchMatch";
import { canSave, checkDraft, createDraft } from "./draftRow";
import { draftFromSaved } from "./editRow";
import { describeDbError } from "./errors";
import { checkRenewDraft, parseRenewPolicy, renewGapBlockReason } from "./renewRules";
import { buildSaveParams } from "./savePayload";
import type { DraftRow, RenewalLink, RenewPolicy, SavedContract } from "./types";

const branches: BranchOption[] = [{ id: "b1", name: "นครปฐม", zoneId: "z1", zoneName: "เขต 1" }];
const OPEN: RenewPolicy = { unlinkedOpen: true, unlinkedUntil: "2027-04-01" };
const CLOSED: RenewPolicy = { unlinkedOpen: false, unlinkedUntil: "2027-04-01" };

/** สัญญาเก่า 1 ปี: 15/01/2026 → จบ 14/01/2027 → Renew ได้ถึง มี.ค. 2027 (เดือนจบ + 2) */
const oldLink: RenewalLink = {
  contractId: "old-c",
  contractNo: "OLD-1",
  customerId: "old-u",
  customerName: "บจก. เดิม",
  branchId: "b1",
  oldDates: { startDate: "2026-01-15", termYears: 1 },
};

function renewDraft(over: Partial<DraftRow> = {}): DraftRow {
  return {
    ...createDraft(),
    contractNo: "CT27-0000001",
    customerName: "บจก. เดิม",
    saleName: "ขาย",
    branchText: "นครปฐม",
    startDate: "2027-03-01",
    endDate: "2028-02-29",
    value1y: "50,000.00",
    saleType: "renew",
    ...over,
  };
}

describe("Renew ผูกสัญญาเก่า — กฎช่องว่าง 2 เดือน", () => {
  it("อยู่ในช่วง (เดือนจบ + 2 = มี.ค. 2027) → ผ่าน", () => {
    expect(renewGapBlockReason(oldLink, "2027-03-31")).toBeNull();
    const c = checkDraft(renewDraft({ renewal: oldLink, startDate: "2027-03-01" }), branches, undefined, {
      policy: OPEN,
    });
    expect(c.errors.renewLink).toBeUndefined();
    expect(canSave(c)).toBe(true);
  });

  it("เลยช่วง (เม.ย. 2027) → ล็อก: บอกเดือนสุดท้ายที่ Renew ได้ + ให้เปิดเป็น New · บันทึกไม่ได้", () => {
    const reason = renewGapBlockReason(oldLink, "2027-04-01");
    expect(reason).toContain("มีนาคม 2027");
    expect(reason).toContain("New");
    const c = checkDraft(renewDraft({ renewal: oldLink, startDate: "2027-04-01" }), branches, undefined, {
      policy: OPEN,
    });
    expect(c.errors.renewLink).toBe(reason);
    expect(canSave(c)).toBe(false);
  });

  it("เริ่มก่อน/วันเดียวกับวันเริ่มสัญญาเก่า → ไม่ผ่าน (ข้อความคนละแบบ)", () => {
    expect(renewGapBlockReason(oldLink, "2026-01-15")).toContain("หลังวันเริ่มสัญญาเก่า");
  });

  it("ไม่มีวันที่สัญญาเก่า หรือยังไม่ใส่วันเริ่ม → ไม่ตัดสิน (ปล่อยให้ DB ตรวจ AG010)", () => {
    expect(renewGapBlockReason({ ...oldLink, oldDates: undefined }, "2030-01-01")).toBeNull();
    expect(renewGapBlockReason(oldLink, "")).toBeNull();
  });
});

describe("Renew ไม่ผูกสัญญาเก่า — เหตุผล + ช่วงเปิด", () => {
  it("ช่วงเปิด + ไม่มีเหตุผล → บันทึกไม่ได้ (ว่าง/เว้นวรรคล้วนก็ไม่ผ่าน)", () => {
    for (const reason of ["", "   "]) {
      const c = checkDraft(renewDraft({ renewUnlinkedReason: reason }), branches, undefined, { policy: OPEN });
      expect(c.errors.renewReason).toBeTruthy();
      expect(canSave(c)).toBe(false);
    }
  });

  it("ช่วงเปิด + มีเหตุผล → บันทึกได้ · ส่ง p_renew_unlinked_reason (ตัดช่องว่าง) และ renewed_from = null", () => {
    const d = renewDraft({ renewUnlinkedReason: "  สัญญาเก่าไม่อยู่ในระบบ " });
    expect(canSave(checkDraft(d, branches, undefined, { policy: OPEN }))).toBe(true);
    const p = buildSaveParams(d, { branchId: "b1", termYears: 1, valueTotal: 50000, endDate: "2028-02-29" });
    expect(p.p_renew_unlinked_reason).toBe("สัญญาเก่าไม่อยู่ในระบบ");
    expect(p.p_renewed_from_contract_id).toBeNull();
    expect(p.p_sale_type).toBe("renew");
  });

  it("พ้นช่วงเปิด (unlinked_renew_open = false) → ต้องผูกสัญญาเก่า แม้มีเหตุผล", () => {
    const c = checkDraft(renewDraft({ renewUnlinkedReason: "เหตุผล" }), branches, undefined, { policy: CLOSED });
    expect(c.errors.renewLink).toContain("ต้องผูกสัญญาเก่า");
    expect(canSave(c)).toBe(false);
  });

  it("New / Renew ที่ผูกแล้ว ไม่ส่งเหตุผล (แม้ค้างค่าในแถวร่าง)", () => {
    const v = { branchId: "b1", termYears: 1 as const, valueTotal: 50000, endDate: null };
    const asNew = renewDraft({ saleType: "new", renewUnlinkedReason: "ค้างอยู่" });
    expect("p_renew_unlinked_reason" in buildSaveParams(asNew, v)).toBe(false);
    const linked = renewDraft({ renewal: oldLink, renewUnlinkedReason: "ค้างอยู่" });
    const p = buildSaveParams(linked, v);
    expect("p_renew_unlinked_reason" in p).toBe(false);
    expect(p.p_renewed_from_contract_id).toBe("old-c");
  });

  it("New ไม่ถูกตรวจกฎ Renew เลย", () => {
    expect(checkRenewDraft(renewDraft({ saleType: "new" }), CLOSED, false)).toEqual({});
  });
});

describe("parseRenewPolicy — อ่านผล RPC (fail-closed)", () => {
  it("true + วันกำหนด → เปิด", () => {
    expect(parseRenewPolicy({ data: true, error: null }, { data: "2027-04-01", error: null })).toEqual(OPEN);
  });
  it("false → ปิด · error/รูปแบบแปลก → ปิด ไม่ล้มทั้งหน้า", () => {
    expect(parseRenewPolicy({ data: false, error: null }, { data: "2027-04-01", error: null }).unlinkedOpen).toBe(
      false,
    );
    expect(parseRenewPolicy({ data: true, error: { code: "42883" } }, { data: null, error: {} })).toEqual({
      unlinkedOpen: false,
      unlinkedUntil: null,
    });
    expect(parseRenewPolicy({ data: "true", error: null }, { data: 5, error: null })).toEqual({
      unlinkedOpen: false,
      unlinkedUntil: null,
    });
  });
});

describe("ข้อความ error ภาษาไทย AG010–AG014", () => {
  it("AG010 เกินช่วง: ใส่เดือนจาก DETAIL (2027-03 → มีนาคม 2027)", () => {
    const m = describeDbError({
      code: "AG010",
      message: "a renewal must start within 2 months after the old contract ends; open it as New",
      details: "2027-03",
    });
    expect(m).toContain("มีนาคม 2027");
    expect(m).toContain("New");
  });
  it("AG010 เริ่มไม่หลังสัญญาเก่า → ข้อความเฉพาะ (ไม่ต้องมีเดือน)", () => {
    const m = describeDbError({
      code: "AG010",
      message: "a renewal must start after the old contract starts",
      details: "2027-03",
    });
    expect(m).toContain("หลังวันเริ่มสัญญาเก่า");
    expect(m).not.toContain("มีนาคม");
  });
  it("AG010 แก้วันของสัญญาเก่า → ข้อความเฉพาะ + เดือนจาก DETAIL", () => {
    const m = describeDbError({
      code: "AG010",
      message: "this change would put a linked renewal outside the 2-month window",
      details: "2027-02",
    });
    expect(m).toContain("กุมภาพันธ์ 2027");
    expect(m).toContain("แก้วันที่ของสัญญานี้ไม่ได้");
  });
  it("AG010 DETAIL ว่าง/แปลก → ข้อความทั่วไป ไม่เดาเดือน", () => {
    const m = describeDbError({ code: "AG010", message: "a renewal must start within 2 months", details: null });
    expect(m).toContain("2 เดือน");
    expect(m).not.toMatch(/undefined|null|NaN/);
  });
  it("AG011 / AG012 / AG014 อ่านง่าย", () => {
    expect(describeDbError({ code: "AG011" })).toContain("Renew");
    expect(describeDbError({ code: "AG012" })).toContain("เหตุผล");
    expect(describeDbError({ code: "AG014" })).toContain("ยังไม่ได้ผูก");
  });
  it("AG013: ใส่วันจาก DETAIL (2027-04-01 → 1 เมษายน 2027)", () => {
    expect(describeDbError({ code: "AG013", details: "2027-04-01" })).toContain("1 เมษายน 2027");
    expect(describeDbError({ code: "AG013", details: "x" })).toContain("ผูกสัญญาเก่า");
  });
});

describe("แก้แถวเดิม — AG009 ต้องยังทำงานเหมือนเดิม + เหตุผลเดิมไม่หาย", () => {
  const EXPECTED = "2026-11-12T10:00:00.123456+00:00";
  const values = { branchId: "b1", termYears: 1 as const, valueTotal: 50000, endDate: "2028-02-29" };
  function saved(over: Partial<SavedContract> = {}): SavedContract {
    return {
      contractId: "c1",
      customerId: "u1",
      contractNo: "CT27-0000001",
      customerName: "บจก. เดิม",
      customerTypeCode: "B",
      branchId: "b1",
      saleType: "renew",
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
      startDate: "2027-03-01",
      endDate: "2028-02-29",
      termYears: 1,
      valueTotal: 50000,
      teamIds: [],
      files: [],
      auditCount: null,
      updatedAt: EXPECTED,
      auditCountFailed: false,
      ...over,
    };
  }

  it("Renew ไม่ผูกที่มีเหตุผลเดิม: แก้แล้วส่งเหตุผลเดิมกลับ (ไม่งั้น DB ตอบ AG012) · renewed_from ยังเป็น null", () => {
    const d = draftFromSaved(saved({ renewUnlinkedReason: "สัญญาเก่าไม่อยู่ในระบบ" }), { branches });
    const p = buildSaveParams(d, values, {
      contractId: "c1",
      expectedUpdatedAt: EXPECTED,
      renewedFromContractId: null,
    });
    expect(p.p_renew_unlinked_reason).toBe("สัญญาเก่าไม่อยู่ในระบบ");
    expect(p.p_renewed_from_contract_id).toBeNull();
    expect(p.p_contract_id).toBe("c1");
  });

  it("แถวเก่าที่ไม่มีเหตุผล: แก้ได้ ไม่บล็อกฝั่งหน้าจอ และไม่ส่งเหตุผล (DB ยอมให้ผ่าน)", () => {
    const d = draftFromSaved(saved(), { branches });
    expect(canSave(checkDraft(d, branches, undefined, { policy: CLOSED, isEdit: true }))).toBe(true);
    const p = buildSaveParams(d, values, {
      contractId: "c1",
      expectedUpdatedAt: EXPECTED,
      renewedFromContractId: null,
    });
    expect("p_renew_unlinked_reason" in p).toBe(false);
  });

  it("พ้นช่วงเปิดแล้ว แถวเดิมที่เปิดไว้ก่อนหน้าแก้ช่องอื่นต่อได้ (ไม่ตรวจกฎเปิดใหม่ซ้ำ)", () => {
    const d = draftFromSaved(saved({ renewUnlinkedReason: "เหตุผล" }), { branches });
    expect(checkDraft(d, branches, undefined, { policy: CLOSED, isEdit: true }).errors.renewLink).toBeUndefined();
  });

  it("AG009: Renew ที่ผูกแล้ว แก้แล้วส่ง renewed_from เดิมเสมอ แม้แถวร่างถูกล้างลิงก์ และไม่ส่งเหตุผล", () => {
    const d = draftFromSaved(saved({ renewedFrom: { contractId: "old-c", contractNo: "OLD-1" } }), { branches });
    const cleared: DraftRow = { ...d, renewal: null, saleType: "new" };
    const p = buildSaveParams(cleared, values, {
      contractId: "c1",
      expectedUpdatedAt: EXPECTED,
      renewedFromContractId: "old-c",
    });
    expect(p.p_renewed_from_contract_id).toBe("old-c");
    expect("p_renew_unlinked_reason" in p).toBe(false);
  });

  it("AG009: ข้อความเดิมยังอยู่", () => {
    expect(describeDbError({ code: "AG009" })).toContain("ต่อมาจากสัญญาไหน");
  });
});
