import { describe, expect, it, vi } from "vitest";

import { BRANCHES } from "./branches";
import { DashboardSyncError } from "./errors";
import {
  centralSnapshotPayload,
  closeMonth,
  mapMonthCloseError,
  resyncMonth,
  syncAfter,
  type CentralSnapshotPayloadRow,
  type MonthClosePorts,
} from "./monthClose";
import type { RunOutcome } from "./runSync";
import type { CentralRegistry } from "./sources";

// ข้อมูลสมมติทั้งหมด · ไม่ต่อฐานข้อมูล / GitHub

const CENTRAL = BRANCHES.filter((b) => b.division === "central");
const idByName = new Map(BRANCHES.map((b, i) => [b.branch, `id-${i}`]));

const RULES = [
  { tier: "S", minAnnual: 0, effectiveMonth: undefined },
  { tier: "M", minAnnual: 30000, effectiveMonth: undefined },
  { tier: "L", minAnnual: 50000, effectiveMonth: undefined },
  { tier: "XL", minAnnual: 100000, effectiveMonth: undefined },
] as unknown as CentralRegistry["rules"];

function registry(): CentralRegistry {
  return {
    rules: RULES,
    visits: [],
    contracts: [
      {
        id: "k1", customerId: "cu1", branch: "นครปฐม", startDate: "2026-10-05", termMonths: 12,
        valueTotal: 40000,
      },
      // สาขาต่างจังหวัด → ไม่อยู่ในแถวส่วนกลาง
      { id: "k2", customerId: "cu2", branch: "เชียงใหม่", startDate: "2026-10-05", termMonths: 12, valueTotal: 999 },
    ],
  } as CentralRegistry;
}

const okOutcome: RunOutcome = {
  status: "done", logId: 9, result: "success", message: "ส่งแล้ว", monthsSent: ["OCT.26"], monthCount: 22,
};

function ports(over: Partial<MonthClosePorts> = {}): MonthClosePorts & { calls: string[] } {
  const calls: string[] = [];
  const rows: CentralSnapshotPayloadRow[] = [];
  return {
    calls,
    centralRows: vi.fn(async (m: string) => {
      calls.push(`rows:${m}`);
      return rows;
    }),
    closePart: vi.fn(async (a) => {
      calls.push(`close:${a.month}:${a.scope}:${a.rows === null ? "null" : "rows"}`);
      return { month: a.month, scope: a.scope, closedAt: "2026-11-02T00:00:00Z", overridden: false, unreadyCount: 0, carriedCount: 0 };
    }),
    resyncPart: vi.fn(async (a) => {
      calls.push(`resync:${a.month}:${a.scope}:${a.rows === null ? "null" : "rows"}`);
      return { month: a.month, scope: a.scope, changedBranches: 2 };
    }),
    sync: vi.fn(async (source) => {
      calls.push(`sync:${source}`);
      return okOutcome;
    }),
    ...over,
  };
}

describe("centralSnapshotPayload", () => {
  it("คืนครบ 24 สาขาส่วนกลาง เป็น branch_id ไม่มีต่างจังหวัด", () => {
    const rows = centralSnapshotPayload(registry(), idByName, "2026-10");
    expect(rows).toHaveLength(CENTRAL.length);
    expect(new Set(rows.map((r) => r.branch_id))).toEqual(new Set(CENTRAL.map((b) => idByName.get(b.branch))));
    const np = rows.find((r) => r.branch_id === idByName.get("นครปฐม"))!;
    expect(np).toMatchObject({ m1: 1, cust: 1, vM: 40000, value: 40000 });
    expect(rows.reduce((s, r) => s + r.value, 0)).toBe(40000);
  });

  it("ไม่พบ id ของสาขา = load_failed", () => {
    expect(() => centralSnapshotPayload(registry(), new Map(), "2026-10")).toThrow(DashboardSyncError);
  });
});

describe("mapMonthCloseError", () => {
  it.each([
    ["MC001", 400, "invalid_month"],
    ["MC002", 409, "month_not_ended"],
    ["MC003", 409, "before_go_live"],
    ["MC004", 409, "already_closed"],
    ["MC005", 500, "invalid_rows"],
    ["MC007", 400, "invalid_reason"],
    ["MC008", 409, "non_computed_rows"],
    ["MC010", 409, "not_closed"],
    ["MC011", 400, "invalid_closer"],
    ["MC012", 400, "invalid_closed_at"],
    ["MC013", 409, "stale_resync"],
    ["42501", 403, "forbidden"],
  ])("%s → %i %s", (code, status, errorCode) => {
    expect(mapMonthCloseError({ code, message: "internal db text" })).toMatchObject({ status, errorCode });
  });

  it("MC014 → 403 override_host_only", () => {
    expect(mapMonthCloseError({ code: "MC014" })).toMatchObject({ status: 403, errorCode: "override_host_only" });
  });

  it("MC006 / MC009 แนบรายชื่อสาขา (+จำนวนสัญญาค้าง · canOverride) จาก DETAIL", () => {
    const notReady = JSON.stringify({ branches: [{ id: "a", name: "นครปฐม", pending: 3 }], can_override: false });
    expect(mapMonthCloseError({ code: "MC006", details: notReady })).toEqual({
      status: 409,
      errorCode: "branches_not_ready",
      message: expect.any(String),
      branches: [{ id: "a", name: "นครปฐม", pending: 3 }],
      canOverride: false,
    });
    const details = JSON.stringify({ branches: [{ id: "a", name: "นครปฐม" }] });
    expect(mapMonthCloseError({ code: "MC009", details })).toMatchObject({
      errorCode: "carried_not_acknowledged", branches: [{ id: "a", name: "นครปฐม" }],
    });
    expect(mapMonthCloseError({ code: "MC006", details: "not json" }).branches).toBeUndefined();
  });

  it("ไม่รู้จัก / โหลดข้อมูลพัง → ไม่ส่งข้อความภายในถึงหน้าจอ", () => {
    const unknown = mapMonthCloseError({ code: "XX000", message: "relation secret_table" });
    expect(unknown).toMatchObject({ status: 500, errorCode: "unknown" });
    expect(unknown.message).not.toContain("secret_table");
    expect(mapMonthCloseError(new DashboardSyncError("load_failed", "อ่าน contracts ไม่สำเร็จ"))).toMatchObject({
      status: 500, errorCode: "load_failed",
    });
    expect(mapMonthCloseError(null).errorCode).toBe("unknown");
  });
});

describe("closeMonth", () => {
  it("ส่วนกลาง: คำนวณแถว → ปิด → ส่ง source close (ตามลำดับ)", async () => {
    const p = ports();
    const out = await closeMonth(p, { month: "2026-10", scope: "central" });
    expect(p.calls).toEqual(["rows:2026-10", "close:2026-10:central:rows", "sync:close"]);
    expect(out.sync).toMatchObject({ result: "success", logId: 9, monthsSent: ["OCT.26"] });
  });

  it("ต่างจังหวัด: ไม่คำนวณแถว (rows = null)", async () => {
    const p = ports();
    await closeMonth(p, { month: "2026-10", scope: "province", acknowledgeCarried: true });
    expect(p.calls).toEqual(["close:2026-10:province:null", "sync:close"]);
    expect(p.closePart).toHaveBeenCalledWith(expect.objectContaining({ acknowledgeCarried: true }));
  });

  it("ปิดไม่สำเร็จ → throw ต่อ และไม่ส่ง Dashboard", async () => {
    const p = ports({
      closePart: vi.fn(async () => {
        throw Object.assign(new Error("x"), { code: "MC004" });
      }),
    });
    await expect(closeMonth(p, { month: "2026-10", scope: "central" })).rejects.toMatchObject({ code: "MC004" });
    expect(p.sync).not.toHaveBeenCalled();
  });

  it("ปิดสำเร็จแต่ส่งไม่สำเร็จ → ยังคืนผลการปิด + sync failed", async () => {
    const p = ports({
      sync: vi.fn(async () => ({ ...okOutcome, result: "failed" as const, errorCode: "github_502", message: "GitHub ขัดข้อง", monthsSent: [] })),
    });
    const out = await closeMonth(p, { month: "2026-10", scope: "central" });
    expect(out.closure.closedAt).toBe("2026-11-02T00:00:00Z");
    expect(out.sync).toMatchObject({ result: "failed", errorCode: "github_502" });
  });
});

describe("resyncMonth", () => {
  it("ส่วนกลาง: คำนวณใหม่ → เขียนทับ → ส่ง source resync", async () => {
    const p = ports();
    const out = await resyncMonth(p, { month: "2026-10", scope: "central" }, () => new Date("2026-11-18T08:00:00Z"));
    expect(p.calls).toEqual(["rows:2026-10", "resync:2026-10:central:rows", "sync:resync"]);
    // เวลาเริ่มคำนวณถูกจับก่อนอ่านทะเบียน แล้วส่งให้ RPC กันเขียนทับด้วยตัวเลขเก่า
    expect(p.resyncPart).toHaveBeenCalledWith(expect.objectContaining({ computedAt: "2026-11-18T08:00:00.000Z" }));
    expect(out.resync.changedBranches).toBe(2);
  });

  it("ต่างจังหวัด: ไม่คำนวณ ส่งใหม่อย่างเดียว", async () => {
    const p = ports();
    await resyncMonth(p, { month: "2026-10", scope: "province" });
    expect(p.calls).toEqual(["resync:2026-10:province:null", "sync:resync"]);
  });
});

describe("syncAfter", () => {
  it("มีรอบอื่นกำลังส่ง (SY001) → busy ไม่ throw", async () => {
    const p = ports({ sync: vi.fn(async () => { throw Object.assign(new Error("busy"), { code: "SY001" }); }) });
    expect(await syncAfter(p, "close")).toMatchObject({ result: "busy", errorCode: "busy", monthsSent: [] });
  });

  it("เริ่มรอบไม่ได้ (สิทธิ์ / อื่น ๆ) → not_started", async () => {
    const forbidden = ports({ sync: vi.fn(async () => { throw Object.assign(new Error("no"), { code: "42501" }); }) });
    expect(await syncAfter(forbidden, "close")).toMatchObject({ result: "not_started", errorCode: "forbidden" });
    const other = ports({ sync: vi.fn(async () => { throw new Error("network"); }) });
    expect(await syncAfter(other, "resync")).toMatchObject({ result: "not_started", errorCode: "start_failed" });
  });

  it("load_failed → ซ่อนข้อความภายใน", async () => {
    const p = ports({
      sync: vi.fn(async () => ({ ...okOutcome, result: "failed" as const, errorCode: "load_failed", message: "อ่าน contracts ไม่สำเร็จ: secret" })),
    });
    const out = await syncAfter(p, "close");
    expect(out.message).not.toContain("secret");
  });

  it("บันทึก log ไม่สำเร็จ → errorCode log_failed", async () => {
    const p = ports({ sync: vi.fn(async () => ({ ...okOutcome, logError: "db down" })) });
    expect(await syncAfter(p, "close")).toMatchObject({ result: "success", errorCode: "log_failed" });
  });
});
