/**
 * ตัวเรียก RPC เก็บ/ไม่เก็บ IG (ฝั่ง client · Supabase client ของผู้ใช้จริง · RLS/สิทธิ์ตรวจที่ DB)
 *
 * Logic summary:
 *   * `collect_ig_stations(p_contract_id, p_count, p_on, p_team_id, p_station_nos)` — บันทึกว่าเก็บแล้ว
 *   * `skip_ig_collection(p_contract_id, p_count, p_on, p_team_id, p_reason, p_station_nos)` — ไม่เก็บ + เหตุผล
 *   * หน้าจอส่ง "จำนวน" (p_count) ระบบเลือก IG ที่ค้างเลขน้อยสุดก่อน · ส่ง `p_station_nos: null` ชัดเจน
 *   * `stations.collected_at` เขียนตรงไม่ได้ (42501) — ต้องผ่าน RPC เท่านั้น
 *   * คืนผลเป็น `{ ok: true, result } | { ok: false, error }` (แปลไทยแล้ว · log เฉพาะ code)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { describeCollectError, type CollectError } from "./collectionErrors";

export const REASON_MAX = 300;

export interface ActionInput {
  contractId: string;
  count: number;
  /** 'YYYY-MM-DD' */
  date: string;
  teamId: string;
}

export interface CollectPayload {
  p_contract_id: string;
  p_count: number;
  p_on: string;
  p_team_id: string;
  p_station_nos: null;
}

export interface SkipPayload extends CollectPayload {
  p_reason: string;
}

export function buildCollectPayload(input: ActionInput): CollectPayload {
  return {
    p_contract_id: input.contractId,
    p_count: input.count,
    p_on: input.date,
    p_team_id: input.teamId,
    p_station_nos: null,
  };
}

export function buildSkipPayload(input: ActionInput, reason: string): SkipPayload {
  return { ...buildCollectPayload(input), p_reason: reason.trim() };
}

export interface RpcResultData {
  count: number;
  remaining: number;
}

export type ActionResult = { ok: true; result: RpcResultData } | { ok: false; error: CollectError };

function parseResult(data: unknown): RpcResultData | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { count?: unknown; remaining?: unknown };
  return typeof d.count === "number" && typeof d.remaining === "number" ? { count: d.count, remaining: d.remaining } : null;
}

function handle(error: { code?: string; message?: string; details?: string } | null, data: unknown): ActionResult {
  if (error) {
    const described = describeCollectError(error);
    console.error("[collection] RPC error code", described.logCode); // ห้าม log ข้อความดิบ (PDPA)
    return { ok: false, error: described };
  }
  const result = parseResult(data);
  if (!result) {
    console.error("[collection] RPC result shape");
    return { ok: false, error: { message: "ระบบตอบกลับไม่ครบ รีเฟรชหน้าเพื่อตรวจว่าบันทึกแล้วหรือยัง", isBug: true, logCode: "shape" } };
  }
  return { ok: true, result };
}

export async function collectIgStations(supabase: SupabaseClient, input: ActionInput): Promise<ActionResult> {
  const { data, error } = await supabase.rpc("collect_ig_stations", buildCollectPayload(input));
  return handle(error, data);
}

export async function skipIgCollection(supabase: SupabaseClient, input: ActionInput, reason: string): Promise<ActionResult> {
  const { data, error } = await supabase.rpc("skip_ig_collection", buildSkipPayload(input, reason));
  return handle(error, data);
}
