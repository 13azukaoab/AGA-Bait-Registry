/**
 * ตัวเรียก RPC ของหน้ากรอกข้อมูลทำบริการ (ฝั่ง client · Supabase client ของผู้ใช้จริง · RLS ทำงาน)
 *
 * Logic summary:
 *   * `initialize_contract_stations(p_contract_id, p_ig_nos, p_ic_nos, p_transfer_station_ids)` — ครั้งเดียวต่อสัญญา
 *       ตอบ SV007 (ตั้งไปแล้ว — เช่น กดซ้ำหลังบันทึกผลไม่สำเร็จ) ถือว่าผ่าน แล้วให้ผู้เรียกโหลดสถานีใหม่ต่อ
 *   * `save_service_visit(p jsonb)` — 1 การเรียก = 1 transaction (สร้าง/แก้การเข้า · ทีม · ผลตรวจ · งานซ่อม)
 *   * `delete_service_visit(p_visit_id)` — ย้อนผลงานซ่อมแล้วลบการเข้า
 *   * ทุกฟังก์ชันคืน `{ ok: true } | { ok: false, error: ServiceError }` (แปลเป็นไทยแล้ว · บั๊กหน้าจอ console.error ดิบ)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SavePayload } from "./buildPayload";
import { buildMakeupPayload } from "./makeup";
import { describeServiceError, type DbErrorLike, type ServiceError } from "./errors";
import type { InitPlan } from "./setup";

export type RpcResult = { ok: true; alreadyDone?: boolean } | { ok: false; error: ServiceError };

function fail(error: DbErrorLike): RpcResult {
  const described = describeServiceError(error);
  if (described.isBug) console.error("[service] RPC error", error);
  return { ok: false, error: described };
}

export async function initializeStations(
  supabase: SupabaseClient,
  contractId: string,
  plan: InitPlan,
): Promise<RpcResult> {
  const { error } = await supabase.rpc("initialize_contract_stations", {
    p_contract_id: contractId,
    p_ig_nos: plan.igNos,
    p_ic_nos: plan.icNos,
    p_transfer_station_ids: plan.transferIds,
  });
  if (!error) return { ok: true };
  if (error.code === "SV007") return { ok: true, alreadyDone: true };
  return fail(error);
}

export async function saveServiceVisit(supabase: SupabaseClient, payload: SavePayload): Promise<RpcResult> {
  const { error } = await supabase.rpc("save_service_visit", { p: payload });
  return error ? fail(error) : { ok: true };
}

/**
 * บันทึกบริการชดเชย (DECISIONS 2.96): `save_makeup_service_visit(p)` = payload ของ save_service_visit + makeup_for_month
 * ผูกการเข้าเข้ากับเดือนที่ตกใน transaction เดียว · error แปลเป็นไทย · log เฉพาะรหัส error (ไม่ log ข้อความดิบ/ข้อมูลลูกค้า — PDPA)
 */
export async function saveMakeupServiceVisit(supabase: SupabaseClient, payload: SavePayload, missedMonth: string): Promise<RpcResult> {
  const { error } = await supabase.rpc("save_makeup_service_visit", { p: buildMakeupPayload(payload, missedMonth) });
  if (!error) return { ok: true };
  const described = describeServiceError(error);
  if (described.isBug) console.error("[service] makeup RPC error code", error.code ?? "unknown");
  return { ok: false, error: described };
}

export async function deleteServiceVisit(supabase: SupabaseClient, visitId: string): Promise<RpcResult> {
  const { error } = await supabase.rpc("delete_service_visit", { p_visit_id: visitId });
  return error ? fail(error) : { ok: true };
}
