/**
 * ตัวเชื่อม `MonthClosePorts` กับ Supabase จริง (M39) — ใช้ฝั่ง server เท่านั้น
 * - รับ client ของผู้ใช้ (JWT ของ host) · ไม่ใช้ service role · RPC ตรวจ host ซ้ำเองที่ฐานข้อมูล
 * - คำนวณแถวส่วนกลางด้วยทะเบียนชุดเดียวกับตอนส่ง Dashboard (`loadCentralRegistry`)
 * - ส่ง Dashboard ด้วย `runDashboardSync` + ports เดิมของ M27 (GitHub mock ได้ผ่าน options ในเทส)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ClosePartArgs,
  ClosePartResult,
  ClosureScope,
  MonthClosePorts,
  ResyncPartResult,
} from "./monthClose";
import { centralSnapshotPayload } from "./monthClose";
import { runDashboardSync } from "./runSync";
import {
  loadCentralRegistry,
  supabaseSyncPorts,
  type SupabaseSyncPortsOptions,
} from "./supabaseSyncPorts";

/** error ของ RPC → Error ที่พก code/details (ให้ mapMonthCloseError อ่าน) */
function rpcError(error: { message: string; code?: string; details?: string | null }): Error {
  return Object.assign(new Error(error.message), { code: error.code, details: error.details ?? undefined });
}

type Json = Record<string, unknown>;

export function supabaseMonthClosePorts(
  client: SupabaseClient,
  options: SupabaseSyncPortsOptions = {},
): MonthClosePorts {
  return {
    async centralRows(month: string) {
      const loaded = await loadCentralRegistry(client);
      return centralSnapshotPayload(loaded.registry, loaded.branchIdByName, month);
    },

    async closePart(args: ClosePartArgs): Promise<ClosePartResult> {
      const { data, error } = await client.rpc("close_month_part", {
        p_month: args.month,
        p_scope: args.scope,
        p_rows: args.rows,
        p_override_reason: args.overrideReason ?? null,
        p_ack_carried: args.acknowledgeCarried ?? false,
      });
      if (error) throw rpcError(error);
      const d = (data ?? {}) as Json;
      return {
        month: String(d.month),
        scope: d.scope as ClosureScope,
        closedAt: String(d.closed_at),
        overridden: d.overridden === true,
        unconfirmedCount: Number(d.unconfirmed_count ?? 0),
        carriedCount: Number(d.carried_count ?? 0),
      };
    },

    async resyncPart(args): Promise<ResyncPartResult> {
      const { data, error } = await client.rpc("resync_month_part", {
        p_month: args.month,
        p_scope: args.scope,
        p_rows: args.rows,
        p_computed_at: args.computedAt,
      });
      if (error) throw rpcError(error);
      const d = (data ?? {}) as Json;
      return {
        month: String(d.month),
        scope: d.scope as ClosureScope,
        changedBranches: Number(d.changed_branches ?? 0),
      };
    },

    sync: (source) => runDashboardSync(source, supabaseSyncPorts(client, options)),
  };
}

/** แก้ชื่อ/เวลาผู้ปิด (DECISIONS 5.8) — RPC ตรวจ host + ลง audit */
export async function setMonthCloser(
  client: SupabaseClient,
  args: { month: string; scope: ClosureScope; closedBy: string; closedAt: string },
): Promise<void> {
  const { error } = await client.rpc("set_month_closer", {
    p_month: args.month,
    p_scope: args.scope,
    p_closed_by: args.closedBy,
    p_closed_at: args.closedAt,
  });
  if (error) throw rpcError(error);
}
