/**
 * ชั้นอ่านข้อมูลหน้า "ส่งข้อมูล และสรุปงานประจำเดือน" (ฝั่ง server จาก page.tsx)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้จริง (RLS/สิทธิ์ RPC ทำงาน) — ไม่ใช้ service role
 *   * สถานะปิดเดือนจาก RPC list_month_closures · สถานะส่ง Dashboard จาก get_sync_status (แค่เวลา/ผล ไม่มี error ดิบ)
 *   * ปุ่มปิดต่อส่วนมาจาก RPC can_close_month_part · go_live จาก app_settings (อ่านได้ทุก role ที่ล็อกอิน)
 *   * อ่านพลาด = คืน null (หน้าแจ้งข้อผิดพลาด ไม่โชว์ค่าว่างเหมือนไม่มีข้อมูล)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { currentBangkokMonth } from "@/lib/service/months";

import {
  buildMonthList,
  summarizeSync,
  type ClosureRow,
  type MonthEntry,
  type Perms,
  type SyncStatusRow,
} from "./monthsLogic";

export interface MonthsPageData {
  perms: Perms;
  months: MonthEntry[];
  goLiveMonth: string | null;
  sync: { lastSuccessAt: string | null; latestFailed: boolean };
}

export async function loadMonthsData(
  supabase: SupabaseClient,
  role: string,
  now: Date = new Date(),
): Promise<MonthsPageData | null> {
  const [app, closures, status, central, province] = await Promise.all([
    supabase.from("app_settings").select("go_live_month").maybeSingle(),
    supabase.rpc("list_month_closures", { p_from: null, p_to: null }),
    supabase.rpc("get_sync_status"),
    supabase.rpc("can_close_month_part", { p_scope: "central" }),
    supabase.rpc("can_close_month_part", { p_scope: "province" }),
  ]);
  if (app.error || closures.error || status.error || central.error || province.error) return null;

  const goLive = (app.data as { go_live_month: string | null } | null)?.go_live_month ?? null;
  const goLiveMonth = goLive ? goLive.slice(0, 7) : null;

  return {
    perms: {
      isHost: role === "host",
      canCloseCentral: central.data === true,
      canCloseProvince: province.data === true,
    },
    goLiveMonth,
    months: buildMonthList({
      currentMonth: currentBangkokMonth(now),
      goLiveMonth,
      closures: (closures.data ?? []) as ClosureRow[],
    }),
    sync: summarizeSync((status.data ?? []) as SyncStatusRow[]),
  };
}
