import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkHealth } from "./checkHealth";

const FIXED = new Date("2026-11-16T03:00:00.000Z");
const now = () => FIXED;

describe("checkHealth", () => {
  it("DB ต่อได้ → 200 status ok", async () => {
    const r = await checkHealth(async () => ({ error: null }), { now });
    expect(r.httpStatus).toBe(200);
    expect(r.body).toEqual({ status: "ok", db: "ok", checkedAt: FIXED.toISOString() });
  });

  it("DB คืน error → 503 และไม่รั่วข้อความ error", async () => {
    const r = await checkHealth(
      async () => ({ error: { message: "password=SECRET relation x" } }),
      { now },
    );
    expect(r.httpStatus).toBe(503);
    expect(r.body).toEqual({ status: "down", db: "down", checkedAt: FIXED.toISOString() });
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
  });

  it("probe โยน exception → 503 ไม่รั่วข้อความ", async () => {
    const r = await checkHealth(
      async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.1");
      },
      { now },
    );
    expect(r.httpStatus).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain("ECONNREFUSED");
  });

  it("response มีเฉพาะ 3 ช่อง", async () => {
    const r = await checkHealth(async () => ({ error: null }), { now });
    expect(Object.keys(r.body).sort()).toEqual(["checkedAt", "db", "status"]);
  });

  describe("timeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("probe ค้างเกินเวลา → 503 และสั่ง abort", async () => {
      let aborted = false;
      const p = checkHealth(
        (signal) => {
          signal.addEventListener("abort", () => (aborted = true));
          return new Promise(() => {}); // ค้างตลอด
        },
        { timeoutMs: 5000, now },
      );
      await vi.advanceTimersByTimeAsync(5000);
      const r = await p;
      expect(r.httpStatus).toBe(503);
      expect(r.body.db).toBe("down");
      expect(aborted).toBe(true);
    });
  });
});

describe("GET /api/health (route)", () => {
  const fromMock = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-should-not-be-used");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@supabase/supabase-js");
    fromMock.mockReset();
  });

  async function loadRoute(result: () => Promise<{ error: unknown }>) {
    const createClient = vi.fn<(url: string, key: string, options: unknown) => unknown>(() => ({
      from: (table: string) => {
        fromMock(table);
        return { select: () => ({ limit: () => ({ abortSignal: () => result() }) }) };
      },
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    const route = await import("@/app/api/health/route");
    return { route, createClient };
  }

  it("DB ปกติ → 200 + no-store + ใช้ anon key อ่าน v_branch_summary", async () => {
    const { route, createClient } = await loadRoute(async () => ({ error: null }));
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(Object.keys(json).sort()).toEqual(["checkedAt", "db", "status"]);
    expect(fromMock).toHaveBeenCalledWith("v_branch_summary");
    expect(createClient).toHaveBeenCalledWith(
      "http://localhost:54321",
      "anon-test-key",
      expect.anything(),
    );
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("DB error → 503 + no-store", async () => {
    const { route } = await loadRoute(async () => ({ error: { message: "boom" } }));
    const res = await route.GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ status: "down", db: "down" });
  });

  it("ไม่มี env → 503", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { route } = await loadRoute(async () => ({ error: null }));
    expect((await route.GET()).status).toBe(503);
  });
});
