import { beforeEach, describe, expect, it, vi } from "vitest";

const CALLER = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const NORMAL = "33333333-3333-4333-8333-333333333333";
const GHOST = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;

/** state ของเทส — คนละชุดต่อเคส (รีเซ็ตใน beforeEach) */
const state = {
  user: { id: CALLER } as { id: string } | null,
  isHost: true as boolean,
  isHostError: false,
  profiles: new Map<string, Row>(),
  positions: new Map<string, Row>(),
  inserted: [] as Row[],
  updates: [] as { table: string; values: Row; userId: unknown }[],
  profileInsertError: null as { code: string } | null,
};

const adminCalls: { op: string; args: unknown[] }[] = [];
const adminResult = { error: null as { status?: number } | null, createdUserId: "new-user-id" };

function callerClient() {
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name: string) => {
      if (name !== "is_host") throw new Error("unexpected rpc " + name);
      return state.isHostError
        ? { data: null, error: { message: "boom" } }
        : { data: state.isHost, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, value: string) => ({
          maybeSingle: async () => {
            const map = table === "profiles" ? state.profiles : state.positions;
            return { data: map.get(value) ?? null, error: null };
          },
        }),
      }),
      insert: async (row: Row) => {
        state.inserted.push(row);
        return { error: state.profileInsertError };
      },
      update: (values: Row) => ({
        eq: async (_col: string, userId: unknown) => {
          state.updates.push({ table, values, userId });
          return { error: null };
        },
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => callerClient() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: async (...args: unknown[]) => {
          adminCalls.push({ op: "createUser", args });
          return adminResult.error
            ? { data: { user: null }, error: adminResult.error }
            : { data: { user: { id: adminResult.createdUserId } }, error: null };
        },
        updateUserById: async (...args: unknown[]) => {
          adminCalls.push({ op: "updateUserById", args });
          return { error: null };
        },
        deleteUser: async (...args: unknown[]) => {
          adminCalls.push({ op: "deleteUser", args });
          return { error: null };
        },
      },
    },
  }),
}));

// fetchProfileByUserId อ่านผ่าน select ที่ join positions — เทสนี้ mock ที่ชั้น lib/db ตรงๆ
vi.mock("@/lib/db", () => ({
  fetchProfileByUserId: async (_s: unknown, userId: string) => {
    const p = state.profiles.get(userId);
    return p ? { userId, role: p.role, isActive: p.is_active } : null;
  },
}));

import { checkPasswordStrength } from "@/lib/auth/passwordStrength";
import {
  changeUsername,
  createUser,
  deleteUser,
  resetPassword,
  setBanned,
  type UserAdminResult,
} from "./userAdmin";

beforeEach(() => {
  state.user = { id: CALLER };
  state.isHost = true;
  state.isHostError = false;
  state.inserted = [];
  state.updates = [];
  state.profileInsertError = null;
  adminCalls.length = 0;
  adminResult.error = null;
  state.positions = new Map<string, Row>([
    ["pm", { code: "pm", role: "host", assignable: true }],
    ["job_admin", { code: "job_admin", role: "admin", assignable: true }],
    ["owner", { code: "owner", role: "host", assignable: false }],
  ]);
  state.profiles = new Map<string, Row>([
    [CALLER, { user_id: CALLER, role: "host", is_active: true, position_code: "pm", username: "caller" }],
    [OWNER, { user_id: OWNER, role: "host", is_active: true, position_code: "owner", username: "owner" }],
    [NORMAL, { user_id: NORMAL, role: "admin", is_active: true, position_code: "job_admin", username: "ag-00001" }],
  ]);
});

/** action ทุกตัวที่ยิงกับบัญชีที่มีอยู่ — ใช้ทดสอบเงื่อนไขร่วมกัน */
const existingTargetActions: [string, (id: string) => Promise<UserAdminResult<object>>][] = [
  ["resetPassword", (id) => resetPassword(id)],
  ["setBanned(true)", (id) => setBanned(id, true)],
  ["setBanned(false)", (id) => setBanned(id, false)],
  ["changeUsername", (id) => changeUsername(id, "ag-99999")],
  ["deleteUser", (id) => deleteUser(id)],
];

describe("ผู้เรียกไม่ใช่ host → ปฏิเสธก่อนแตะ admin", () => {
  it.each(existingTargetActions)("%s: is_host=false → FORBIDDEN", async (_n, run) => {
    state.isHost = false;
    const r = await run(NORMAL);
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(adminCalls).toHaveLength(0);
  });

  it.each(existingTargetActions)("%s: ไม่ได้ล็อกอิน → UNAUTHENTICATED", async (_n, run) => {
    state.user = null;
    expect(await run(NORMAL)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(adminCalls).toHaveLength(0);
  });

  it("is_host error → ปฏิเสธ (fail closed)", async () => {
    state.isHostError = true;
    expect(await resetPassword(NORMAL)).toMatchObject({ ok: false, code: "UPSTREAM_ERROR" });
    expect(adminCalls).toHaveLength(0);
  });

  it("host ที่ถูกปิดบัญชี → ปฏิเสธ", async () => {
    state.profiles.set(CALLER, { ...state.profiles.get(CALLER), is_active: false });
    expect(await resetPassword(NORMAL)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(adminCalls).toHaveLength(0);
  });

  it("createUser: ไม่ใช่ host → FORBIDDEN ไม่เรียก admin", async () => {
    state.isHost = false;
    const r = await createUser({ username: "ag-00002", displayName: "ทดสอบ", positionCode: "pm" });
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(adminCalls).toHaveLength(0);
  });
});

describe("เป้าหมายเป็นเจ้าของ → PS003 และไม่เรียก admin", () => {
  it.each(existingTargetActions)("%s", async (_n, run) => {
    const r = await run(OWNER);
    expect(r).toMatchObject({ ok: false, code: "PS003" });
    expect(adminCalls).toHaveLength(0);
    expect(state.updates).toHaveLength(0); // ไม่แตะ profiles เจ้าของด้วย
  });

  it("createUser ด้วยตำแหน่ง owner → PS003", async () => {
    const r = await createUser({ username: "ag-00002", displayName: "ทดสอบ", positionCode: "owner" });
    expect(r).toMatchObject({ ok: false, code: "PS003" });
    expect(adminCalls).toHaveLength(0);
  });

  it("ข้อความไทยพร้อมให้ FE ใช้", async () => {
    const r = await resetPassword(OWNER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/เจ้าของ/);
  });
});

describe("fail closed เมื่อข้อมูลเป้าหมายผิดปกติ", () => {
  it("ไม่พบโปรไฟล์ → NOT_FOUND ไม่เรียก admin", async () => {
    expect(await resetPassword(GHOST)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(adminCalls).toHaveLength(0);
  });

  it("ตำแหน่งที่โปรไฟล์อ้างหาไม่เจอ → ปฏิเสธ", async () => {
    state.profiles.set(NORMAL, { ...state.profiles.get(NORMAL), position_code: "ghost_position" });
    expect(await resetPassword(NORMAL)).toMatchObject({ ok: false, code: "UPSTREAM_ERROR" });
    expect(adminCalls).toHaveLength(0);
  });

  it("assignable ไม่ใช่ boolean → ปฏิเสธ", async () => {
    state.positions.set("job_admin", { code: "job_admin", role: "admin", assignable: null });
    expect(await resetPassword(NORMAL)).toMatchObject({ ok: false, code: "UPSTREAM_ERROR" });
    expect(adminCalls).toHaveLength(0);
  });

  it("targetUserId ไม่ใช่ uuid → INVALID_INPUT", async () => {
    expect(await resetPassword("not-a-uuid")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(adminCalls).toHaveLength(0);
  });
});

describe("เป้าหมายปกติ + ผู้เรียกเป็น host → เรียก admin ด้วย args ที่คาด", () => {
  it("resetPassword: ตั้ง must_change_password ก่อน แล้วเปลี่ยนรหัสชั่วคราว", async () => {
    const r = await resetPassword(NORMAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { temporaryPassword } = r as { temporaryPassword: string };
    expect(temporaryPassword).toHaveLength(12);
    expect(state.updates).toEqual([
      { table: "profiles", values: { must_change_password: true }, userId: NORMAL },
    ]);
    expect(adminCalls).toEqual([
      { op: "updateUserById", args: [NORMAL, { password: temporaryPassword }] },
    ]);
  });

  it("รหัสชั่วคราวผ่านกติการหัสผ่าน (DECISIONS 2.69) ทุกครั้งที่สุ่ม", async () => {
    for (let i = 0; i < 300; i += 1) {
      const r = await resetPassword(NORMAL);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const { temporaryPassword } = r as { temporaryPassword: string };
      expect(temporaryPassword.length).toBeGreaterThanOrEqual(10);
      expect(checkPasswordStrength(temporaryPassword)).toEqual([]);
    }
  });

  it("setBanned(true/false)", async () => {
    await setBanned(NORMAL, true);
    await setBanned(NORMAL, false);
    expect(adminCalls).toEqual([
      { op: "updateUserById", args: [NORMAL, { ban_duration: "876000h" }] },
      { op: "updateUserById", args: [NORMAL, { ban_duration: "none" }] },
    ]);
  });

  it("setBanned: ปิดบัญชีตัวเองไม่ได้ แต่เปิดคืนได้", async () => {
    expect(await setBanned(CALLER, true)).toMatchObject({ ok: false, code: "SELF_TARGET" });
    expect(adminCalls).toHaveLength(0);
  });

  it("deleteUser: เรียก deleteUser ด้วย id เป้าหมาย · ลบตัวเองไม่ได้", async () => {
    expect(await deleteUser(CALLER)).toMatchObject({ ok: false, code: "SELF_TARGET" });
    expect(adminCalls).toHaveLength(0);
    expect(await deleteUser(NORMAL)).toEqual({ ok: true });
    expect(adminCalls).toEqual([{ op: "deleteUser", args: [NORMAL] }]);
  });

  it("changeUsername: อัปเดต profiles + อีเมลภายใน", async () => {
    const r = await changeUsername(NORMAL, "  AG-99999 ");
    expect(r).toEqual({ ok: true, username: "ag-99999" });
    expect(adminCalls).toEqual([
      { op: "updateUserById", args: [NORMAL, { email: "ag-99999@aga.local", email_confirm: true }] },
    ]);
  });

  it("changeUsername: username ผิดรูปแบบ → INVALID_INPUT", async () => {
    expect(await changeUsername(NORMAL, "a b")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(adminCalls).toHaveLength(0);
  });
});

describe("createUser", () => {
  it("สร้าง auth user + profiles โดย role มาจากตำแหน่ง และไม่ส่ง division_scope", async () => {
    const r = await createUser({ username: "AG-00002", displayName: " สมชาย ", positionCode: "job_admin" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r as { userId: string; username: string; temporaryPassword: string };
    expect(data.userId).toBe("new-user-id");
    expect(adminCalls).toHaveLength(1);
    expect(adminCalls[0]).toMatchObject({
      op: "createUser",
      args: [{ email: "ag-00002@aga.local", password: data.temporaryPassword, email_confirm: true }],
    });
    expect(state.inserted).toEqual([
      {
        user_id: "new-user-id",
        username: "ag-00002",
        display_name: "สมชาย",
        role: "admin",
        position_code: "job_admin",
        must_change_password: true,
      },
    ]);
    expect(state.inserted[0]).not.toHaveProperty("division_scope");
  });

  it.each([
    ["division_scope", { division_scope: ["central"] }],
    ["role", { role: "host" }],
    ["is_active", { is_active: true }],
  ])("ช่อง %s ที่แอบส่งมา → INVALID_INPUT ไม่เรียก admin", async (_n, extra) => {
    const r = await createUser({
      username: "ag-00002",
      displayName: "ทดสอบ",
      positionCode: "pm",
      ...extra,
    } as never);
    expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(adminCalls).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
  });

  it("ตำแหน่งไม่มีอยู่ → NOT_FOUND", async () => {
    const r = await createUser({ username: "ag-00002", displayName: "ทดสอบ", positionCode: "nope" });
    expect(r).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(adminCalls).toHaveLength(0);
  });

  it("username ซ้ำที่ GoTrue (422) → USERNAME_TAKEN ไม่เปิดเผย error ดิบ", async () => {
    adminResult.error = { status: 422 };
    const r = await createUser({ username: "ag-00002", displayName: "ทดสอบ", positionCode: "pm" });
    expect(r).toMatchObject({ ok: false, code: "USERNAME_TAKEN" });
    expect(JSON.stringify(r)).not.toContain("422");
  });

  it("แทรก profiles ล้มเหลว → ลบ auth user ที่เพิ่งสร้างทิ้ง", async () => {
    state.profileInsertError = { code: "XX000" };
    const r = await createUser({ username: "ag-00002", displayName: "ทดสอบ", positionCode: "pm" });
    expect(r).toMatchObject({ ok: false, code: "UPSTREAM_ERROR" });
    expect(adminCalls.map((c) => c.op)).toEqual(["createUser", "deleteUser"]);
    expect(adminCalls[1]?.args).toEqual(["new-user-id"]);
  });

  it("username ผิดรูปแบบ / ชื่อว่าง → INVALID_INPUT", async () => {
    expect(await createUser({ username: "x", displayName: "ก", positionCode: "pm" })).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await createUser({ username: "ag-00002", displayName: "  ", positionCode: "pm" })).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(adminCalls).toHaveLength(0);
  });
});
