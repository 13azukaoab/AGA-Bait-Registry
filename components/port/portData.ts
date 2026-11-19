/**
 * ชั้นอ่านข้อมูลหน้า "ลงข้อมูล Port ต่างจังหวัด" (ฝั่ง server จาก page.tsx)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้จริง (host) — RLS ทำงานครบ · ไม่ใช้ service role
 *   * อ่าน: สาขาต่างจังหวัด (branches.division = province) จับคู่กับ `BRANCHES` ด้วยชื่อเพื่อเอาชื่อเขต ·
 *     snapshot ของเดือนที่เลือก + ย้อนหลัง 24 เดือน (หาค่าล่าสุดก่อนหน้าไว้ยกค่า) · เกณฑ์ Tier ทุกชุด ·
 *     สถานะปิดเดือน (list_month_closures) · ชื่อผู้ยืนยัน · จำนวนครั้งที่แก้หลังปิด (list_post_close_edits)
 *   * อ่านข้อมูลหลักพลาด = คืน null (หน้าแจ้งข้อผิดพลาด ไม่แสดงเหมือนไม่มีข้อมูล) · ชื่อผู้ยืนยัน/จำนวนแก้หลังปิดพลาด = ข้ามไป
 *   * ไม่ดึงข้อความ error ดิบมาที่หน้า
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { BRANCHES } from "@/lib/dashboard/branches";
import { monthKey } from "@/lib/rules/monthKey";
import type { TierRule } from "@/lib/rules/types";
import { currentBangkokMonth, isMonthKey, shiftMonth } from "@/lib/service/months";
import { TIER_RULE_COLUMNS, toTierRules, type TierRuleRow } from "@/lib/tierRules";

import { buildMonthList, type ClosureRow, type MonthEntry } from "@/components/months/monthsLogic";

import { resolveBranchState, SNAP_COLUMNS, type BranchState, type SnapRow } from "./portLogic";

export const PORT_BRANCH_COUNT = 19;
/** ย้อนหลังกี่เดือนเพื่อหาค่าล่าสุดก่อนหน้า */
const LOOKBACK_MONTHS = 24;

export interface PortBranch {
  index: number;
  id: string;
  area: string;
  name: string;
  state: BranchState;
  confirmerName: string | null;
}

export interface PortPageData {
  month: string;
  /** 'OCT.26' */
  monthLabelKey: string;
  months: MonthEntry[];
  provinceClosed: boolean;
  closedAt: string | null;
  closedByName: string | null;
  /** จำนวนครั้งที่แก้หลังปิด (null = อ่านไม่ได้) */
  editsAfterClose: number | null;
  branches: PortBranch[];
  rules: TierRule[] | null;
}

/** เลือกเดือนจาก ?month= — ผิดรูปแบบ/นอกรายการ = เดือนล่าสุดในรายการ */
export function pickMonth(param: string | undefined, months: readonly MonthEntry[], current: string): string {
  if (param && isMonthKey(param) && months.some((m) => m.month === param)) return param;
  return months[0]?.month ?? current;
}

export async function loadPortData(
  supabase: SupabaseClient,
  monthParam: string | undefined,
  now: Date = new Date(),
): Promise<PortPageData | null> {
  const current = currentBangkokMonth(now);

  const [app, closures] = await Promise.all([
    supabase.from("app_settings").select("go_live_month").maybeSingle(),
    supabase.rpc("list_month_closures", { p_from: null, p_to: null }),
  ]);
  if (app.error || closures.error) return null;
  const goLive = (app.data as { go_live_month: string | null } | null)?.go_live_month ?? null;
  const closureRows = (closures.data ?? []) as ClosureRow[];
  const months = buildMonthList({
    currentMonth: current,
    goLiveMonth: goLive ? goLive.slice(0, 7) : null,
    closures: closureRows,
  });
  const month = pickMonth(monthParam, months, current);
  const entry = months.find((m) => m.month === month);
  const closureRow = closureRows.find((c) => c.month_key === month && c.scope === "province") ?? null;

  const { data: dbBranches, error: brErr } = await supabase
    .from("branches")
    .select("id, name")
    .eq("division", "province");
  if (brErr || !dbBranches) return null;
  const idByName = new Map((dbBranches as Array<{ id: string; name: string }>).map((b) => [b.name, b.id]));

  const provinceConst = BRANCHES.filter((b) => b.division === "province");
  const idOf = provinceConst.map((b) => idByName.get(b.branch));
  if (provinceConst.length !== PORT_BRANCH_COUNT || idOf.some((x) => !x)) return null;
  const ids = idOf as string[];

  const [snaps, rulesRes] = await Promise.all([
    supabase
      .from("monthly_branch_snapshots")
      .select(SNAP_COLUMNS)
      .in("branch_id", ids)
      .gte("month_key", shiftMonth(month, -LOOKBACK_MONTHS))
      .lte("month_key", month)
      .limit(5000),
    supabase.from("tier_rules").select(TIER_RULE_COLUMNS),
  ]);
  if (snaps.error || !snaps.data) return null;
  const rows = snaps.data as unknown as SnapRow[];
  const rules = rulesRes.error || !rulesRes.data ? null : toTierRules(rulesRes.data as TierRuleRow[]);

  // ชื่อผู้ยืนยัน — ไม่สำคัญพอจะทำให้หน้าล้ม
  const confirmerIds = [...new Set(rows.filter((r) => r.month_key === month).map((r) => r.confirmed_by).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (confirmerIds.length > 0) {
    const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", confirmerIds);
    for (const p of (data ?? []) as Array<{ user_id: string; display_name: string | null }>) {
      if (p.display_name) names.set(p.user_id, p.display_name);
    }
  }

  let editsAfterClose: number | null = null;
  if (entry?.province.status === "closed") {
    const { data, error } = await supabase.rpc("list_post_close_edits", { p_month: month, p_scope: "province" });
    if (!error && Array.isArray(data)) editsAfterClose = data.length;
  }

  const branches: PortBranch[] = provinceConst.map((b, i) => {
    const id = ids[i] as string; // ตรวจครบแล้วข้างบน (idOf ไม่มี undefined)
    const state = resolveBranchState(rows.filter((r) => r.branch_id === id), month);
    return {
      index: i,
      id,
      area: b.area,
      name: b.branch,
      state,
      confirmerName: state.confirmedBy ? (names.get(state.confirmedBy) ?? null) : null,
    };
  });

  return {
    month,
    monthLabelKey: monthKey(month),
    months,
    provinceClosed: entry?.province.status === "closed",
    closedAt: closureRow?.closed_at ?? null,
    closedByName: closureRow?.closed_by_name ?? null,
    editsAfterClose,
    branches,
    rules,
  };
}
