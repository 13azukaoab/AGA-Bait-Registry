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

// ───────────── ปิดสัญญา (รอ BE M44 · DECISIONS 2.99) ─────────────
// ห้าม UPDATE contracts ตรง — เรียกผ่าน RPC เท่านั้น · ชื่อ/พารามิเตอร์ด้านล่างแก้ที่จุดเดียวเมื่อ BE แจ้ง signature จริง
/** false = ซ่อนปุ่ม "ปิดสัญญา" (RPC ยังไม่มีบน main) — เปลี่ยนเป็น true เมื่อ RPC ขึ้นแล้ว */
export const CLOSE_CONTRACT_AVAILABLE = true;
export const CLOSE_CONTRACT_RPC = "close_contract";
export const CLOSE_CONTRACT_PARAM = "p_contract_id";
export const CLOSE_CONTRACT_NOTE_PARAM = "p_note";
export const CLOSE_NOTE_MAX = 500;

export type CloseResult = { ok: true; igRemaining: number } | { ok: false; error: CollectError };

/** ข้อความหลังปิดสำเร็จ — บอกจำนวน IG ที่ยังค้างเก็บถ้ามี */
export function closeSuccessMessage(igRemaining: number): string {
  return igRemaining > 0 ? `ปิดสัญญาแล้ว · ยังค้างเก็บ ${igRemaining} จุด` : "ปิดสัญญาแล้ว";
}

export function buildClosePayload(contractId: string, note: string): Record<string, string | null> {
  const n = note.trim();
  return { [CLOSE_CONTRACT_PARAM]: contractId, [CLOSE_CONTRACT_NOTE_PARAM]: n === "" ? null : n };
}

/** ผลของ close_contract = TABLE(contract_id, status, closed_at, updated_at, ig_remaining) → อ่าน ig_remaining */
export function parseCloseResult(data: unknown): number | null {
  const first = Array.isArray(data) ? data[0] : data;
  if (!first || typeof first !== "object") return null;
  const n = (first as { ig_remaining?: unknown }).ig_remaining;
  return typeof n === "number" ? n : null;
}

export async function closeContract(supabase: SupabaseClient, contractId: string, note = ""): Promise<CloseResult> {
  if (!CLOSE_CONTRACT_AVAILABLE) {
    return { ok: false, error: { message: "ยังปิดสัญญาจากหน้านี้ไม่ได้", isBug: false, logCode: "unavailable" } };
  }
  const { data, error } = await supabase.rpc(CLOSE_CONTRACT_RPC, buildClosePayload(contractId, note));
  if (error) {
    const described = describeCollectError(error);
    console.error("[collection] close RPC error code", described.logCode);
    return { ok: false, error: described };
  }
  return { ok: true, igRemaining: parseCloseResult(data) ?? 0 };
}
