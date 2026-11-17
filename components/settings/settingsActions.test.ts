/**
 * เทส server action หน้าตั้งค่า: ด่าน host + ชื่อ RPC/argument ตรง migration จริง + แปลง error เป็นไทย
 * (mock Supabase — ข้อมูลสมมติ)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CALLER = "11111111-1111-4111-8111-111111111111";
const TEAM = "33333333-3333-4333-8333-333333333333";

const state = {
  user: { id: CALLER } as { id: string } | null,
  isHost: true,
  rpcError: null as { code: string; message?: string; details?: string } | null,
  tableError: null as { code: string } | null,
  teamCodes: ["A", "Sup"],
  currentKind: "service",
};
const rpcCalls: { name: string; args: unknown }[] = [];
const writes: { table: string; op: string; values?: unknown }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  fetchProfileByUserId: async () => ({ role: state.isHost ? "host" : "admin", isActive: true }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name: string, args: unknown) => {
      if (name === "is_host") return { data: state.isHost, error: null };
      rpcCalls.push({ name, args });
      return state.rpcError ? { data: null, error: state.rpcError } : { data: 30, error: null };
    },
    from: (table: string) => ({
      select: () => {
        const rows = table === "teams" ? state.teamCodes.map((code) => ({ code })) : [];
        const p = Promise.resolve({ data: rows, error: null });
        return Object.assign(p, {
          eq: () => ({ maybeSingle: async () => ({ data: { kind: state.currentKind }, error: null }) }),
          order: async () => ({ data: [], error: null }),
        });
      },
      insert: async (values: unknown) => {
        writes.push({ table, op: "insert", values });
        return { error: state.tableError };
      },
      update: (values: unknown) => ({
        eq: () => ({
          select: async () => {
            writes.push({ table, op: "update", values });
            return state.tableError ? { data: null, error: state.tableError } : { data: [{ id: "x" }], error: null };
          },
        }),
      }),
    }),
  }),
}));

import {
  createTeamAction,
  deleteTeamAction,
  reorderCustomerTypesAction,
  saveTierRuleSetAction,
  saveWorkloadAction,
  setTeamActiveAction,
  updateTeamAction,
} from "./settingsActions";

const TIER = { effectiveMonth: "2026-12", m: 30000, l: 50000, xl: 100000, reason: "ปรับตามต้นทุน", confirm: "ยืนยันแก้ไข" };

beforeEach(() => {
  state.user = { id: CALLER };
  state.isHost = true;
  state.rpcError = null;
  state.tableError = null;
  state.teamCodes = ["A", "Sup"];
  state.currentKind = "service";
  rpcCalls.length = 0;
  writes.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("ด่าน host (admin/recorder/viewer เรียกตรงไม่ได้)", () => {
  const all: (() => Promise<{ ok: boolean; code?: string }>)[] = [
    () => saveTierRuleSetAction(TIER),
    () => saveWorkloadAction({ hours: 30, confirm: "ยืนยันแก้ไข" }),
    () => createTeamAction({ code: "P", name: "ทีม P", kind: "service", headcount: 1 }),
    () => updateTeamAction({ teamId: TEAM, name: "x", kind: "service", headcount: 1 }),
    () => setTeamActiveAction(TEAM, false),
    () => deleteTeamAction(TEAM),
    () => reorderCustomerTypesAction(["a"]),
  ];
  it("role ที่ไม่ใช่ host → FORBIDDEN ทุก action ไม่เรียก RPC/ตาราง", async () => {
    state.isHost = false;
    for (const run of all) expect(await run()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(rpcCalls).toEqual([]);
    expect(writes).toEqual([]);
  });
  it("ไม่ล็อกอิน → UNAUTHENTICATED", async () => {
    state.user = null;
    for (const run of all) expect(await run()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});

describe("เกณฑ์ Tier", () => {
  it("เรียก save_tier_rule_set ด้วย argument p เป็น JSON number", async () => {
    expect(await saveTierRuleSetAction(TIER)).toEqual({ ok: true });
    expect(rpcCalls).toEqual([
      { name: "save_tier_rule_set", args: { p: { effective_month: "2026-12", min_m: 30000, min_l: 50000, min_xl: 100000, reason: "ปรับตามต้นทุน" } } },
    ]);
  });
  it("ไม่พิมพ์ยืนยัน → BAD_CONFIRM · ค่าผิด/เหตุผลสั้น/เดือนผิด → INVALID_INPUT (ไม่เรียก RPC)", async () => {
    expect(await saveTierRuleSetAction({ ...TIER, confirm: "" })).toMatchObject({ code: "BAD_CONFIRM" });
    expect(await saveTierRuleSetAction({ ...TIER, l: 20000 })).toMatchObject({ code: "INVALID_INPUT" });
    expect(await saveTierRuleSetAction({ ...TIER, reason: "สั้น" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(await saveTierRuleSetAction({ ...TIER, effectiveMonth: "2026-13" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(rpcCalls).toEqual([]);
  });
  it("TR002 จาก DB → ข้อความไทยพร้อมเดือน (ไม่ส่งข้อความดิบ)", async () => {
    state.rpcError = { code: "TR002", message: "เกณฑ์ที่เริ่มใช้ 2026-11 จะกระทบเดือน 2026-10 ที่ปิดแล้ว" };
    const r = await saveTierRuleSetAction(TIER);
    expect(r).toMatchObject({ ok: false, code: "TR002" });
    expect((r as { message: string }).message).toContain("2026-10");
  });
});

describe("Workload", () => {
  it("เรียก save_workload_threshold(p_hours)", async () => {
    expect(await saveWorkloadAction({ hours: 32.5, confirm: "ยืนยันแก้ไข" })).toMatchObject({ ok: true });
    expect(rpcCalls[0]).toEqual({ name: "save_workload_threshold", args: { p_hours: 32.5 } });
  });
  it("ค่านอกช่วง → WL001 · ไม่ยืนยัน → BAD_CONFIRM", async () => {
    expect(await saveWorkloadAction({ hours: 0, confirm: "ยืนยันแก้ไข" })).toMatchObject({ code: "WL001" });
    expect(await saveWorkloadAction({ hours: 30, confirm: "" })).toMatchObject({ code: "BAD_CONFIRM" });
  });
});

describe("ทีม", () => {
  it("เปิด/ปิดทีมเรียก set_team_active(p_team_id, p_active)", async () => {
    expect(await setTeamActiveAction(TEAM, false)).toEqual({ ok: true });
    expect(rpcCalls[0]).toEqual({ name: "set_team_active", args: { p_team_id: TEAM, p_active: false } });
  });
  it("ทีมระบบ (TM002) / ไม่ใช่ host (TM006) แปลเป็นไทย", async () => {
    state.rpcError = { code: "TM002" };
    expect(await setTeamActiveAction(TEAM, false)).toMatchObject({ ok: false, code: "TM002" });
    state.rpcError = { code: "TM006" };
    expect(await setTeamActiveAction(TEAM, false)).toMatchObject({ ok: false, code: "TM006" });
  });
  it("ลบทีม: delete_team · TM001 แสดงจำนวนที่ผูก", async () => {
    state.rpcError = { code: "TM001", details: JSON.stringify({ contracts: 2, visits: 5, users: 0 }) };
    const r = await deleteTeamAction(TEAM);
    expect(rpcCalls[0]).toEqual({ name: "delete_team", args: { p_team_id: TEAM } });
    expect((r as { message: string }).message).toContain("สัญญา 2");
    expect((r as { message: string }).message).toContain("การเข้าบริการ 5");
  });
  it("สร้างทีม: ซ้ำแบบไม่สนตัวพิมพ์ → 23505 · ปกติ insert ส่วนกลาง (branch_id null) ไม่ส่ง is_system", async () => {
    expect(await createTeamAction({ code: "sup", name: "x", kind: "service", headcount: 1 })).toMatchObject({ code: "23505" });
    expect(writes).toEqual([]);
    expect(await createTeamAction({ code: "P", name: "ทีม P", kind: "service", headcount: 0 })).toEqual({ ok: true });
    expect(writes[0]).toEqual({ table: "teams", op: "insert", values: { code: "P", name: "ทีม P", kind: "service", headcount: 0, branch_id: null } });
  });
  it("แก้ทีม: ส่ง kind เฉพาะที่เปลี่ยน", async () => {
    await updateTeamAction({ teamId: TEAM, name: " ชื่อใหม่ ", kind: "service", headcount: 4 });
    expect(writes[0]?.values).toEqual({ name: "ชื่อใหม่", headcount: 4 });
    await updateTeamAction({ teamId: TEAM, name: "ชื่อใหม่", kind: "install", headcount: 4 });
    expect(writes[1]?.values).toEqual({ name: "ชื่อใหม่", headcount: 4, kind: "install" });
  });
  it("ประเภททีมผิด / headcount เกิน → INVALID_INPUT", async () => {
    expect(await createTeamAction({ code: "P", name: "x", kind: "boss", headcount: 1 })).toMatchObject({ code: "INVALID_INPUT" });
    expect(await updateTeamAction({ teamId: TEAM, name: "x", kind: "service", headcount: 100 })).toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("จัดเรียงประเภทลูกค้า", () => {
  it("เรียก reorder_customer_types(p_codes)", async () => {
    expect(await reorderCustomerTypesAction(["a", "b"])).toEqual({ ok: true });
    expect(rpcCalls[0]).toEqual({ name: "reorder_customer_types", args: { p_codes: ["a", "b"] } });
  });
  it("CT001 → ข้อความไทย · รายการว่าง → INVALID_INPUT", async () => {
    state.rpcError = { code: "CT001" };
    expect(await reorderCustomerTypesAction(["a"])).toMatchObject({ code: "CT001" });
    expect(await reorderCustomerTypesAction([])).toMatchObject({ code: "INVALID_INPUT" });
  });
});
