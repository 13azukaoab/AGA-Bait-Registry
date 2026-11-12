/**
 * บันทึก/ลบสัญญา — เรียก RPC ฝั่งฐานข้อมูล (ใช้ Supabase client ของผู้ใช้ที่ล็อกอิน ไม่ใช้ service role)
 *
 * Logic summary:
 *   * บันทึก = `rpc('save_job_opening')` 1 ครั้ง = 1 transaction (ลูกค้า → สัญญา → ทีม) ล้มตรงไหน DB ย้อนทั้งหมด
 *     จึงไม่มีโค้ด rollback ฝั่ง client แล้ว · RPC เป็น SECURITY INVOKER → RLS ตัดสินสิทธิ์ (admin นอกขอบเขต = 42501)
 *   * ใช้ได้ทั้งเปิดงานใหม่และแก้สัญญาเดิม (`options.contractId` + `options.expectedUpdatedAt` — M12 กันเขียนทับ:
 *     ไม่มี expected = ไม่ยิง RPC · AG008 → `conflict: true` · สำเร็จคืน `updatedAt` ใหม่)
 *   * ชื่อลูกค้าซ้ำในสาขา (AG001): ไม่บันทึกอะไรเลย คืน `duplicates` ให้หน้าจอถามผู้ใช้ แล้วเรียกซ้ำ
 *     ด้วย `options.customerId` (ใช้รายเดิม) หรือ `options.confirmNewCustomer` (คนละราย) — ดู `duplicateCustomer.ts`
 *   * Renew ที่ผูกสัญญาเก่า: ส่ง customer_id ของสัญญาเก่า + renewed_from_contract_id (ไม่สร้างลูกค้าใหม่ — M9)
 *   * ใช้ลูกค้าเดิมแล้วประเภทที่เลือกไม่ตรงของเดิม → คืน `customerTypeMismatch` (ใช้ existing_customer_type
 *     ที่ RPC ส่งกลับ) ให้หน้าจอเตือน · ประเภทเป็นของลูกค้า ไม่ถูกเขียนทับ
 *   * ลบสัญญา = `rpc('delete_job_opening')` (ตรวจสถานะ/ผลบริการ → ลบสัญญา → ลบลูกค้าที่ไม่เหลือสัญญา ใน transaction เดียว)
 *     **ไม่ลบไฟล์ใน Storage ฝั่ง client** — trigger ลงคิว `storage_deletion_queue` แล้ว cron ลบให้
 *   * error ทุกตัวแปลเป็นไทยที่ `describeDbError` (รวม AG001–AG008)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseDuplicateMatches, type DuplicateCustomerMatch } from "./duplicateCustomer";
import { CONFLICT_ERROR_CODE, describeDbError } from "./errors";
import type { DraftCheck } from "./draftRow";
import { buildSaveParams, parseSaveRow, type SaveOptions } from "./savePayload";
import { customerTypeMismatch, type CustomerTypeMismatch } from "./saveRules";
import type { DraftRow } from "./types";

export type SaveResult =
  | {
      ok: true;
      contractId: string;
      customerId: string;
      reusedCustomer: boolean;
      /** ใช้ลูกค้าเดิมแต่ประเภทที่เลือกไม่ตรงของเดิม (ไม่ถูกบันทึก) — null = ไม่มีปัญหา */
      customerTypeMismatch: CustomerTypeMismatch | null;
      /** เวลาแก้ล่าสุดใหม่ของสัญญา (M12) — ใช้แทนค่าเดิมเป็น expected ของการแก้ครั้งต่อไป · null = RPC ไม่ได้คืนมา */
      updatedAt: string | null;
    }
  | {
      ok: false;
      error: string;
      /** มีค่า (ไม่ว่าง) = พบลูกค้าชื่อซ้ำ (AG001) — ให้ถามผู้ใช้แล้วเรียกซ้ำ */
      duplicates?: DuplicateCustomerMatch[];
      /** true = AG008 มีคนแก้สัญญานี้ไปก่อน — หน้าจอแสดงปุ่ม "โหลดแถวใหม่" */
      conflict?: boolean;
    };

export async function saveDraft(
  supabase: SupabaseClient,
  draft: DraftRow,
  check: DraftCheck,
  options: SaveOptions = {},
): Promise<SaveResult> {
  const { branch, termYears, valueTotal } = check;
  if (!branch || !termYears || valueTotal === null) {
    return { ok: false, error: "ข้อมูลไม่ครบ ตรวจช่องที่ขึ้นแดง" };
  }

  // โหมดแก้ต้องมีเวลาแก้ล่าสุดที่หน้าจอเห็น (M12) — ไม่มี = บั๊กหน้าจอ ไม่ยิง RPC (DB จะตอบ 22004 อยู่แล้ว)
  if (options.contractId && !options.expectedUpdatedAt) {
    return { ok: false, error: describeDbError({ code: "22004" }) };
  }

  const params = buildSaveParams(
    draft,
    { branchId: branch.id, termYears, valueTotal, endDate: check.endDate },
    options,
  );
  const { data, error } = await supabase.rpc("save_job_opening", params);

  if (error) {
    if (error.code === "AG001") {
      const duplicates = parseDuplicateMatches(error.details);
      if (duplicates.length > 0) return { ok: false, error: describeDbError(error), duplicates };
    }
    if (error.code === CONFLICT_ERROR_CODE) return { ok: false, error: describeDbError(error), conflict: true };
    return { ok: false, error: describeDbError(error) };
  }

  const row = parseSaveRow(data);
  if (!row) {
    return { ok: false, error: "บันทึกแล้วแต่อ่านผลจากระบบไม่ได้ รีเฟรชหน้าเพื่อตรวจก่อนบันทึกซ้ำ" };
  }
  return {
    ok: true,
    contractId: row.contractId,
    customerId: row.customerId,
    reusedCustomer: row.reusedCustomer,
    customerTypeMismatch: row.reusedCustomer
      ? customerTypeMismatch(row.existingCustomerType, draft.customerTypeCode)
      : null,
    updatedAt: row.updatedAt,
  };
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

/** เลขที่สัญญา Renew ที่ผูกกับสัญญานี้อยู่ (เห็นตาม RLS) — ใช้เตือนก่อนลบ · error = บอกผู้เรียก */
export async function findLinkedRenewals(
  supabase: SupabaseClient,
  contractId: string,
): Promise<{ contractNos: string[]; error: string | null }> {
  const { data, error } = await supabase
    .from("contracts")
    .select("contract_no")
    .eq("renewed_from_contract_id", contractId)
    .order("contract_no", { ascending: true });
  if (error) return { contractNos: [], error: describeDbError(error, "delete") };
  return {
    contractNos: ((data ?? []) as { contract_no: string }[]).map((r) => r.contract_no),
    error: null,
  };
}

/**
 * ลบสัญญา (ไฟล์แนบ/ทีมลบตาม CASCADE · ลูกค้าที่ไม่เหลือสัญญาถูกลบด้วย) — ทำได้เฉพาะสัญญาที่ยังไม่มีผลบริการ
 * ไฟล์ใน Storage ไม่ถูกแตะที่นี่ (DB ลงคิวแล้ว cron ลบ)
 */
export async function deleteContract(
  supabase: SupabaseClient,
  contractId: string,
): Promise<DeleteResult> {
  const { error } = await supabase.rpc("delete_job_opening", { p_contract_id: contractId });
  if (error) return { ok: false, error: describeDbError(error, "delete") };
  return { ok: true };
}
