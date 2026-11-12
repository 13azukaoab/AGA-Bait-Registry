/**
 * เทสรอบ 1.3 ของหน้า /customers/new — แก้แถวที่บันทึกแล้ว
 * ใช้ Supabase client ปลอม (ไม่แตะฐานข้อมูลจริง) · ของจริงทดสอบกับ DB local ตามรายงานของ sub session
 */
import { describe, expect, it } from "vitest";

import type { BranchOption } from "./branchMatch";
import { applyDraftPatch, canSave, checkDraft } from "./draftRow";
import {
  EDIT_LOCK_REASONS,
  checkRenewalPickForEdit,
  contractEditBlockReason,
  contractFileBlockReason,
  draftFromSaved,
  isEditUnchanged,
  monthOfDate,
} from "./editRow";
import { describeDbError } from "./errors";
import { saveDraft } from "./save";
import { buildSaveParams, parseSaveRow } from "./savePayload";
import { tierFor } from "./rowCalc";
import type { SavedContract } from "./types";

const EXPECTED = "2026-11-12T10:00:00.123456+00:00";
const NEWER = "2026-11-12T10:05:00.654321+00:00";

const branches: BranchOption[] = [{ id: "b1", name: "นครปฐม", zoneId: "z1", zoneName: "เขต 1" }];
const master = { branches };
const rules = [
  { tier: "S", minAnnual: 0 },
  { tier: "M", minAnnual: 30000 },
  { tier: "L", minAnnual: 100000 },
  { tier: "XL", minAnnual: 150000 },
] as const;

function saved(over: Partial<SavedContract> = {}): SavedContract {
  return {
    contractId: "c1",
    customerId: "u1",
    contractNo: "CT26-0000001",
    customerName: "บจก. ตัวอย่าง",
    customerTypeCode: "B",
    branchId: "b1",
    saleType: "new",
    status: "active",
    sellerName: "พนักงานขาย",
    sellerRole: "sale",
    isUrgent: false,
    renewedFrom: null,
    mailReceivedDate: "2026-10-01",
    firstServiceDate: "2026-10-10",
    firstServiceTime: "09:30",
    note: "หมายเหตุ",
    startDate: "2026-10-01",
    endDate: "2027-09-30",
    termYears: 1,
    valueTotal: 99510,
    teamIds: ["t2", "t1"],
    files: [],
    auditCount: 1,
    updatedAt: "2026-11-12T10:00:00.123456+00:00",
    auditCountFailed: false,
    ...over,
  };
}

describe("draftFromSaved — สัญญาที่บันทึกแล้ว → แถวสำหรับแก้", () => {
  it("คัดลอกทุกช่องตามที่เห็นในตาราง · มูลค่า 1 ปีลงช่อง 1 ปี", () => {
    const d = draftFromSaved(saved(), master);
    expect(d).toMatchObject({
      contractNo: "CT26-0000001",
      customerName: "บจก. ตัวอย่าง",
      branchText: "นครปฐม",
      customerTypeCode: "B",
      saleName: "พนักงานขาย",
      sellerRole: "sale",
      mailReceivedDate: "2026-10-01",
      firstServiceDate: "2026-10-10",
      firstServiceTime: "09:30",
      note: "หมายเหตุ",
      value1y: "99,510.00",
      value3y: "",
      teamIds: ["t2", "t1"],
      saveError: null,
      pendingPdf: null,
    });
  });
  it("มูลค่า 3 ปีลงช่อง 3 ปี · ตำแหน่ง AM คงไว้", () => {
    const d = draftFromSaved(saved({ termYears: 3, valueTotal: 300000, sellerRole: "am" }), master);
    expect(d).toMatchObject({ value1y: "", value3y: "300,000.00", sellerRole: "am" });
  });
  it("ไม่แชร์อาร์เรย์ทีมกับต้นฉบับ (แก้ร่างแล้วต้นฉบับไม่เปลี่ยน)", () => {
    const s = saved();
    const d = draftFromSaved(s, master);
    d.teamIds.push("t9");
    expect(s.teamIds).toEqual(["t2", "t1"]);
  });
  it("Renew: ผูกสัญญาเก่าเป็นลูกค้าเดียวกับสัญญานี้ · เลขสัญญาเก่าอ่านไม่ได้ = ว่างแต่ยังผูก", () => {
    const d = draftFromSaved(
      saved({ saleType: "renew", renewedFrom: { contractId: "old", contractNo: null } }),
      master,
    );
    expect(d.renewal).toMatchObject({ contractId: "old", contractNo: "", customerId: "u1" });
  });
  it("วันสิ้นสุดตรงสูตร → คำนวณใหม่ตามวันเริ่ม (endTouched=false) · ต่างจากสูตร → คงค่าเดิม", () => {
    expect(draftFromSaved(saved(), master).endTouched).toBe(false);
    expect(draftFromSaved(saved({ endDate: "2027-12-31" }), master).endTouched).toBe(true);
    expect(draftFromSaved(saved({ endDate: "" }), master).endTouched).toBe(false);
  });
  it("แถวที่โหลดมาผ่านตัวตรวจแบบเดียวกับแถวใหม่", () => {
    const c = checkDraft(draftFromSaved(saved(), master), branches, undefined);
    expect(canSave(c)).toBe(true);
    expect(c.branch?.id).toBe("b1");
    expect(c.termYears).toBe(1);
    expect(c.valueTotal).toBe(99510);
  });
  it("สัญญาเก่าที่ไม่มีผู้ขาย: ตัวตรวจบังคับใส่ผู้ขายก่อนบันทึก (เหมือนแถวใหม่)", () => {
    const d = draftFromSaved(saved({ sellerName: "" }), master);
    expect(checkDraft(d, branches, undefined).errors.saleName).toBeTruthy();
  });
});

describe("แก้แล้ว Tier / วันสิ้นสุดคำนวณใหม่", () => {
  it("เปลี่ยนมูลค่า → Tier เปลี่ยน (เกณฑ์จาก tier_rules ที่ส่งเข้ามา)", () => {
    const d0 = draftFromSaved(saved(), master);
    const before = checkDraft(d0, branches, undefined);
    expect(tierFor(before.valueTotal, before.termYears, [...rules])?.label).toBe("M1");
    const d1 = applyDraftPatch(d0, { value1y: "160,000.00" });
    const after = checkDraft(d1, branches, undefined);
    expect(tierFor(after.valueTotal, after.termYears, [...rules])?.label).toBe("XL1");
  });
  it("เปลี่ยนวันเริ่ม/ระยะ → วันสิ้นสุดตามสูตรใหม่ (เมื่อไม่ได้ตั้งเอง)", () => {
    const d0 = draftFromSaved(saved(), master);
    const d1 = applyDraftPatch(d0, { startDate: "2026-11-15" });
    expect(d1.endDate).toBe("2027-11-14");
    const d3 = applyDraftPatch(d1, { value1y: "", value3y: "300,000.00" });
    expect(d3.endDate).toBe("2029-11-14");
  });
  it("วันสิ้นสุดที่ตั้งเอง ไม่ถูกเขียนทับ", () => {
    const d0 = draftFromSaved(saved({ endDate: "2027-12-31" }), master);
    expect(applyDraftPatch(d0, { startDate: "2026-11-15" }).endDate).toBe("2027-12-31");
  });
  it("แก้แล้วล้างข้อความผิดพลาดของรอบก่อน", () => {
    const d0 = { ...draftFromSaved(saved(), master), saveError: "เก่า" };
    expect(applyDraftPatch(d0, { note: "x" }).saveError).toBeNull();
  });
});

describe("isEditUnchanged", () => {
  it("ยังไม่แก้ = ไม่เปลี่ยน · ลำดับทีม/ช่องว่างท้ายข้อความไม่นับ", () => {
    const o = draftFromSaved(saved(), master);
    expect(isEditUnchanged(o, o)).toBe(true);
    expect(isEditUnchanged(o, { ...o, teamIds: ["t1", "t2"], note: "หมายเหตุ  " })).toBe(true);
  });
  it("แก้ช่องใดช่องหนึ่ง = เปลี่ยน", () => {
    const o = draftFromSaved(saved(), master);
    expect(isEditUnchanged(o, { ...o, contractNo: "CT26-0000002" })).toBe(false);
    expect(isEditUnchanged(o, { ...o, isUrgent: true })).toBe(false);
    expect(isEditUnchanged(o, { ...o, teamIds: ["t1"] })).toBe(false);
    expect(isEditUnchanged(o, { ...o, value1y: "1.00" })).toBe(false);
    expect(isEditUnchanged(o, { ...o, saleType: "renew" })).toBe(false);
  });
});

describe("contractEditBlockReason — สัญญาปิด/ยกเลิกแก้ไม่ได้", () => {
  it("admin: closed / cancelled มีเหตุผล · active / expired_pending_collection แก้ได้", () => {
    expect(contractEditBlockReason("closed", "admin")).toMatch(/ปิดแล้ว/);
    expect(contractEditBlockReason("cancelled", "admin")).toMatch(/ยกเลิก/);
    expect(contractEditBlockReason("active", "admin")).toBeNull();
    expect(contractEditBlockReason("expired_pending_collection", "admin")).toBeNull();
  });
  it("recorder ก็แก้สัญญาปิด/ยกเลิกไม่ได้เหมือน admin", () => {
    expect(contractEditBlockReason("closed", "recorder")).not.toBeNull();
    expect(contractEditBlockReason("cancelled", "recorder")).not.toBeNull();
  });
  it("host แก้ได้ทุกสถานะ (DECISIONS 3.11)", () => {
    for (const s of ["active", "expired_pending_collection", "closed", "cancelled"] as const) {
      expect(contractEditBlockReason(s, "host")).toBeNull();
    }
  });
  it("ข้อความล็อกสาขาบอกวิธีแก้ (ลบแล้วเปิดใหม่)", () => {
    expect(EDIT_LOCK_REASONS.branch).toMatch(/ลบ.*เปิดงานใหม่/);
  });
});

describe("checkRenewalPickForEdit", () => {
  const me = { contractId: "c1", customerId: "u1", customerName: "ก" };
  const link = (over: object) => ({
    contractId: "old",
    contractNo: "CT25-0000009",
    customerId: "u1",
    customerName: "ก",
    branchId: "b1",
    ...over,
  });
  it("ลูกค้าเดียวกัน = ผ่าน", () => {
    expect(checkRenewalPickForEdit(link({}), me)).toEqual({ ok: true });
  });
  it("คนละลูกค้า = ไม่ผ่าน บอกชื่อทั้งสองฝั่ง", () => {
    const r = checkRenewalPickForEdit(link({ customerId: "u2", customerName: "ข" }), me);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ลูกค้าคนเดียวกัน.*"ก".*"ข"/);
  });
  it("ผูกตัวเอง = ไม่ผ่าน", () => {
    expect(checkRenewalPickForEdit(link({ contractId: "c1" }), me).ok).toBe(false);
  });
});

describe("monthOfDate", () => {
  it("YYYY-MM-DD → YYYY-MM", () => {
    expect(monthOfDate("2026-11-15")).toBe("2026-11");
  });
});

describe("buildSaveParams โหมดแก้", () => {
  const values = { branchId: "b1", termYears: 1, valueTotal: 99510, endDate: "2027-09-30" };
  it("ส่ง p_contract_id · ไม่ส่ง p_customer_id จาก Renew (ลูกค้าคงเดิม)", () => {
    const d = draftFromSaved(
      saved({ saleType: "renew", renewedFrom: { contractId: "old", contractNo: "X" } }),
      master,
    );
    const p = buildSaveParams(d, values, { contractId: "c1", expectedUpdatedAt: EXPECTED });
    expect(p.p_contract_id).toBe("c1");
    expect("p_customer_id" in p).toBe(false);
    expect(p.p_renewed_from_contract_id).toBe("old");
    expect(p.p_branch_id).toBe("b1");
  });
  it("แถวใหม่ยังส่ง p_customer_id ของ Renew เหมือนเดิม", () => {
    const d = draftFromSaved(
      saved({ saleType: "renew", renewedFrom: { contractId: "old", contractNo: "X" } }),
      master,
    );
    expect(buildSaveParams(d, values).p_customer_id).toBe("u1");
  });
  it("ล้าง Renew (เปลี่ยนเป็น New) → renewed_from เป็น null", () => {
    const d = applyDraftPatch(
      draftFromSaved(saved({ saleType: "renew", renewedFrom: { contractId: "old", contractNo: "X" } }), master),
      { saleType: "new", renewal: null },
    );
    expect(buildSaveParams(d, values, { contractId: "c1" }).p_renewed_from_contract_id).toBeNull();
  });
});

describe("saveDraft โหมดแก้ (client ปลอม)", () => {
  function client(reply: { data?: unknown; error?: { code?: string; message?: string } | null }) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    return {
      calls,
      supabase: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, args });
          return { data: null, error: null, ...reply };
        },
      } as never,
    };
  }
  const d = draftFromSaved(saved(), master);
  const check = checkDraft(d, branches, undefined);

  it("สำเร็จ: เรียก save_job_opening พร้อม p_contract_id แล้วคืน contractId เดิม", async () => {
    const c = client({
      data: [{ contract_id: "c1", customer_id: "u1", reused_customer: true, existing_customer_type: "B" }],
    });
    const res = await saveDraft(c.supabase, d, check, { contractId: "c1", expectedUpdatedAt: EXPECTED });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ fn: "save_job_opening", args: { p_contract_id: "c1" } });
    expect(res).toMatchObject({ ok: true, contractId: "c1", customerTypeMismatch: null });
  });
  it("ประเภทลูกค้าไม่เปลี่ยน (ล็อก) → ไม่ขึ้นเตือนประเภทไม่ตรง", async () => {
    const c = client({
      data: [{ contract_id: "c1", customer_id: "u1", reused_customer: true, existing_customer_type: "B" }],
    });
    const res = await saveDraft(c.supabase, d, check, { contractId: "c1", expectedUpdatedAt: EXPECTED });
    expect(res.ok && res.customerTypeMismatch).toBeNull();
  });
  it("เลขสัญญาซ้ำ (23505) / นอกขอบเขต (42501) / AG006 / AG004 → ข้อความไทย", async () => {
    const run = async (code: string) =>
      saveDraft(client({ error: { code, message: "x" } }).supabase, d, check, { contractId: "c1", expectedUpdatedAt: EXPECTED });
    const dup = await run("23505");
    expect(!dup.ok && dup.error).toMatch(/เลขที่สัญญา/);
    const scope = await run("42501");
    expect(!scope.ok && scope.error).toMatch(/ไม่มีสิทธิ์/);
    const branch = await run("AG006");
    expect(!branch.ok && branch.error).toMatch(/สาขา/);
    const gone = await run("AG004");
    expect(!gone.ok && gone.error).toMatch(/ไม่พบสัญญา/);
  });
  it("Renew คนละลูกค้า (P0001) → ข้อความไทย", async () => {
    const r = await saveDraft(
      client({ error: { code: "P0001", message: "a renewal must link to a contract of the same customer" } })
        .supabase,
      d,
      check,
      { contractId: "c1", expectedUpdatedAt: EXPECTED },
    );
    expect(!r.ok && r.error).toMatch(/ลูกค้าคนเดียวกัน/);
  });
});

describe("M12 กันเขียนทับ (p_expected_updated_at)", () => {
  const values = { branchId: "b1", termYears: 1, valueTotal: 99510, endDate: "2027-09-30" };
  const d = draftFromSaved(saved(), master);
  const check = checkDraft(d, branches, undefined);
  const okRow = (updatedAt?: string) => [
    {
      contract_id: "c1",
      customer_id: "u1",
      reused_customer: true,
      existing_customer_type: "B",
      ...(updatedAt ? { updated_at: updatedAt } : {}),
    },
  ];
  function client(reply: { data?: unknown; error?: { code?: string; message?: string } | null }) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    return {
      calls,
      supabase: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, args });
          return { data: null, error: null, ...reply };
        },
      } as never,
    };
  }

  it("payload โหมดแก้มี p_expected_updated_at (ส่งสตริงตามที่ DB คืน ไม่ผ่าน Date)", () => {
    const p = buildSaveParams(d, values, { contractId: "c1", expectedUpdatedAt: EXPECTED });
    expect(p.p_expected_updated_at).toBe(EXPECTED);
  });
  it("โหมดสร้างใหม่ไม่ส่ง p_expected_updated_at", () => {
    expect("p_expected_updated_at" in buildSaveParams(d, values)).toBe(false);
  });
  it("saveDraft โหมดแก้ส่ง p_expected_updated_at ไปกับ RPC", async () => {
    const c = client({ data: okRow(NEWER) });
    await saveDraft(c.supabase, d, check, { contractId: "c1", expectedUpdatedAt: EXPECTED });
    expect(c.calls[0]?.args.p_expected_updated_at).toBe(EXPECTED);
  });
  it("saveDraft โหมดแก้ที่ลืมส่ง expected → ไม่ยิง RPC (บั๊กหน้าจอ) ขึ้นข้อความไทย", async () => {
    const c = client({ data: okRow() });
    const r = await saveDraft(c.supabase, d, check, { contractId: "c1" });
    expect(c.calls).toHaveLength(0);
    expect(!r.ok && r.error).toMatch(/เวลาแก้ล่าสุด/);
  });
  it("หลังบันทึกสำเร็จ คืน updatedAt ใหม่ที่ RPC ส่งมา (ใช้แทนค่าเดิม) · แล้วแก้ครั้งต่อไปส่งค่าใหม่", async () => {
    const c = client({ data: okRow(NEWER) });
    const first = await saveDraft(c.supabase, d, check, { contractId: "c1", expectedUpdatedAt: EXPECTED });
    expect(first.ok && first.updatedAt).toBe(NEWER);
    const next = first.ok && first.updatedAt ? first.updatedAt : EXPECTED;
    await saveDraft(c.supabase, d, check, { contractId: "c1", expectedUpdatedAt: next });
    expect(c.calls[1]?.args.p_expected_updated_at).toBe(NEWER);
  });
  it("parseSaveRow อ่าน updated_at · ไม่มี = null", () => {
    expect(parseSaveRow(okRow(NEWER))?.updatedAt).toBe(NEWER);
    expect(parseSaveRow(okRow())?.updatedAt).toBeNull();
  });
  it("AG008 → conflict: true + ข้อความไทย · error อื่นไม่มี conflict", async () => {
    const r = await saveDraft(client({ error: { code: "AG008", message: "x" } }).supabase, d, check, {
      contractId: "c1",
      expectedUpdatedAt: EXPECTED,
    });
    expect(!r.ok && r.conflict).toBe(true);
    expect(!r.ok && r.error).toBe("มีคนแก้สัญญานี้ไปก่อนแล้ว กรุณาโหลดใหม่");
    const other = await saveDraft(client({ error: { code: "AG006", message: "x" } }).supabase, d, check, {
      contractId: "c1",
      expectedUpdatedAt: EXPECTED,
    });
    expect(!other.ok && other.conflict).toBeUndefined();
  });
});

describe("แปล error M12 (describeDbError)", () => {
  it("AG007 → สัญญาปิด/ยกเลิกแล้ว แก้ได้เฉพาะผู้ดูแลระบบ (Host) ทุก context", () => {
    const msg = "สัญญาปิด/ยกเลิกแล้ว แก้ได้เฉพาะผู้ดูแลระบบ (Host)";
    expect(describeDbError({ code: "AG007" })).toBe(msg);
    expect(describeDbError({ code: "AG007" }, "file")).toBe(msg);
    expect(describeDbError({ code: "AG007" }, "delete")).toBe(msg);
  });
  it("AG008 → มีคนแก้สัญญานี้ไปก่อนแล้ว กรุณาโหลดใหม่", () => {
    expect(describeDbError({ code: "AG008" })).toBe("มีคนแก้สัญญานี้ไปก่อนแล้ว กรุณาโหลดใหม่");
  });
  it("22004 → บอกว่าเป็นข้อผิดพลาดของหน้าจอ ไม่ใช่ข้อความทั่วไป", () => {
    expect(describeDbError({ code: "22004" })).toMatch(/ข้อผิดพลาดของหน้าจอ/);
  });
});

describe("contractFileBlockReason (ล็อกไฟล์ตามสถานะ · ตรงกับ DB M12)", () => {
  it("closed ล็อกทุกคน (รวม host) · cancelled ล็อกเฉพาะที่ไม่ใช่ host · active ไม่ล็อก", () => {
    expect(contractFileBlockReason("closed", "host")).not.toBeNull();
    expect(contractFileBlockReason("closed", "admin")).not.toBeNull();
    expect(contractFileBlockReason("cancelled", "admin")).toMatch(/Host/);
    expect(contractFileBlockReason("cancelled", "recorder")).not.toBeNull();
    expect(contractFileBlockReason("cancelled", "host")).toBeNull();
    expect(contractFileBlockReason("active", "admin")).toBeNull();
    expect(contractFileBlockReason("expired_pending_collection", "admin")).toBeNull();
  });
});
