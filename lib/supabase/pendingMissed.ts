/**
 * ดึงรายการ "ตกบริการรอตัดสิน" (RPC list_pending_missed_services) ให้ครบ — ใช้ร่วมกันทั้ง /todo และ /collection
 *
 * Logic summary:
 *   * PostgREST ตัดผล RPC ที่ max_rows (1,000) เงียบๆ → ขอทุกสาขารวมเดียวก่อน
 *   * ถ้าได้ครบ 1,000 แถว = อาจถูกตัด → ดึงซ้ำ "รายสาขา" แล้วรวม (กันซ้ำด้วย contract_id|missed_month)
 *   * สาขาใดยังเต็มเพดานอีก → `truncated = true` ให้หน้าจอเตือน (ห้ามตัดเงียบ)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { KEYSET_PAGE_SIZE as MAX_ROWS } from "./fetchAll";

export type PendingRow = {
  contract_id: string;
  branch_id: string;
  missed_month: string;
  last_service_month: string;
  makeup_deadline_month: string;
  past_deadline: boolean;
};

/**
 * ตกบริการรอตัดสิน (RPC list_pending_missed_services · ผลถูกตัดที่ max_rows 1,000)
 * ครั้งแรกขอทุกสาขารวมเดียว · ถ้าได้เต็ม 1,000 = อาจถูกตัด → ดึงซ้ำ "รายสาขา" (แต่ละสาขาน้อยกว่าเพดาน) แล้วรวม
 * สาขาใดยังเต็มเพดานอีก → `truncated = true` ให้หน้าจอเตือน (ไม่ตัดเงียบ)
 */
export async function loadPendingMissedRows(
  supabase: SupabaseClient,
  month: string,
  branchIds: readonly string[],
): Promise<{ rows: PendingRow[]; error: string | null; truncated: boolean }> {
  const call = (branchId: string | null) =>
    supabase.rpc("list_pending_missed_services", { p_branch_id: branchId, p_month: `${month}-01` });
  const first = await call(null);
  if (first.error) return { rows: [], error: first.error.message, truncated: false };
  const firstRows = (first.data ?? []) as PendingRow[];
  if (firstRows.length < MAX_ROWS) return { rows: firstRows, error: null, truncated: false };

  const per = await Promise.all(branchIds.map((id) => call(id)));
  const bad = per.find((r) => r.error);
  if (bad?.error) return { rows: [], error: bad.error.message, truncated: false };
  const merged = new Map<string, PendingRow>();
  let truncated = false;
  for (const r of per) {
    const rows = (r.data ?? []) as PendingRow[];
    if (rows.length >= MAX_ROWS) truncated = true;
    for (const row of rows) merged.set(`${row.contract_id}|${row.missed_month}`, row);
  }
  return { rows: [...merged.values()], error: null, truncated };
}
