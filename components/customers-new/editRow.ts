/**
 * แก้แถวที่บันทึกแล้ว (รอบ 1.3) — ตัวช่วยแบบ pure function (เทสได้ ไม่แตะ DB)
 *
 * Logic summary:
 *   * กดปุ่ม "แก้" → แปลงสัญญาที่บันทึกแล้ว (`SavedContract`) เป็นแถวร่าง (`DraftRow`) เพื่อใช้ช่องกรอก/ตัวตรวจ/
 *     ตัวคำนวณ Tier ชุดเดียวกับแถวใหม่ · กดบันทึก → `saveDraft(..., { contractId })` = RPC `save_job_opening` โหมดแก้
 *   * แก้ได้: เลขที่สัญญา · ประเภทงาน · ผู้ขาย/ตำแหน่ง · วันที่รับ Mail · วัน/เวลานัดบริการ · ทีม · ระยะ/มูลค่า ·
 *     วันเริ่ม/สิ้นสุด · เบิกด่วน · หมายเหตุ · ผูก Renew
 *   * ล็อก: สาขา (AG006 — เปลี่ยนไม่ได้ ถ้าลงผิดสาขาให้ลบแล้วเปิดใหม่) · ชื่อลูกค้า (ลูกค้า 1 คนมีหลายสัญญา) ·
 *     ประเภทลูกค้า (เป็นของลูกค้า RPC ไม่เขียนทับ)
 *   * สัญญา `closed` / `cancelled` → admin/role อื่นปิดปุ่มแก้ · host แก้ได้ (DECISIONS 3.11 · DB บังคับใน M12)
 *   * วันสิ้นสุด: ถ้าค่าที่บันทึกไว้ตรงสูตร (วันเริ่ม + N ปี − 1 วัน) → ให้คำนวณใหม่ตามวันเริ่ม/ระยะต่อ
 *     ถ้าเคยตั้งเองต่างจากสูตร → คงค่าเดิม (endTouched)
 */
import type { UserRole } from "@/lib/db/types";

import { autoEndDate, formatMoney } from "./rowCalc";
import type { ContractStatus, DraftRow, MasterData, RenewalLink, SavedContract } from "./types";

/**
 * เหตุผลที่แก้สัญญานี้ไม่ได้ (null = แก้ได้)
 * เจ้าของตัดสิน (DECISIONS 3.11): สัญญา closed/cancelled — host แก้ได้ · admin / role อื่นแก้ไม่ได้
 * (ฝั่ง DB บังคับซ้ำใน M12 โดยหมวด 2 — ที่นี่เป็นแค่ปิดปุ่ม)
 */
export function contractEditBlockReason(status: ContractStatus, role: UserRole): string | null {
  if (role === "host") return null;
  if (status === "closed") return "แก้ไม่ได้ — สัญญาปิดแล้ว (เก็บไว้เป็นประวัติ · แก้ได้เฉพาะ host)";
  if (status === "cancelled") {
    return "แก้ไม่ได้ — สัญญายกเลิกแล้ว เก็บไว้เป็นประวัติ (แก้ได้เฉพาะ host)";
  }
  return null;
}

/** ข้อความอธิบายช่องที่ล็อกตอนแก้ (ใช้เป็น tooltip) */
export const EDIT_LOCK_REASONS = {
  branch: "แก้สาขาไม่ได้ — ถ้าลงผิดสาขาให้ลบสัญญานี้แล้วเปิดงานใหม่",
  customerName:
    "แก้ชื่อลูกค้าในหน้านี้ไม่ได้ — ลูกค้า 1 คนมีได้หลายสัญญา การแก้ชื่อจะกระทบทุกสัญญาของลูกค้าคนนี้",
  customerType: "ประเภทลูกค้าเป็นของลูกค้า ไม่ใช่ของสัญญา — แก้ในหน้านี้ไม่ได้",
} as const;

/** สร้างแถวร่างสำหรับแก้จากสัญญาที่บันทึกแล้ว (ค่าตรงกับที่ผู้ใช้เห็นในตาราง) */
export function draftFromSaved(s: SavedContract, master: Pick<MasterData, "branches">): DraftRow {
  const branch = master.branches.find((b) => b.id === s.branchId) ?? null;
  const has3 = s.termYears === 3;
  const money = formatMoney(s.valueTotal);

  const renewal: RenewalLink | null = s.renewedFrom
    ? {
        contractId: s.renewedFrom.contractId,
        contractNo: s.renewedFrom.contractNo ?? "",
        // Renew = ลูกค้าคนเดียวกันเสมอ (trigger M9) จึงใช้ลูกค้าของสัญญานี้
        customerId: s.customerId,
        customerName: s.customerName,
        branchId: s.branchId,
      }
    : null;

  const auto = s.endDate ? autoEndDate(s.startDate, s.termYears) : null;
  return {
    key: `edit-${s.contractId}`,
    contractNo: s.contractNo,
    customerName: s.customerName,
    saleType: s.saleType,
    sellerRole: s.sellerRole,
    saleName: s.sellerName,
    isUrgent: s.isUrgent,
    renewal,
    mailReceivedDate: s.mailReceivedDate,
    firstServiceDate: s.firstServiceDate,
    firstServiceTime: s.firstServiceTime,
    note: s.note,
    branchText: branch?.name ?? "",
    customerTypeCode: s.customerTypeCode ?? "",
    teamIds: [...s.teamIds],
    startDate: s.startDate,
    endDate: s.endDate,
    // วันสิ้นสุดที่ผู้ใช้เคยตั้งต่างจากสูตร = คงไว้ · ตรงสูตร/ว่าง = คำนวณใหม่ตามวันเริ่ม/ระยะ
    endTouched: s.endDate !== "" && auto !== s.endDate,
    value1y: has3 ? "" : money,
    value3y: has3 ? money : "",
    pendingPdf: null,
    saveError: null,
  };
}

/** ค่าที่ผู้ใช้แก้ได้ (ใช้เทียบว่าแก้อะไรไปหรือยัง) — ไม่รวม key / saveError / ไฟล์รอแนบ */
function editableSnapshot(d: DraftRow): string {
  return JSON.stringify([
    d.contractNo.trim(),
    d.saleType,
    d.sellerRole,
    d.saleName.trim(),
    d.isUrgent,
    d.renewal?.contractId ?? null,
    d.mailReceivedDate,
    d.firstServiceDate,
    d.firstServiceTime,
    d.note.trim(),
    [...d.teamIds].sort(),
    d.startDate,
    d.endDate,
    d.value1y.trim(),
    d.value3y.trim(),
  ]);
}

/** แถวที่แก้ยังเหมือนค่าเดิมทุกช่อง (ไม่มีอะไรให้บันทึก) */
export function isEditUnchanged(original: DraftRow, current: DraftRow): boolean {
  return editableSnapshot(original) === editableSnapshot(current);
}

export type RenewalEditCheck = { ok: true } | { ok: false; error: string };

/**
 * ตรวจสัญญาเก่าที่เลือกผูก Renew ตอนแก้แถว: ต้องเป็นสัญญาของลูกค้าคนเดียวกัน และไม่ใช่ตัวมันเอง
 * (ตอนแก้ ลูกค้าของสัญญาล็อกอยู่ — การเลือกสัญญาเก่าของคนอื่นจะย้ายลูกค้า ซึ่งหน้านี้ไม่ทำ)
 */
export function checkRenewalPickForEdit(
  link: RenewalLink,
  editing: { contractId: string; customerId: string; customerName: string },
): RenewalEditCheck {
  if (link.contractId === editing.contractId) {
    return { ok: false, error: "สัญญาผูกกับตัวเองไม่ได้ เลือกสัญญาเก่าอีกใบ" };
  }
  if (link.customerId !== editing.customerId) {
    return {
      ok: false,
      error: `Renew ต้องผูกกับสัญญาเก่าของลูกค้าคนเดียวกัน — สัญญานี้เป็นของ "${editing.customerName}" แต่สัญญา ${link.contractNo} เป็นของ "${link.customerName}"`,
    };
  }
  return { ok: true };
}

/** เดือน 'YYYY-MM' ของวันที่ 'YYYY-MM-DD' (ใช้บอกว่าแก้วันเริ่มแล้วสัญญาย้ายไปเดือนอื่น) */
export function monthOfDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}
