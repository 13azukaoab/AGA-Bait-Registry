import { describe, expect, it, vi } from "vitest";

import { fetchCentralReadiness, fetchPostCloseEdits } from "./monthsRpc";
import type { Perms } from "./monthsLogic";

const host: Perms = { isHost: true, canCloseCentral: true, canCloseProvince: true };
const recorder: Perms = { isHost: false, canCloseCentral: true, canCloseProvince: false };
const other: Perms = { isHost: false, canCloseCentral: false, canCloseProvince: false };

type Client = Parameters<typeof fetchPostCloseEdits>[0];

function client(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { rpc } as unknown as Client & { rpc: ReturnType<typeof vi.fn> };
}

describe("fetchPostCloseEdits — กัน recorder เรียก province", () => {
  it("recorder + province = ไม่ยิง RPC เลย คืน forbidden", async () => {
    const c = client({ data: [] });
    const out = await fetchPostCloseEdits(c, "2026-10", "province", recorder);
    expect(out).toEqual({ kind: "error", code: "forbidden" });
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("role อื่นที่ปิดส่วนกลางไม่ได้ = ไม่ยิง RPC ทั้ง 2 scope", async () => {
    const c = client({ data: [] });
    await fetchPostCloseEdits(c, "2026-10", "central", other);
    await fetchPostCloseEdits(c, "2026-10", "province", other);
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("recorder + central = เรียก RPC ด้วย p_month/p_scope", async () => {
    const c = client({ data: [] });
    const out = await fetchPostCloseEdits(c, "2026-10", "central", recorder);
    expect(out).toEqual({ kind: "ok", rows: [] });
    expect(c.rpc).toHaveBeenCalledWith("list_post_close_edits", { p_month: "2026-10", p_scope: "central" });
  });
  it("host เรียกได้ทั้ง 2 scope", async () => {
    const c = client({ data: [] });
    await fetchPostCloseEdits(c, "2026-10", "central", host);
    await fetchPostCloseEdits(c, "2026-10", "province", host);
    expect(c.rpc).toHaveBeenCalledTimes(2);
  });
  it("DB 42501 → forbidden · error อื่น → load_failed (ไม่คืนข้อความดิบ)", async () => {
    expect(await fetchPostCloseEdits(client({ error: { code: "42501", message: "ลับ" } }), "2026-10", "central", host)).toEqual({ kind: "error", code: "forbidden" });
    expect(await fetchPostCloseEdits(client({ error: { code: "XX000", message: "ลับ" } }), "2026-10", "central", host)).toEqual({ kind: "error", code: "load_failed" });
  });
  it("รูปแบบข้อมูลผิด = load_failed (ไม่แสดงเหมือนไม่มีการแก้)", async () => {
    expect(await fetchPostCloseEdits(client({ data: { a: 1 } }), "2026-10", "central", host)).toEqual({ kind: "error", code: "load_failed" });
  });
  it("RPC โยน exception = load_failed", async () => {
    const c = { rpc: vi.fn().mockRejectedValue(new Error("net")) } as unknown as Client;
    expect(await fetchPostCloseEdits(c, "2026-10", "central", host)).toEqual({ kind: "error", code: "load_failed" });
  });
});

describe("fetchCentralReadiness", () => {
  it("แปลงแถว RPC", async () => {
    const c = client({ data: [{ branch_id: "b1", branch_name: "นครปฐม", pending_count: 3 }] });
    const out = await fetchCentralReadiness(c, "2026-10", recorder);
    expect(out).toEqual({ kind: "ok", rows: [{ branchId: "b1", name: "นครปฐม", pending: 3 }] });
    expect(c.rpc).toHaveBeenCalledWith("get_central_readiness", { p_month: "2026-10" });
  });
  it("ปิดส่วนกลางไม่ได้ = ไม่ยิง RPC", async () => {
    const c = client({ data: [] });
    expect(await fetchCentralReadiness(c, "2026-10", other)).toEqual({ kind: "error", code: "forbidden" });
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("error → load_failed ไม่รั่วข้อความดิบ", async () => {
    expect(await fetchCentralReadiness(client({ error: { code: "MC001", message: "ลับ" } }), "bad", host)).toEqual({ kind: "error", code: "load_failed" });
  });
});
