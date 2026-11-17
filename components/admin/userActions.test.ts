/**
 * เทส server action ของหน้าจัดการผู้ใช้: ด่าน host ฝั่ง server + ลำดับ is_active → แบน + ย้อนเมื่อล้ม
 * (mock ชั้น Supabase / userAdmin — ข้อมูลทั้งหมดสมมติ)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CALLER = "11111111-1111-4111-8111-111111111111";
const TARGET = "33333333-3333-4333-8333-333333333333";
const OWNER = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
const state = {
  user: { id: CALLER } as { id: string } | null,
  isHost: true,
  profile: { role: "host", isActive: true } as { role: string; isActive: boolean } | null,
  profiles: new Map<string, Row>(),
  positions: new Map<string, Row>(),
  updateError: null as { code: string } | null,
  updates: [] as { values: Row; userId: string }[],
};
const calls: string[] = [];
const banResult = { ok: true } as { ok: true } | { ok: false; code: string };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  fetchProfileByUserId: async () =>
    state.profile ? { ...state.profile, userId: state.user?.id } : null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.isHost, error: null }),
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, v: string) => ({
          maybeSingle: async () => ({
            data: (table === "profiles" ? state.profiles : state.positions).get(v) ?? null,
            error: null,
          }),
        }),
      }),
      update: (values: Row) => ({
        eq: (_c: string, userId: string) => {
          const run = async () => {
            calls.push(`db:${JSON.stringify(values)}`);
            state.updates.push({ values, userId });
            return state.updateError
              ? { data: null, error: state.updateError }
              : { data: [{ user_id: userId }], error: null };
          };
          // supabase-js: awaitable ได้ทั้งแบบมี/ไม่มี .select()
          return { select: run, then: (res: (v: unknown) => unknown) => run().then(res) };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/admin/userAdmin", () => ({
  createUser: vi.fn(async () => {
    calls.push("createUser");
    return { ok: true, userId: "new", username: "ag-1", temporaryPassword: "Abcd2345wxyz" };
  }),
  resetPassword: vi.fn(async () => {
    calls.push("resetPassword");
    return { ok: true, temporaryPassword: "Zyxw8765dcba" };
  }),
  setBanned: vi.fn(async (_id: string, banned: boolean) => {
    calls.push(`ban:${banned}`);
    return banResult;
  }),
}));

import {
  createUserAction,
  resetPasswordAction,
  setActiveAction,
  updateUserAction,
} from "./userActions";

beforeEach(() => {
  state.user = { id: CALLER };
  state.isHost = true;
  state.profile = { role: "host", isActive: true };
  state.profiles = new Map([
    [TARGET, { user_id: TARGET, position_code: "supervisor", is_active: true }],
    [OWNER, { user_id: OWNER, position_code: "owner", is_active: true }],
  ]);
  state.positions = new Map([
    ["supervisor", { code: "supervisor", assignable: true }],
    ["job_admin", { code: "job_admin", assignable: true }],
    ["owner", { code: "owner", assignable: false }],
  ]);
  state.updateError = null;
  state.updates = [];
  calls.length = 0;
  (banResult as { ok: boolean }).ok = true;
});

describe("ด่าน host ฝั่ง server (ทุก action)", () => {
  const actions: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
    ["create", () => createUserAction({ username: "ag-9", displayName: "ก", positionCode: "supervisor" })],
    ["reset", () => resetPasswordAction(TARGET)],
    ["setActive", () => setActiveAction(TARGET, false)],
    ["update", () => updateUserAction({ userId: TARGET, displayName: "ก", positionCode: "supervisor", confirm: "" })],
  ];

  for (const role of ["admin", "recorder", "viewer"]) {
    it(`role ${role} (is_host = false) → FORBIDDEN ทุก action และไม่แตะอะไรเลย`, async () => {
      state.isHost = false;
      state.profile = { role, isActive: true };
      for (const [, run] of actions) {
        const r = await run();
        expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
      }
      expect(calls).toEqual([]);
    });
  }

  it("ไม่ได้ล็อกอิน → UNAUTHENTICATED", async () => {
    state.user = null;
    for (const [, run] of actions) expect(await run()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(calls).toEqual([]);
  });

  it("is_host true แต่โปรไฟล์ role ไม่ใช่ host (ไม่ตรงกัน) → FORBIDDEN", async () => {
    state.profile = { role: "admin", isActive: true };
    expect(await resetPasswordAction(TARGET)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("สร้าง / รีเซ็ต", () => {
  it("host สร้างบัญชีได้ และได้รหัสชั่วคราวกลับครั้งเดียว", async () => {
    const r = await createUserAction({ username: "ag-9", displayName: "ก", positionCode: "supervisor" });
    expect(r).toMatchObject({ ok: true, temporaryPassword: "Abcd2345wxyz" });
  });
  it("รีเซ็ตรหัสส่งต่อให้ userAdmin", async () => {
    expect(await resetPasswordAction(TARGET)).toMatchObject({ ok: true, temporaryPassword: "Zyxw8765dcba" });
    expect(calls).toEqual(["resetPassword"]);
  });
});

describe("setActiveAction", () => {
  it("ปิดบัญชี: อัปเดต is_active ก่อน แล้วค่อยแบน", async () => {
    expect(await setActiveAction(TARGET, false)).toEqual({ ok: true });
    expect(calls).toEqual(['db:{"is_active":false}', "ban:true"]);
  });
  it("เปิดบัญชี: อัปเดต is_active=true แล้วปลดแบน", async () => {
    expect(await setActiveAction(TARGET, true)).toEqual({ ok: true });
    expect(calls).toEqual(['db:{"is_active":true}', "ban:false"]);
  });
  it("แบนล้ม → ย้อน is_active กลับ และแจ้ง error", async () => {
    Object.assign(banResult, { ok: false, code: "UPSTREAM_ERROR" });
    const r = await setActiveAction(TARGET, false);
    expect(r).toMatchObject({ ok: false, code: "UPSTREAM_ERROR" });
    expect(calls).toEqual(['db:{"is_active":false}', "ban:true", 'db:{"is_active":true}']);
  });
  it("ปิดตัวเองไม่ได้ (SELF_TARGET) ก่อนแตะ DB", async () => {
    expect(await setActiveAction(CALLER, false)).toMatchObject({ ok: false, code: "SELF_TARGET" });
    expect(calls).toEqual([]);
  });
  it("เจ้าของ → PS003 ไม่แตะอะไร", async () => {
    expect(await setActiveAction(OWNER, false)).toMatchObject({ ok: false, code: "PS003" });
    expect(calls).toEqual([]);
  });
  it("DB กัน host คนสุดท้าย (P0001) → LAST_HOST และไม่แบน", async () => {
    state.updateError = { code: "P0001" };
    expect(await setActiveAction(TARGET, false)).toMatchObject({ ok: false, code: "LAST_HOST" });
    expect(calls).toEqual(['db:{"is_active":false}']);
  });
  it("userId / active ผิดรูปแบบ → INVALID_INPUT", async () => {
    expect(await setActiveAction("x", false)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setActiveAction(TARGET, "no" as unknown as boolean)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("updateUserAction", () => {
  it("แก้ชื่ออย่างเดียว (ตำแหน่งเดิม) ไม่ต้องมีคำยืนยัน และไม่ส่ง position_code", async () => {
    const r = await updateUserAction({ userId: TARGET, displayName: " ชื่อใหม่ ", positionCode: "supervisor", confirm: "" });
    expect(r).toEqual({ ok: true });
    expect(state.updates[0]?.values).toEqual({ display_name: "ชื่อใหม่" });
  });
  it("เปลี่ยนตำแหน่งโดยไม่มีคำยืนยัน → BAD_CONFIRM (server ตรวจซ้ำ)", async () => {
    const r = await updateUserAction({ userId: TARGET, displayName: "ก", positionCode: "job_admin", confirm: "" });
    expect(r).toMatchObject({ ok: false, code: "BAD_CONFIRM" });
    expect(state.updates).toEqual([]);
  });
  it("เปลี่ยนตำแหน่งพร้อมคำยืนยัน → ส่ง position_code", async () => {
    const r = await updateUserAction({ userId: TARGET, displayName: "ก", positionCode: "job_admin", confirm: "ยืนยันแก้ไข" });
    expect(r).toEqual({ ok: true });
    expect(state.updates[0]?.values).toEqual({ display_name: "ก", position_code: "job_admin" });
  });
  it("เป้าหมายเป็นเจ้าของ / ตำแหน่งใหม่เป็นเจ้าของ → PS003", async () => {
    expect(await updateUserAction({ userId: OWNER, displayName: "ก", positionCode: "owner", confirm: "" })).toMatchObject({ ok: false, code: "PS003" });
    expect(await updateUserAction({ userId: TARGET, displayName: "ก", positionCode: "owner", confirm: "ยืนยันแก้ไข" })).toMatchObject({ ok: false, code: "PS003" });
  });
  it("ชื่อว่าง → INVALID_INPUT", async () => {
    expect(await updateUserAction({ userId: TARGET, displayName: " ", positionCode: "supervisor", confirm: "" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
