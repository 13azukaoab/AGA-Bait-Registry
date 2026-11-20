"use server";

/**
 * Server action ของหน้า "ตั้งค่า" (`/admin/settings`)
 *
 * Logic summary:
 *   * **ทุก action เริ่มด้วย `requireHostAction()`** (host เท่านั้น — ตรวจฝั่ง server ทุกคำขอ ไม่พึ่งการซ่อนปุ่ม)
 *     RPC/ตารางยังบังคับ host ที่ DB อีกชั้น (42501 / TM006 / RLS) — ไม่ใช้ service role ที่นี่เลย
 *   * ตรวจ input ซ้ำที่ server ด้วยตัวตรวจเดียวกับหน้าจอ (`tierLogic` / `settingsLogic`) แล้วเรียก RPC ตามชื่อจริงใน migration:
 *       save_tier_rule_set(p jsonb) · save_workload_threshold(p_hours) · set_team_active(p_team_id, p_active) ·
 *       delete_team(p_team_id) · reorder_customer_types(p_codes text[])
 *   * เกณฑ์ Tier ห้าม hardcode: ค่าที่บันทึกมาจากฟอร์มของผู้ใช้เท่านั้น — ที่นี่ไม่มีตัวเลขเกณฑ์
 *   * error ทุกตัวแปลเป็นไทยที่ `components/admin/adminErrors.ts` · ห้าม log ข้อความดิบจาก DB (log เฉพาะ code)
 *   * หน้าจอไม่ต้องรู้ว่ามี `division_scope`/`branch_id` — ทีมใหม่สร้างแบบส่วนกลาง (branch_id = null ตามเฟส 1)
 */
import { revalidatePath } from "next/cache";

import {
  failure,
  failureFromDb,
  type ActionFailure,
  type ActionResult,
} from "@/components/admin/adminErrors";
import { UUID_PATTERN, requireHostAction, type HostContext } from "@/components/admin/hostGuard";
import { isTeamKind, type TeamKind } from "@/lib/service/teamKind";

import {
  CONFIRM_PHRASE,
  groupTypes,
  newTypeCode,
  normalizeHint,
  orderWithNewAtGroupEnd,
  parseHeadcount,
  parseSaveTeamWorkloadResult,
  TM007_MESSAGE,
  validateTeam,
  validateTeamWorkloadInput,
  validateType,
  validateWorkload,
  type CustomerTypeRow,
} from "./settingsLogic";
import {
  REASON_MAX,
  REASON_MIN,
  buildSavePayload,
  isDraftValid,
  parseImpactRows,
  type ImpactRow,
  type TierThresholds,
} from "./tierLogic";

const SETTINGS_PATH = "/admin/settings";

function logCode(where: string, code: string | undefined): void {
  console.error(`[admin/settings] ${where}`, code ?? "unknown");
}

/** log เฉพาะ code แล้วแปลงเป็น failure ภาษาไทย */
function dbFailure(where: string, error: { code?: string; message?: string; details?: string | null }) {
  logCode(where, error.code);
  return failureFromDb(error);
}

// ---------------------------------------------------------------------------
// เกณฑ์ Tier
// ---------------------------------------------------------------------------

export async function saveTierRuleSetAction(input: {
  effectiveMonth: string;
  m: number;
  l: number;
  xl: number;
  reason: string;
  confirm: string;
}): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;

  const t: TierThresholds = { m: Number(input?.m), l: Number(input?.l), xl: Number(input?.xl) };
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (
    typeof input?.effectiveMonth !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.effectiveMonth) ||
    !isDraftValid(t) ||
    reason.length < REASON_MIN ||
    reason.length > REASON_MAX
  ) {
    return failure("INVALID_INPUT");
  }
  if (String(input.confirm ?? "").trim() !== CONFIRM_PHRASE) return failure("BAD_CONFIRM");

  const { error } = await guard.supabase.rpc("save_tier_rule_set", {
    p: buildSavePayload(t, input.effectiveMonth, reason),
  });
  if (error) return dbFailure("save_tier_rule_set", error);
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/**
 * ดูผลกระทบก่อนบันทึกเกณฑ์ (ดูอย่างเดียว ไม่เขียนข้อมูล) — RPC `preview_tier_rule_change(p_effective_month, p_rules)`
 * ได้เฉพาะ host (DB ตรวจซ้ำ 42501) · ตัวเลขประมาณ: นับทุกสัญญาที่ยังไม่ถูกยกเลิก (DECISIONS 2.74) · ไม่มีชื่อลูกค้า
 */
export async function previewTierRuleChangeAction(input: {
  effectiveMonth: string;
  m: number;
  l: number;
  xl: number;
}): Promise<ActionResult<{ rows: ImpactRow[] }>> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;

  const t: TierThresholds = { m: Number(input?.m), l: Number(input?.l), xl: Number(input?.xl) };
  if (
    typeof input?.effectiveMonth !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.effectiveMonth) ||
    !isDraftValid(t)
  ) {
    return failure("INVALID_INPUT");
  }

  const { data, error } = await guard.supabase.rpc("preview_tier_rule_change", {
    p_effective_month: `${input.effectiveMonth}-01`,
    p_rules: { min_m: t.m, min_l: t.l, min_xl: t.xl },
  });
  if (error) return dbFailure("preview_tier_rule_change", error);
  const rows = parseImpactRows(data);
  if (rows === null) {
    logCode("preview_tier_rule_change(shape)", "BAD_SHAPE");
    return failure("UPSTREAM_ERROR");
  }
  return { ok: true, rows };
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

export async function saveWorkloadAction(input: {
  hours: number;
  confirm: string;
}): Promise<ActionResult<{ saved: number }>> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;

  const hours = Number(input?.hours);
  if (!Number.isFinite(hours) || validateWorkload(hours) !== null) return failure("WL001");
  if (String(input.confirm ?? "").trim() !== CONFIRM_PHRASE) return failure("BAD_CONFIRM");

  const { data, error } = await guard.supabase.rpc("save_workload_threshold", { p_hours: hours });
  if (error) return dbFailure("save_workload_threshold", error);
  revalidatePath(SETTINGS_PATH);
  return { ok: true, saved: Number(data) };
}

/**
 * เกณฑ์ Workload รายทีม (DECISIONS 2.88 · BE M42) — host เท่านั้น
 * hours = null → กลับไปใช้ค่ากลาง · ต้องพิมพ์ "ยืนยันแก้ไข" (DB บังคับซ้ำด้วย p_confirm → TM007)
 */
export async function saveTeamWorkloadAction(input: {
  teamId: string;
  hours: number | null;
  confirm: string;
}): Promise<ActionResult<{ workloadHours: number | null; effectiveHours: number | null }>> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;

  if (typeof input?.teamId !== "string" || !UUID_PATTERN.test(input.teamId)) return failure("INVALID_INPUT");
  if (!validateTeamWorkloadInput(input.hours)) return failure("WL001");
  if (String(input.confirm ?? "").trim() !== CONFIRM_PHRASE) return failure("BAD_CONFIRM");

  const { data, error } = await guard.supabase.rpc("save_team_workload_hours", {
    p_team_id: input.teamId,
    p_hours: input.hours,
    p_confirm: true,
  });
  if (error) {
    logCode("save_team_workload_hours", error.code);
    return error.code === "TM007" ? { ok: false, code: "TM007", message: TM007_MESSAGE } : failureFromDb(error);
  }
  revalidatePath(SETTINGS_PATH);
  // บันทึกสำเร็จแล้ว — ถ้ารูปผลคืนแปลกก็ยังถือว่าสำเร็จ (หน้า refresh อ่านค่าใหม่เอง)
  const parsed = parseSaveTeamWorkloadResult(data);
  return {
    ok: true,
    workloadHours: parsed ? parsed.workloadHours : input.hours,
    effectiveHours: parsed ? parsed.effectiveHours : null,
  };
}

// ---------------------------------------------------------------------------
// ทีม
// ---------------------------------------------------------------------------

async function existingTeamCodes(guard: HostContext): Promise<string[] | ActionFailure> {
  const { data, error } = await guard.supabase.from("teams").select("code");
  if (error) return dbFailure("teams.select", error);
  return ((data ?? []) as { code: string }[]).map((r) => r.code);
}

export async function createTeamAction(input: {
  code: string;
  name: string;
  kind: string;
  headcount: number;
}): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;

  const code = String(input?.code ?? "").trim();
  const name = String(input?.name ?? "").trim();
  if (!isTeamKind(input?.kind)) return failure("INVALID_INPUT");
  const errors = validateTeam(
    { code, name, kind: input.kind, headcount: String(input?.headcount ?? "") },
    "create",
    [],
  );
  if (Object.keys(errors).length > 0) return failure("INVALID_INPUT");

  const codes = await existingTeamCodes(guard);
  if (!Array.isArray(codes)) return codes;
  if (codes.some((c) => c.toLowerCase() === code.toLowerCase())) return failure("23505");

  // ทีมใหม่ = ส่วนกลาง (branch_id null) · is_system ไม่ส่ง (DB ปฏิเสธการตั้งทีมระบบจากหน้าจอ)
  const { error } = await guard.supabase.from("teams").insert({
    code,
    name,
    kind: input.kind,
    headcount: parseHeadcount(String(input.headcount)),
    branch_id: null,
  });
  if (error) return dbFailure("teams.insert", error);
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function updateTeamAction(input: {
  teamId: string;
  name: string;
  kind: string;
  headcount: number;
}): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;
  if (typeof input?.teamId !== "string" || !UUID_PATTERN.test(input.teamId) || !isTeamKind(input?.kind)) {
    return failure("INVALID_INPUT");
  }
  const name = String(input.name ?? "").trim();
  const errors = validateTeam(
    { code: "", name, kind: input.kind, headcount: String(input.headcount ?? "") },
    "edit",
    [],
  );
  if (Object.keys(errors).length > 0) return failure("INVALID_INPUT");

  // ส่ง kind เฉพาะเมื่อเปลี่ยนจริง (ทีมระบบ/ทีมที่มีงานผูก DB กันเอง: TM002/TM003)
  const { data: current, error: readError } = await guard.supabase
    .from("teams")
    .select("kind")
    .eq("id", input.teamId)
    .maybeSingle();
  if (readError) return dbFailure("teams.read", readError);
  if (!current) return failure("NOT_FOUND");

  const values: Record<string, unknown> = { name, headcount: parseHeadcount(String(input.headcount)) };
  if ((current as { kind: TeamKind }).kind !== input.kind) values.kind = input.kind;

  const { data, error } = await guard.supabase
    .from("teams")
    .update(values)
    .eq("id", input.teamId)
    .select("id");
  if (error) return dbFailure("teams.update", error);
  if (!data || data.length === 0) return failure("NOT_FOUND");
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function setTeamActiveAction(teamId: string, active: boolean): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;
  if (typeof teamId !== "string" || !UUID_PATTERN.test(teamId) || typeof active !== "boolean") {
    return failure("INVALID_INPUT");
  }
  const { error } = await guard.supabase.rpc("set_team_active", { p_team_id: teamId, p_active: active });
  if (error) return dbFailure("set_team_active", error);
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function deleteTeamAction(teamId: string): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;
  if (typeof teamId !== "string" || !UUID_PATTERN.test(teamId)) return failure("INVALID_INPUT");
  const { error } = await guard.supabase.rpc("delete_team", { p_team_id: teamId });
  if (error) return dbFailure("delete_team", error);
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// ประเภทลูกค้า
// ---------------------------------------------------------------------------

type TypeDb = {
  code: string;
  label: string;
  group_label: string;
  sort_order: number;
  is_active: boolean;
  hint: string | null;
};

async function loadTypes(guard: HostContext): Promise<CustomerTypeRow[] | ActionFailure> {
  const { data, error } = await guard.supabase
    .from("customer_types")
    .select("code, label, group_label, sort_order, is_active, hint")
    .order("sort_order");
  if (error) return dbFailure("customer_types.select", error);
  return ((data ?? []) as TypeDb[]).map((r) => ({
    code: r.code,
    label: r.label,
    groupLabel: r.group_label,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    hint: r.hint,
  }));
}

/** hint ที่ส่งมา (ไม่ส่ง = ไม่แตะ) → ค่าที่จะเขียน DB · ผิดรูปแบบ = null ให้ผู้เรียกตอบ INVALID_INPUT */
function parseHintInput(raw: unknown): { ok: true; value: string | null | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "string") return { ok: false };
  const n = normalizeHint(raw);
  return n.ok ? { ok: true, value: n.value } : { ok: false };
}

export async function createCustomerTypeAction(input: {
  label: string;
  groupLabel: string;
  hint?: string;
  isActive?: boolean;
}): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;
  const label = String(input?.label ?? "").trim();
  const groupLabel = String(input?.groupLabel ?? "").trim();
  const hint = parseHintInput(input?.hint);
  if (!hint.ok || (input?.isActive !== undefined && typeof input.isActive !== "boolean")) {
    return failure("INVALID_INPUT");
  }

  const all = await loadTypes(guard);
  if (!Array.isArray(all)) return all;
  if (Object.keys(validateType({ label, group: groupLabel }, all)).length > 0) return failure("INVALID_INPUT");

  const code = newTypeCode(all.map((r) => r.code));
  const sortOrder = all.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1;
  const { error } = await guard.supabase.from("customer_types").insert({
    code,
    label,
    group_label: groupLabel,
    sort_order: sortOrder,
    hint: hint.value ?? null,
    is_active: input?.isActive ?? true,
  });
  if (error) return dbFailure("customer_types.insert", error);

  // วางท้ายหมวดของมัน (ล้มได้ — ประเภทยังอยู่ท้ายสุด ผู้ใช้จัดเรียงเองได้)
  const order = orderWithNewAtGroupEnd(groupTypes(all), code, groupLabel);
  const { error: orderError } = await guard.supabase.rpc("reorder_customer_types", { p_codes: order });
  if (orderError) logCode("reorder_customer_types(after insert)", orderError.code);

  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function updateCustomerTypeAction(input: {
  code: string;
  label: string;
  groupLabel: string;
  hint?: string;
  isActive?: boolean;
}): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;
  const code = String(input?.code ?? "");
  const label = String(input?.label ?? "").trim();
  const groupLabel = String(input?.groupLabel ?? "").trim();
  const hint = parseHintInput(input?.hint);
  if (!hint.ok || (input?.isActive !== undefined && typeof input.isActive !== "boolean")) {
    return failure("INVALID_INPUT");
  }

  const all = await loadTypes(guard);
  if (!Array.isArray(all)) return all;
  if (!all.some((r) => r.code === code)) return failure("NOT_FOUND");
  if (Object.keys(validateType({ label, group: groupLabel }, all, code)).length > 0) return failure("INVALID_INPUT");

  // ส่งเฉพาะฟิลด์ที่ผู้เรียกระบุ (ไม่ส่ง = ไม่แตะค่าเดิม)
  const values: Record<string, unknown> = { label, group_label: groupLabel };
  if (hint.value !== undefined) values.hint = hint.value;
  if (input?.isActive !== undefined) values.is_active = input.isActive;

  const { data, error } = await guard.supabase
    .from("customer_types")
    .update(values)
    .eq("code", code)
    .select("code");
  if (error) return dbFailure("customer_types.update", error);
  if (!data || data.length === 0) return failure("NOT_FOUND");
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/** สวิตช์ "ใช้งาน/ปิดใช้" ของแถวประเภท — แก้ `is_active` ตัวเดียว (ไม่แตะชื่อ/หมวด) · host เท่านั้น (RLS + audit เดิม) */
export async function setCustomerTypeActiveAction(code: string, active: boolean): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;
  if (typeof code !== "string" || code === "" || code.length > 60 || typeof active !== "boolean") {
    return failure("INVALID_INPUT");
  }
  const { data, error } = await guard.supabase
    .from("customer_types")
    .update({ is_active: active })
    .eq("code", code)
    .select("code");
  if (error) return dbFailure("customer_types.set_active", error);
  if (!data || data.length === 0) return failure("NOT_FOUND");
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function deleteCustomerTypeAction(code: string): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;
  if (typeof code !== "string" || code === "" || code.length > 60) return failure("INVALID_INPUT");
  // FK customers.customer_type กัน (23503) ถ้ามีลูกค้าใช้อยู่
  const { data, error } = await guard.supabase.from("customer_types").delete().eq("code", code).select("code");
  if (error) return dbFailure("customer_types.delete", error);
  if (!data || data.length === 0) return failure("NOT_FOUND");
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function reorderCustomerTypesAction(codes: string[]): Promise<ActionResult> {
  const guard = await requireHostAction();
  if (!guard.ok) return guard;
  if (!Array.isArray(codes) || codes.length === 0 || codes.length > 500 || codes.some((c) => typeof c !== "string")) {
    return failure("INVALID_INPUT");
  }
  const { error } = await guard.supabase.rpc("reorder_customer_types", { p_codes: codes });
  if (error) return dbFailure("reorder_customer_types", error);
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}
