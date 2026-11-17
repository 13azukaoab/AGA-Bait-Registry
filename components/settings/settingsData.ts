/**
 * ชั้นอ่านข้อมูลหน้า "ตั้งค่า" (ฝั่ง server จาก page.tsx)
 *
 * Logic summary:
 *   * client ของผู้ใช้จริง (host) — RLS ทำงานตามสิทธิ์ · ไม่ใช้ service role · select ระบุคอลัมน์ ไม่ใช้ `select('*')`
 *   * เกณฑ์ Tier อ่าน "ทุกชุด" จาก `tier_rules` (ห้าม hardcode) · เดือนที่ปิดล่าสุดจาก `month_closures`
 *   * `app_settings` แถวเดียว: `go_live_month` (แก้ไม่ได้จากหน้าจอ) + `workload_hours_per_person`
 *   * "สัญญาที่ใช้งานอยู่ต่อทีม" นับด้วย count รายทีม (head) — ไม่ดึงแถวมาเกินเพดาน 1,000 ของ PostgREST
 *   * อ่านตารางหลักพลาดข้อใดข้อหนึ่ง = `error: true` (หน้าแสดงข้อความ ไม่แสดงค่าว่างเหมือนไม่มีข้อมูล)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { currentBangkokMonth } from "@/lib/service/months";
import { isTeamKind, type TeamKind } from "@/lib/service/teamKind";

import type { CustomerTypeRow, TeamRow } from "./settingsLogic";
import { groupRuleSets, type RuleSet, type TierRuleDbRow } from "./tierLogic";

export type SettingsData = {
  ruleSets: RuleSet[];
  /** เดือนที่ปิดล่าสุด ('YYYY-MM') · null = ยังไม่เคยปิด */
  lastClosedMonth: string | null;
  goLiveMonth: string | null;
  workloadHours: number;
  teams: TeamRow[];
  customerTypes: CustomerTypeRow[];
  currentMonth: string;
};

type TeamDb = {
  id: string;
  code: string;
  name: string;
  kind: string;
  is_system: boolean;
  is_active: boolean;
  headcount: number;
};

export async function loadSettingsData(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{ data: SettingsData | null }> {
  const [tier, closures, app, teams, types] = await Promise.all([
    supabase.from("tier_rules").select("tier, min_annual, effective_month, change_reason"),
    supabase.from("month_closures").select("month_key").order("month_key", { ascending: false }).limit(1),
    supabase.from("app_settings").select("go_live_month, workload_hours_per_person").maybeSingle(),
    supabase.from("teams").select("id, code, name, kind, is_system, is_active, headcount").order("code"),
    supabase.from("customer_types").select("code, label, group_label, sort_order").order("sort_order"),
  ]);
  if (tier.error || closures.error || app.error || teams.error || types.error || !app.data) {
    return { data: null };
  }

  const teamRows = ((teams.data ?? []) as TeamDb[]).filter((t) => isTeamKind(t.kind));
  const counts = await Promise.all(
    teamRows.map(async (t) => {
      const { count, error } = await supabase
        .from("contract_teams")
        .select("team_id, contracts!inner(status)", { count: "exact", head: true })
        .eq("team_id", t.id)
        .eq("contracts.status", "active");
      return error ? null : (count ?? 0);
    }),
  );

  const appRow = app.data as { go_live_month: string; workload_hours_per_person: number | string };
  const lastClosed = (closures.data as { month_key: string }[] | null)?.[0]?.month_key ?? null;

  return {
    data: {
      ruleSets: groupRuleSets((tier.data ?? []) as TierRuleDbRow[]),
      lastClosedMonth: lastClosed && /^\d{4}-\d{2}$/.test(lastClosed) ? lastClosed : null,
      goLiveMonth: typeof appRow.go_live_month === "string" ? appRow.go_live_month.slice(0, 7) : null,
      workloadHours: Number(appRow.workload_hours_per_person),
      teams: teamRows.map((t, i) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        kind: t.kind as TeamKind,
        isSystem: t.is_system,
        isActive: t.is_active,
        headcount: t.headcount,
        activeContracts: counts[i] ?? null,
      })),
      customerTypes: ((types.data ?? []) as { code: string; label: string; group_label: string; sort_order: number }[]).map(
        (r) => ({ code: r.code, label: r.label, groupLabel: r.group_label, sortOrder: r.sort_order }),
      ),
      currentMonth: currentBangkokMonth(now),
    },
  };
}
