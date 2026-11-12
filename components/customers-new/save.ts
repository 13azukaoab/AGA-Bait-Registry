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
 *   * ใช้ลูกค้าเดิม (ชื่อตรง/ผูก Renew) แล้วประเภทที่เลือกไม่ตรงของเดิม → คืน `customerTypeMismatch`
 *     ให้หน้าจอเตือน (ประเภทเป็นของลูกค้า ไม่ถูกเขียนทับ)
 *   * rollback ล้ม (ลบคืนไม่ได้/ถูก RLS ปฏิเสธแบบไม่ error) → error บอกว่ามีข้อมูลค้างอะไรบ้าง
 *   * ลบสัญญา: **ตรวจก่อนแตะ Storage** ว่าลบได้ (สถานะไม่ใช่ปิด/ยกเลิก · ไม่มีผลบริการ visits ·
 *     ไม่มีผลตรวจสถานี station_checks) → ลบไฟล์ใน Storage (policy ของ bucket ต้องเห็นแถวสัญญาอยู่
 *     และต้องลบครบทุกไฟล์ ไม่งั้นหยุด) → ลบสัญญา (contract_teams/contract_files/stations ลบตามด้วย CASCADE)
 *     → ลบลูกค้าที่ไม่เหลือสัญญา
 *   * ข้อควรระวัง: ไฟล์ใน bucket ไม่ลบตามแถวอัตโนมัติ แอปต้องลบเอง (migration 20261111090300) ·
 *     ลำดับ "ลบไฟล์ก่อนลบสัญญา" ยังเสี่ยงถ้าลบสัญญาล้มหลังลบไฟล์ — จะแก้ถาวรฝั่ง DB (งาน BE)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeContractNo } from "./contractNo";
import { contractDeleteBlockReason, describeLeftovers } from "./deleteRules";
import { describeDbError } from "./errors";
import { removeObjects } from "./files";
import { customerTypeMismatch, type CustomerTypeMismatch } from "./saveRules";
import type { DraftCheck } from "./draftRow";
import type { ContractStatus, DraftRow } from "./types";

export type SaveResult =
  | {
      ok: true;
      contractId: string;
      reusedCustomer: boolean;
      /** ใช้ลูกค้าเดิมแต่ประเภทที่เลือกไม่ตรงของเดิม (ไม่ถูกบันทึก) — null = ไม่มีปัญหา */
      customerTypeMismatch: CustomerTypeMismatch | null;
    }
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
  let typeMismatch: CustomerTypeMismatch | null = null;
  const renewal = draft.saleType === "renew" ? draft.renewal : null;
  if (renewal) {
    const old = await supabase
      .from("customers")
      .select("id, customer_type")
      .eq("id", renewal.customerId)
      .limit(1);
    if (old.error) return { ok: false, error: describeDbError(old.error) };
    const found = (old.data ?? [])[0] as { id: string; customer_type: string | null } | undefined;
    if (!found) {
      return {
        ok: false,
        error: "ไม่พบลูกค้าเดิมของสัญญาที่ผูกไว้ (อาจถูกลบหรือไม่มีสิทธิ์ดู) เลือกสัญญาเก่าใหม่",
      };
    }
    customerId = found.id;
    typeMismatch = customerTypeMismatch(found.customer_type, draft.customerTypeCode);
  } else {
    const existing = await supabase
      .from("customers")
      .select("id, customer_type")
      .eq("branch_id", branch.id)
      .eq("name", name)
      .limit(1);
    if (existing.error) return { ok: false, error: describeDbError(existing.error) };
    const found = (existing.data ?? [])[0] as { id: string; customer_type: string | null } | undefined;
    if (found) {
      customerId = found.id;
      typeMismatch = customerTypeMismatch(found.customer_type, draft.customerTypeCode);
    }
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

  /** ลบแถวที่เพิ่งสร้างคืน — ตรวจผลจริง: ไม่ error แต่ลบได้ 0 แถว (RLS ปฏิเสธ) ก็นับว่าล้ม */
  const deleteRow = async (table: "customers" | "contracts", id: string): Promise<boolean> => {
    const res = await supabase.from(table).delete().eq("id", id).select("id");
    return !res.error && (res.data ?? []).length > 0;
  };
  /** ลบลูกค้าที่เพิ่งสร้างคืน (ถ้าสร้างเอง) · ลบไม่ได้ → เพิ่มลงรายการข้อมูลค้าง */
  const rollbackCustomer = async (leftovers: string[]) => {
    if (createdCustomer && customerId && !(await deleteRow("customers", customerId))) {
      leftovers.push(`ลูกค้า "${name}"`);
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
    const leftovers: string[] = [];
    await rollbackCustomer(leftovers);
    return { ok: false, error: describeDbError(contract.error) + describeLeftovers(leftovers) };
  }
  const contractId = (contract.data as { id: string }).id;

  // 3) ทีมที่ดูแลสัญญา
  if (draft.teamIds.length > 0) {
    const teams = await supabase
      .from("contract_teams")
      .insert(draft.teamIds.map((team_id) => ({ contract_id: contractId, team_id })));
    if (teams.error) {
      const leftovers: string[] = [];
      if (await deleteRow("contracts", contractId)) {
        await rollbackCustomer(leftovers);
      } else {
        // ลบสัญญาคืนไม่ได้ → ลูกค้าก็ลบไม่ได้ (ยังมีสัญญาอ้างอิง) ไม่ต้องลอง
        leftovers.push(`สัญญา ${normalizeContractNo(draft.contractNo)} (ยังไม่มีทีม)`);
        if (createdCustomer) leftovers.push(`ลูกค้า "${name}"`);
      }
      return { ok: false, error: describeDbError(teams.error) + describeLeftovers(leftovers) };
    }
  }

  return { ok: true, contractId, reusedCustomer: !createdCustomer, customerTypeMismatch: typeMismatch };
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

const CHUNK = 80;

/**
 * ตรวจก่อนลบ (อ่านอย่างเดียว ไม่แตะ Storage): สถานะ + ผลบริการ + ผลตรวจสถานี
 * อ่านตาม RLS ของผู้ใช้ — อ่านไม่ได้/error = ถือว่าตรวจไม่ผ่าน (ไม่เดาว่าลบได้)
 */
export async function checkContractDeletable(
  supabase: SupabaseClient,
  contractId: string,
): Promise<DeleteResult> {
  const row = await supabase.from("contracts").select("status").eq("id", contractId).limit(1);
  if (row.error) return { ok: false, error: describeDbError(row.error, "delete") };
  const found = (row.data ?? [])[0] as { status: ContractStatus } | undefined;
  if (!found) return { ok: false, error: "ไม่พบสัญญานี้แล้ว (อาจถูกลบไปแล้ว) รีเฟรชหน้า" };
  const blocked = contractDeleteBlockReason(found.status);
  if (blocked) return { ok: false, error: blocked };

  const visits = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId);
  if (visits.error) return { ok: false, error: describeDbError(visits.error, "delete") };
  if ((visits.count ?? 0) > 0) {
    return { ok: false, error: "ลบไม่ได้ เพราะสัญญานี้มีผลบริการแล้ว (ให้ใช้สถานะยกเลิกแทน)" };
  }

  // สถานีที่มีผลตรวจแล้วลบไม่ได้ (station_checks → stations RESTRICT) · สถานีเปล่าลบตามสัญญา
  const stations = await supabase.from("stations").select("id").eq("contract_id", contractId);
  if (stations.error) return { ok: false, error: describeDbError(stations.error, "delete") };
  const stationIds = ((stations.data ?? []) as { id: string }[]).map((s) => s.id);
  for (let i = 0; i < stationIds.length; i += CHUNK) {
    const checks = await supabase
      .from("station_checks")
      .select("id", { count: "exact", head: true })
      .in("station_id", stationIds.slice(i, i + CHUNK));
    if (checks.error) return { ok: false, error: describeDbError(checks.error, "delete") };
    if ((checks.count ?? 0) > 0) {
      return {
        ok: false,
        error: "ลบไม่ได้ เพราะสัญญานี้มีสถานีที่ตรวจแล้ว (ให้ใช้สถานะยกเลิกแทน)",
      };
    }
  }
  return { ok: true };
}

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

/** ลบสัญญา (และไฟล์แนบใน Storage + ลูกค้าที่ไม่เหลือสัญญา) — ทำได้เฉพาะสัญญาที่ยังไม่มีผลบริการ */
export async function deleteContract(
  supabase: SupabaseClient,
  contractId: string,
  customerId: string,
): Promise<DeleteResult> {
  // ตรวจก่อนแตะ Storage — ลบไม่ได้ต้องหยุดตรงนี้ ไม่ให้ไฟล์หายโดยสัญญายังอยู่
  const deletable = await checkContractDeletable(supabase, contractId);
  if (!deletable.ok) return deletable;

  // เก็บ path ของไฟล์ไว้ก่อน — ต้องลบ object ตอนที่แถวสัญญายังอยู่ (policy ของ bucket อ่านสถานะสัญญา)
  const files = await supabase
    .from("contract_files")
    .select("storage_path")
    .eq("contract_id", contractId);
  if (files.error) return { ok: false, error: describeDbError(files.error, "delete") };
  const paths = ((files.data ?? []) as { storage_path: string }[]).map((f) => f.storage_path);

  // ลบไม่ครบ (เช่น RLS ปฏิเสธแบบไม่ error) = หยุด ไม่ลบสัญญาต่อ (ลบสัญญาแล้ว policy ของ bucket ลบไฟล์ที่เหลือไม่ได้)
  const removed = await removeObjects(supabase, paths);
  if (!removed.ok) return { ok: false, error: removed.error };

  // .select("id") เพื่อรู้ว่าลบได้จริง — RLS ปฏิเสธแบบไม่ error จะได้ 0 แถว (ห้ามบอกว่าลบแล้วทั้งที่ยังอยู่)
  const del = await supabase.from("contracts").delete().eq("id", contractId).select("id");
  if (del.error) return { ok: false, error: describeDbError(del.error, "delete") };
  if ((del.data ?? []).length === 0) {
    return {
      ok: false,
      error: "ลบสัญญาไม่สำเร็จ (ไม่มีสิทธิ์ลบ หรือสัญญาถูกลบไปแล้ว) · ไฟล์แนบอาจถูกลบไปแล้ว แจ้งผู้ดูแลระบบ",
    };
  }

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
