import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// service role จำลอง — ไม่ต่อฐานข้อมูลจริง · ข้อมูลสมมติทั้งหมด
const adminRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: adminRpc })),
}));

import { createAdminClient } from "@/lib/supabase/admin";

import { closeMonthForUser, resyncMonthForUser } from "./monthCloseAdmin";

function userClient(user: { id: string } | null, rpc: Record<string, unknown>) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: vi.fn(async (name: string) => ({ data: rpc[name] ?? null, error: null })),
  } as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  adminRpc.mockReset();
  vi.mocked(createAdminClient).mockClear();
});

describe("closeMonthForUser — ตรวจผู้ใช้ + สิทธิ์ที่ DB ก่อนใช้ service role", () => {
  it("ไม่ได้ล็อกอิน → 42501 และไม่สร้าง service role", async () => {
    await expect(
      closeMonthForUser(userClient(null, {}), { month: "2026-10", scope: "province" }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("can_close_month_part = false → 42501 และไม่สร้าง service role", async () => {
    const client = userClient({ id: "u1" }, { can_close_month_part: false });
    await expect(closeMonthForUser(client, { month: "2026-10", scope: "province" })).rejects.toMatchObject({
      code: "42501",
    });
    expect(client.rpc).toHaveBeenCalledWith("can_close_month_part", { p_scope: "province" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("ผ่านด่าน → RPC ปิดเดือนด้วย service role ในนาม user id จาก getUser", async () => {
    adminRpc.mockImplementation(async (name: string) =>
      name === "close_month_part"
        ? { data: { month: "2026-10", scope: "province", closed_at: "x", overridden: false }, error: null }
        : { data: null, error: { message: "busy", code: "SY001" } },
    );
    const out = await closeMonthForUser(userClient({ id: "u1" }, { can_close_month_part: true }), {
      month: "2026-10",
      scope: "province",
      acknowledgeCarried: true,
    });
    expect(adminRpc).toHaveBeenCalledWith("close_month_part", expect.objectContaining({ p_actor: "u1" }));
    expect(out.sync.result).toBe("busy");
  });
});

describe("resyncMonthForUser", () => {
  it("ไม่ใช่ host → 42501 และไม่สร้าง service role", async () => {
    await expect(
      resyncMonthForUser(userClient({ id: "u2" }, { is_host: false }), { month: "2026-10", scope: "province" }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
