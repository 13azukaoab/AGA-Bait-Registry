/**
 * เทส onboarding.ts + กติกาโหมดฝึก:
 *  - อ่านสถานะ / เรียก complete_onboarding / skip_onboarding ด้วยชื่อ RPC ที่ถูกต้อง ไม่ส่ง parameter
 *  - ไฟล์อื่นในโฟลเดอร์บทเรียน **ห้าม** แตะเครือข่าย (fetch / rpc / supabase / server action) — มีแต่ onboarding.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { loadTutorialProfile, recordCompleted, recordSkipped, type OnboardingClient } from "./onboarding";

function fakeClient(opts: { user?: { id: string } | null; row?: unknown; rowError?: unknown; rpcError?: unknown } = {}) {
  const rpc = vi.fn((fn: string) => {
    void fn;
    return Promise.resolve({ error: opts.rpcError ?? null });
  });
  const eq = vi.fn(() => ({
    maybeSingle: () => Promise.resolve({ data: opts.row ?? null, error: opts.rowError ?? null }),
  }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user === undefined ? { id: "u-1" } : opts.user } }) },
    from,
    rpc,
  } as unknown as OnboardingClient;
  return { client, rpc, from, select, eq };
}

describe("loadTutorialProfile", () => {
  it("อ่านแถวของตัวเอง (กรอง user_id) แล้วแปลงเป็น camelCase", async () => {
    const f = fakeClient({
      row: { position_code: "supervisor", onboarding_completed_at: null, onboarding_skipped_at: "2026-11-20T01:00:00Z" },
    });
    const p = await loadTutorialProfile(f.client);
    expect(p).toEqual({ positionCode: "supervisor", completedAt: null, skippedAt: "2026-11-20T01:00:00Z" });
    expect(f.from).toHaveBeenCalledWith("profiles");
    expect(f.select).toHaveBeenCalledWith("position_code, onboarding_completed_at, onboarding_skipped_at");
    expect(f.eq).toHaveBeenCalledWith("user_id", "u-1");
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("ไม่ได้ล็อกอิน / อ่านไม่ได้ / error → null (ไม่เปิดอัตโนมัติ)", async () => {
    expect(await loadTutorialProfile(fakeClient({ user: null }).client)).toBeNull();
    expect(await loadTutorialProfile(fakeClient({ row: null }).client)).toBeNull();
    expect(await loadTutorialProfile(fakeClient({ row: { position_code: null }, rowError: { message: "x" } }).client)).toBeNull();
  });

  it("client โยน error → null ไม่พัง", async () => {
    const bad = {
      auth: { getUser: () => Promise.reject(new Error("offline")) },
    } as unknown as OnboardingClient;
    expect(await loadTutorialProfile(bad)).toBeNull();
  });
});

describe("recordCompleted / recordSkipped", () => {
  it("เรียก RPC ชื่อที่ถูกต้อง ครั้งเดียว ไม่ส่ง parameter", async () => {
    const a = fakeClient();
    expect(await recordCompleted(a.client)).toBe(true);
    expect(a.rpc).toHaveBeenCalledTimes(1);
    expect(a.rpc.mock.calls[0]).toEqual(["complete_onboarding"]);

    const b = fakeClient();
    expect(await recordSkipped(b.client)).toBe(true);
    expect(b.rpc).toHaveBeenCalledTimes(1);
    expect(b.rpc.mock.calls[0]).toEqual(["skip_onboarding"]);
  });

  it("RPC ผิดพลาด → คืน false (เงียบ ไม่ throw)", async () => {
    expect(await recordCompleted(fakeClient({ rpcError: { message: "x" } }).client)).toBe(false);
    expect(await recordSkipped(fakeClient({ rpcError: { message: "x" } }).client)).toBe(false);
  });
});

describe("กติกาโหมดฝึก: มีแต่ onboarding.ts ที่แตะเครือข่าย", () => {
  const dir = __dirname;
  const sources = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "onboarding.ts")
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));

  it("พบไฟล์ต้นฉบับให้ตรวจ", () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  // ตัดคอมเมนต์ออกก่อน เพื่อให้เขียนอธิบายในคอมเมนต์ได้
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each([
    ["fetch(", /\bfetch\s*\(/],
    [".rpc(", /\.rpc\s*\(/],
    ['.from("', /\.from\s*\(\s*["'`]/],
    ["createClient", /\bcreateClient\b/],
    ["@/lib/supabase", /@\/lib\/supabase/],
    ["@supabase", /@supabase\//],
    ['"use server"', /["']use server["']/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["sendBeacon", /sendBeacon/],
    ["WebSocket", /WebSocket/],
    ["localStorage (โหมดฝึกไม่เขียน storage)", /\b(localStorage|sessionStorage)\b/],
  ])("ไม่มี %s ในไฟล์อื่นของ components/tutorial", (_label, pattern) => {
    const offenders = sources.filter((s) => pattern.test(code(s.text))).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("onboarding.ts เรียก RPC แค่ 2 ตัวที่อนุญาต", () => {
    const text = readFileSync(join(dir, "onboarding.ts"), "utf8");
    const names = [...text.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(["complete_onboarding", "skip_onboarding"]));
  });
});
