/**
 * ตัวเรียก RPC อ่านอย่างเดียวของหน้าปิดเดือน (M40) — ใช้ได้ทั้ง server (page) และ browser (client component)
 *
 * Logic summary:
 *   * get_central_readiness(p_month)        → รายชื่อสาขาส่วนกลางที่ยังไม่พร้อมปิด (0 แถว = พร้อม)
 *   * list_post_close_edits(p_month, scope) → รายการแก้หลังปิด (host ได้ทั้ง 2 scope · recorder ได้ central เท่านั้น)
 *   * กัน recorder เรียก scope province ตั้งแต่ฝั่งเว็บ (ไม่ยิง RPC เลย) — ความปลอดภัยจริงอยู่ที่ RPC (42501)
 *   * error แปลงเป็น code เท่านั้น (forbidden / load_failed) — ไม่คืน/ไม่ log ข้อความดิบจาก DB
 *   * รับ client เข้ามาเอง (เทสด้วย client จำลองได้ ไม่ต่อเครือข่าย)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canListPostCloseEdits,
  canViewReadiness,
  parsePostCloseEdits,
  parseReadinessRows,
  type Perms,
  type PostCloseEdit,
  type ReadinessBranch,
  type Scope,
} from "./monthsLogic";

export type RpcOutcome<T> = { kind: "ok"; rows: T } | { kind: "error"; code: "forbidden" | "load_failed" };

type RpcClient = Pick<SupabaseClient, "rpc">;

function errorCode(err: { code?: string } | null): "forbidden" | "load_failed" {
  return err?.code === "42501" ? "forbidden" : "load_failed";
}

export async function fetchCentralReadiness(supabase: RpcClient, month: string, perms: Perms): Promise<RpcOutcome<ReadinessBranch[]>> {
  if (!canViewReadiness(perms)) return { kind: "error", code: "forbidden" };
  try {
    const res = await supabase.rpc("get_central_readiness", { p_month: month });
    if (res.error) return { kind: "error", code: errorCode(res.error) };
    const rows = parseReadinessRows(res.data);
    return rows ? { kind: "ok", rows } : { kind: "error", code: "load_failed" };
  } catch {
    return { kind: "error", code: "load_failed" };
  }
}

export async function fetchPostCloseEdits(supabase: RpcClient, month: string, scope: Scope, perms: Perms): Promise<RpcOutcome<PostCloseEdit[]>> {
  // recorder ห้ามเรียก scope province — ไม่ยิง RPC
  if (!canListPostCloseEdits(perms, scope)) return { kind: "error", code: "forbidden" };
  try {
    const res = await supabase.rpc("list_post_close_edits", { p_month: month, p_scope: scope });
    if (res.error) return { kind: "error", code: errorCode(res.error) };
    const rows = parsePostCloseEdits(res.data);
    return rows ? { kind: "ok", rows } : { kind: "error", code: "load_failed" };
  } catch {
    return { kind: "error", code: "load_failed" };
  }
}
