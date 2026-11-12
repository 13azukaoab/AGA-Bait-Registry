/**
 * ตัวแปลงแถวร่าง → พารามิเตอร์ของ RPC `public.save_job_opening` (pure function — เทสได้)
 * ชื่อพารามิเตอร์ตรงกับ migration 20261112110000_job_opening_save_rpc.sql
 *
 * Logic summary:
 *   * `contractId` ว่าง = เปิดงานใหม่ · มีค่า = แก้สัญญาเดิม (RPC แก้ได้เฉพาะสัญญา + ทีม · ไม่แก้ชื่อลูกค้า
 *     และเปลี่ยนสาขาไม่ได้ → AG006)
 *   * ลูกค้า: Renew ที่ผูกสัญญาเก่า → `p_customer_id` = ลูกค้าของสัญญานั้น + `p_renewed_from_contract_id`
 *     · ผู้ใช้เลือก "ใช้รายเดิม" จากกล่อง AG001 → `p_customer_id` ที่เลือก (ชนะ Renew)
 *     · ผู้ใช้เลือก "คนละราย" → `p_confirm_new_customer: true`
 *   * ตำแหน่งผู้ขาย: Sale → `p_sale_name` · AM → `p_am_name` (ไม่มีคอลัมน์ตำแหน่ง)
 *   * วันที่/เวลาที่ว่างส่งเป็น null · เวลาบริการส่งเฉพาะเมื่อมีวันที่บริการ (constraint ของ DB)
 *   * ไม่ส่งสถานี (stations) — สร้างตอนติดตั้งจริง (DECISIONS 3.7)
 */
import { normalizeContractNo } from "./contractNo";
import type { DraftRow } from "./types";

/** ค่าจากการตรวจแถว (`DraftCheck`) ที่ผ่านแล้ว — ไม่เป็น null */
export interface ValidDraftValues {
  branchId: string;
  termYears: number;
  valueTotal: number;
  endDate: string | null;
}

export interface SaveOptions {
  /** แก้สัญญาที่บันทึกแล้ว (ว่าง/null = เปิดงานใหม่) */
  contractId?: string | null;
  /** ใช้ลูกค้ารายเดิมที่ผู้ใช้เลือกจากกล่อง AG001 */
  customerId?: string | null;
  /** ผู้ใช้ยืนยันว่า "เป็นคนละราย" (ข้ามการเตือนชื่อซ้ำ) */
  confirmNewCustomer?: boolean;
}

export interface SaveJobOpeningParams {
  p_branch_id: string;
  p_customer_name: string;
  p_customer_type: string;
  p_contract_no: string;
  p_start_date: string;
  p_end_date: string | null;
  p_term_years: number;
  p_value_total: number;
  p_sale_type: "new" | "renew";
  p_team_ids: string[];
  p_sale_name: string | null;
  p_am_name: string | null;
  p_is_urgent: boolean;
  p_renewed_from_contract_id: string | null;
  p_mail_received_date: string | null;
  p_first_service_date: string | null;
  p_first_service_time: string | null;
  p_note: string | null;
  p_confirm_new_customer: boolean;
  p_contract_id?: string;
  p_customer_id?: string;
}

export function buildSaveParams(
  draft: DraftRow,
  values: ValidDraftValues,
  options: SaveOptions = {},
): SaveJobOpeningParams {
  const renewal = draft.saleType === "renew" ? draft.renewal : null;
  const sellerName = draft.saleName.trim();
  const hasServiceDate = draft.firstServiceDate !== "";

  const params: SaveJobOpeningParams = {
    p_branch_id: values.branchId,
    p_customer_name: draft.customerName.trim(),
    p_customer_type: draft.customerTypeCode,
    p_contract_no: normalizeContractNo(draft.contractNo),
    p_start_date: draft.startDate,
    p_end_date: values.endDate,
    p_term_years: values.termYears,
    p_value_total: values.valueTotal,
    p_sale_type: draft.saleType,
    p_team_ids: draft.teamIds,
    p_sale_name: draft.sellerRole === "sale" && sellerName ? sellerName : null,
    p_am_name: draft.sellerRole === "am" && sellerName ? sellerName : null,
    p_is_urgent: draft.isUrgent,
    p_renewed_from_contract_id: renewal ? renewal.contractId : null,
    p_mail_received_date: draft.mailReceivedDate || null,
    p_first_service_date: hasServiceDate ? draft.firstServiceDate : null,
    p_first_service_time: hasServiceDate && draft.firstServiceTime ? draft.firstServiceTime : null,
    p_note: draft.note.trim() || null,
    p_confirm_new_customer: options.confirmNewCustomer === true,
  };

  const customerId = options.customerId ?? renewal?.customerId ?? null;
  if (customerId) params.p_customer_id = customerId;
  if (options.contractId) params.p_contract_id = options.contractId;
  return params;
}

/** แถวที่ RPC คืน (RETURNS TABLE → PostgREST ส่งเป็นอาร์เรย์ 1 แถว) */
export interface SaveJobOpeningRow {
  contractId: string;
  customerId: string;
  reusedCustomer: boolean;
  /** ประเภทของลูกค้าเดิมเมื่อใช้รายเดิม (null = ไม่ได้ใช้รายเดิม/รายเดิมยังไม่ระบุ) */
  existingCustomerType: string | null;
}

/** อ่านผลของ RPC · รูปแบบไม่ตรง = null (ผู้เรียกต้องถือว่าบันทึกไม่สำเร็จ ห้ามเดา) */
export function parseSaveRow(data: unknown): SaveJobOpeningRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.contract_id !== "string" || typeof r.customer_id !== "string") return null;
  return {
    contractId: r.contract_id,
    customerId: r.customer_id,
    reusedCustomer: r.reused_customer === true,
    existingCustomerType:
      typeof r.existing_customer_type === "string" && r.existing_customer_type !== ""
        ? r.existing_customer_type
        : null,
  };
}
