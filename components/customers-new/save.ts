/**
 * บันทึก/ลบสัญญา (ฝั่ง client — ใช้ Supabase client ของผู้ใช้ที่ล็อกอิน ไม่ใช้ service role)
 *
 * Logic summary:
 *   * บันทึก 1 แถว = ลูกค้า → สัญญา → ทีม (contract_teams) ตามลำดับ · RLS เป็นผู้ตัดสินสิทธิ์
 *     (admin บันทึกได้เฉพาะสาขาในขอบเขตตัวเอง) ถูกปฏิเสธ = ข้อความไทยจาก `describeDbError`
 *   * Renew ที่ผูกสัญญาเก่าไว้: ใช้ customer_id ของสัญญาเก่า **ไม่สร้างลูกค้าใหม่** (กันนับลูกค้าซ้ำบน
 *     Dashboard — M9) และบันทึก renewed_from_contract_id · DB ตรวจซ้ำด้วย trigger (P0001)
 *   * ลูกค้า (กรณีไม่ได้ผูก): ถ้าในสาขานั้นมีลูกค้าชื่อตรงกันเป๊ะอยู่แล้ว ใช้รายเดิม (1 ลูกค้ามีได้หลายสัญญา
 *     — SPEC §6) ไม่งั้นสร้างใหม่ · ถ้าสร้างสัญญา/ทีมไม่สำเร็จ จะลบลูกค้าที่เพิ่งสร้างคืน
 *   * ตำแหน่งผู้ขาย: Sale → ชื่อลง sale_name · AM → ชื่อลง am_name (ไม่มีคอลัมน์ตำแหน่ง)
 *   * ไม่สร้างแถว stations ตอนเปิดงาน — สถานีสร้างตอนติดตั้งจริง (เจ้าของตัดสิน 12 พ.ย. 2026)
 *   * ลบสัญญา: ตรวจก่อนว่ายังไม่มีผลบริการ → ลบไฟล์ใน Storage ก่อน (policy ของ bucket ต้องเห็นแถวสัญญา
 *     อยู่) → ลบสัญญา (contract_teams/contract_files/stations ลบตามด้วย CASCADE) → ลบลูกค้าที่ไม่เหลือสัญญา
 *   * ข้อควรระวัง: ไฟล์ใน bucket ไม่ลบตามแถวอัตโนมัติ แอปต้องลบเอง (migration 20261111090300)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeContractNo } from "./contractNo";
import { describeDbError } from "./errors";
import { CONTRACT_FILES_BUCKET } from "./files";
import type { DraftCheck } from "./draftRow";
import type { DraftRow } from "./types";

export type SaveResult =
  | { ok: true; contractId: string; reusedCustomer: boolean }
  | { ok: false; error: string };

export async function saveDraft(
  supabase: SupabaseClient,
  draft: DraftRow,
  check: DraftCheck,
): Promise<SaveResult> {
  const { branch, termYears, valueTotal } = check;
  if (!branch || !termYears || valueTotal === null) {
    return { ok: false, error: "ข้อมูลไม่ครบ ตรวจช่องที่ขึ้นแดง" };
  }
  const name = draft.customerName.trim();

  // 1) ลูกค้า: Renew ที่ผูกสัญญาเก่า = ลูกค้าเดิมของสัญญานั้น · ไม่งั้นใช้รายเดิมถ้าชื่อตรงในสาขาเดียวกัน
  let customerId: string | null = null;
  let createdCustomer = false;
  const renewal = draft.saleType === "renew" ? draft.renewal : null;
  if (renewal) {
    customerId = renewal.customerId;
  } else {
    const existing = await supabase
      .from("customers")
      .select("id")
      .eq("branch_id", branch.id)
      .eq("name", name)
      .limit(1);
    if (existing.error) return { ok: false, error: describeDbError(existing.error) };
    const found = (existing.data ?? [])[0] as { id: string } | undefined;
    if (found) customerId = found.id;
  }

  if (!customerId) {
    const inserted = await supabase
      .from("customers")
      .insert({
        branch_id: branch.id,
        name,
        customer_type: draft.customerTypeCode || null,
      })
      .select("id")
      .single();
    if (inserted.error) return { ok: false, error: describeDbError(inserted.error) };
    customerId = (inserted.data as { id: string }).id;
    createdCustomer = true;
  }

  const rollbackCustomer = async () => {
    if (createdCustomer && customerId) {
      await supabase.from("customers").delete().eq("id", customerId);
    }
  };

  // 2) สัญญา
  const contract = await supabase
    .from("contracts")
    .insert({
      customer_id: customerId,
      contract_no: normalizeContractNo(draft.contractNo),
      start_date: draft.startDate,
      end_date: check.endDate,
      term_years: termYears,
      value_total: valueTotal,
      sale_type: draft.saleType,
      sale_name: draft.sellerRole === "sale" ? draft.saleName.trim() : null,
      am_name: draft.sellerRole === "am" ? draft.saleName.trim() : null,
      is_urgent: draft.isUrgent,
      renewed_from_contract_id: renewal ? renewal.contractId : null,
      mail_received_date: draft.mailReceivedDate || null,
      first_service_date: draft.firstServiceDate || null,
      first_service_time: draft.firstServiceDate && draft.firstServiceTime ? draft.firstServiceTime : null,
      note: draft.note.trim() || null,
    })
    .select("id")
    .single();
  if (contract.error) {
    await rollbackCustomer();
    return { ok: false, error: describeDbError(contract.error) };
  }
  const contractId = (contract.data as { id: string }).id;

  // 3) ทีมที่ดูแลสัญญา
  if (draft.teamIds.length > 0) {
    const teams = await supabase
      .from("contract_teams")
      .insert(draft.teamIds.map((team_id) => ({ contract_id: contractId, team_id })));
    if (teams.error) {
      await supabase.from("contracts").delete().eq("id", contractId);
      await rollbackCustomer();
      return { ok: false, error: describeDbError(teams.error) };
    }
  }

  return { ok: true, contractId, reusedCustomer: !createdCustomer };
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

/** ลบสัญญา (และไฟล์แนบใน Storage + ลูกค้าที่ไม่เหลือสัญญา) — ทำได้เฉพาะสัญญาที่ยังไม่มีผลบริการ */
export async function deleteContract(
  supabase: SupabaseClient,
  contractId: string,
  customerId: string,
): Promise<DeleteResult> {
  const visits = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId);
  if (visits.error) return { ok: false, error: describeDbError(visits.error, "delete") };
  if ((visits.count ?? 0) > 0) {
    return {
      ok: false,
      error: "ลบไม่ได้ เพราะสัญญานี้มีผลบริการแล้ว (ให้ใช้สถานะยกเลิกแทน)",
    };
  }

  // เก็บ path ของไฟล์ไว้ก่อน — ต้องลบ object ตอนที่แถวสัญญายังอยู่ (policy ของ bucket อ่านสถานะสัญญา)
  const files = await supabase
    .from("contract_files")
    .select("storage_path")
    .eq("contract_id", contractId);
  if (files.error) return { ok: false, error: describeDbError(files.error, "delete") };
  const paths = ((files.data ?? []) as { storage_path: string }[]).map((f) => f.storage_path);

  if (paths.length > 0) {
    const removed = await supabase.storage.from(CONTRACT_FILES_BUCKET).remove(paths);
    if (removed.error) {
      return { ok: false, error: describeDbError(removed.error as never, "file") };
    }
  }

  const del = await supabase.from("contracts").delete().eq("id", contractId);
  if (del.error) return { ok: false, error: describeDbError(del.error, "delete") };

  // ลูกค้าที่ไม่เหลือสัญญาแล้ว ลบทิ้ง (ไม่ปล่อยข้อมูลส่วนบุคคลค้างโดยไม่มีสัญญา) — ลบไม่ได้ก็ข้าม
  const remaining = await supabase
    .from("contracts")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  if (!remaining.error && (remaining.count ?? 0) === 0) {
    await supabase.from("customers").delete().eq("id", customerId);
  }
  return { ok: true };
}
