/**
 * เทสเกณฑ์ Workload รายทีม (DECISIONS 2.88 · BE M42): logic pure + server action (mock Supabase — ข้อมูลสมมติ)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CALLER = "11111111-1111-4111-8111-111111111111";
const TEAM = "33333333-3333-4333-8333-333333333333";

const state = {
  user: { id: CALLER } as { id: string } | null,
  isHost: true,
  rpcError: null as { code: string; message?: string } | null,
  rpcData: [{ team_id: TEAM, workload_hours: 40, effective_hours: 40 }] as unknown,
};
const rpcCalls: { name: string; args: unknown }[] = [];

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
      return state.rpcError ? { data: null, error: state.rpcError } : { data: state.rpcData, error: null };
    },
  }),
}));

import { saveTeamWorkloadAction } from "./settingsActions";
import {
  parseSaveTeamWorkloadResult,
  teamWorkloadDraftValue,
  teamWorkloadLabel,
  validateTeamWorkloadDraft,
  validateTeamWorkloadInput,
} from "./settingsLogic";

const OK = "ยืนยันแก้ไข";

beforeEach(() => {
  state.user = { id: CALLER };
  state.isHost = true;
  state.rpcError = null;
  state.rpcData = [{ team_id: TEAM, workload_hours: 40, effective_hours: 40 }];
  rpcCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("ตรวจช่วงค่า (0 < ค่า ≤ 300 · ทศนิยม ≤ 2)", () => {
  it("ค่าในช่วงผ่าน · ขอบ 0.01 และ 300 ผ่าน", () => {
    for (const t of ["40", "0.01", "300", "37.25", "100"]) {
      expect(validateTeamWorkloadDraft(t, false)).toBeNull();
    }
  });
  it("0 / เกิน 300 / ทศนิยมเกิน 2 / ว่าง / ไม่ใช่ตัวเลข ไม่ผ่าน", () => {
    for (const t of ["0", "300.01", "301", "1.234", "", "abc", "-5"]) {
      expect(validateTeamWorkloadDraft(t, false)).not.toBeNull();
    }
  });
  it("เลือกใช้ค่ากลาง = ผ่านเสมอ (ไม่สนช่องตัวเลข)", () => {
    expect(validateTeamWorkloadDraft("abc", true)).toBeNull();
    expect(teamWorkloadDraftValue("40", true)).toBeNull();
  });
  it("ตรวจ input ของ action: null ผ่าน · เลขนอกช่วง/ไม่ใช่เลข ไม่ผ่าน", () => {
    expect(validateTeamWorkloadInput(null)).toBe(true);
    expect(validateTeamWorkloadInput(40)).toBe(true);
    for (const v of [0, 301, NaN, Infinity, "40", undefined, 1.234]) expect(validateTeamWorkloadInput(v)).toBe(false);
  });
});

describe("แสดงค่ากลาง / ค่าทีม", () => {
  it("ตั้งเฉพาะทีม → แสดงค่าของทีม", () => {
    expect(teamWorkloadLabel({ workloadHours: 40, effectiveWorkloadHours: 40 })).toEqual({ custom: true, text: "40 ชม." });
    expect(teamWorkloadLabel({ workloadHours: 37.5, effectiveWorkloadHours: 37.5 })).toEqual({ custom: true, text: "37.5 ชม." });
  });
  it("ไม่ตั้ง → ใช้ค่ากลาง (N ชม.) จากค่าที่ใช้จริง", () => {
    expect(teamWorkloadLabel({ workloadHours: null, effectiveWorkloadHours: 30 })).toEqual({
      custom: false,
      text: "ใช้ค่ากลาง (30 ชม.)",
    });
  });
  it("ไม่ตั้ง และอ่านค่าที่ใช้จริงไม่ได้ → ใช้ค่ากลาง (ไม่เดาตัวเลข)", () => {
    expect(teamWorkloadLabel({ workloadHours: null, effectiveWorkloadHours: null })).toEqual({ custom: false, text: "ใช้ค่ากลาง" });
  });
});

describe("แปลงผลคืนของ RPC", () => {
  it("array แถวเดียว / object / ค่าทีมเป็น null", () => {
    expect(parseSaveTeamWorkloadResult([{ workload_hours: "40.00", effective_hours: "40.00" }])).toEqual({ workloadHours: 40, effectiveHours: 40 });
    expect(parseSaveTeamWorkloadResult({ workload_hours: null, effective_hours: 30 })).toEqual({ workloadHours: null, effectiveHours: 30 });
  });
  it("รูปแปลก = null", () => {
    expect(parseSaveTeamWorkloadResult(null)).toBeNull();
    expect(parseSaveTeamWorkloadResult([])).toBeNull();
    expect(parseSaveTeamWorkloadResult([{ workload_hours: 40 }])).toBeNull();
  });
});

describe("saveTeamWorkloadAction", () => {
  it("payload: เรียก save_team_workload_hours(p_team_id, p_hours, p_confirm=true)", async () => {
    const r = await saveTeamWorkloadAction({ teamId: TEAM, hours: 40, confirm: OK });
    expect(r).toEqual({ ok: true, workloadHours: 40, effectiveHours: 40 });
    expect(rpcCalls).toEqual([{ name: "save_team_workload_hours", args: { p_team_id: TEAM, p_hours: 40, p_confirm: true } }]);
  });
  it("กลับไปใช้ค่ากลาง: ส่ง p_hours = null", async () => {
    state.rpcData = [{ team_id: TEAM, workload_hours: null, effective_hours: 30 }];
    const r = await saveTeamWorkloadAction({ teamId: TEAM, hours: null, confirm: OK });
    expect(r).toEqual({ ok: true, workloadHours: null, effectiveHours: 30 });
    expect(rpcCalls[0]).toEqual({ name: "save_team_workload_hours", args: { p_team_id: TEAM, p_hours: null, p_confirm: true } });
  });
  it("ผลคืนรูปแปลก แต่บันทึกสำเร็จ → ยัง ok", async () => {
    state.rpcData = null;
    expect(await saveTeamWorkloadAction({ teamId: TEAM, hours: 25, confirm: OK })).toEqual({ ok: true, workloadHours: 25, effectiveHours: null });
  });
  it("ค่านอกช่วง → WL001 · ไม่พิมพ์ยืนยัน → BAD_CONFIRM · teamId ผิด → INVALID_INPUT (ไม่เรียก RPC)", async () => {
    expect(await saveTeamWorkloadAction({ teamId: TEAM, hours: 0, confirm: OK })).toMatchObject({ code: "WL001" });
    expect(await saveTeamWorkloadAction({ teamId: TEAM, hours: 301, confirm: OK })).toMatchObject({ code: "WL001" });
    expect(await saveTeamWorkloadAction({ teamId: TEAM, hours: 40, confirm: "" })).toMatchObject({ code: "BAD_CONFIRM" });
    expect(await saveTeamWorkloadAction({ teamId: "x", hours: 40, confirm: OK })).toMatchObject({ code: "INVALID_INPUT" });
    expect(rpcCalls).toEqual([]);
  });
  it("ไม่ใช่ host → FORBIDDEN · ไม่ล็อกอิน → UNAUTHENTICATED · ไม่เรียก RPC บันทึก", async () => {
    state.isHost = false;
    expect(await saveTeamWorkloadAction({ teamId: TEAM, hours: 40, confirm: OK })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    state.isHost = true;
    state.user = null;
    expect(await saveTeamWorkloadAction({ teamId: TEAM, hours: 40, confirm: OK })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(rpcCalls).toEqual([]);
  });
  it("แปลง error จาก DB เป็นไทย (ไม่ส่งข้อความดิบ)", async () => {
    const cases: [string, string][] = [
      ["TM007", "ยืนยัน"],
      ["WL001", "ไม่เกิน 300"],
      ["AG004", "ไม่พบรายการ"],
      ["TM006", "ผู้ดูแลระบบ"],
      ["42501", "ผู้ดูแลระบบ"],
    ];
    for (const [code, part] of cases) {
      state.rpcError = { code, message: "RAW-DB-TEXT" };
      const r = await saveTeamWorkloadAction({ teamId: TEAM, hours: 40, confirm: OK });
      expect(r).toMatchObject({ ok: false, code });
      const msg = (r as { message: string }).message;
      expect(msg).toContain(part);
      expect(msg).not.toContain("RAW-DB-TEXT");
    }
  });
  it("log เฉพาะ code ไม่ log ข้อความดิบ", async () => {
    state.rpcError = { code: "WL001", message: "RAW-DB-TEXT" };
    await saveTeamWorkloadAction({ teamId: TEAM, hours: 40, confirm: OK });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("WL001");
    expect(logged).not.toContain("RAW-DB-TEXT");
  });
});
