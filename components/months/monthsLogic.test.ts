import { describe, expect, it, vi } from "vitest";

import { parseCloseResponse, parseResyncResponse, postClose, postResync } from "./monthsApi";
import {
  buildMonthList,
  canCloseScope,
  canOverrideReady,
  canResync,
  closeFormError,
  describeError,
  ERROR_TEXT,
  groupMissedByBranch,
  isConfirmKeyValid,
  isValidOverrideReason,
  summarizeSync,
  syncLabel,
  tableLabelTh,
  type Perms,
} from "./monthsLogic";

describe("buildMonthList", () => {
  const closures = [
    { month_key: "2026-09", scope: "central" as const, closed_at: "2026-10-05T02:12:00Z", closed_by_name: "ผู้ทดสอบ ก" },
    { month_key: "2026-09", scope: "province" as const, closed_at: "2026-10-05T02:30:00Z", closed_by_name: "ผู้ทดสอบ ข" },
    { month_key: "2026-10", scope: "central" as const, closed_at: "2026-11-05T02:00:00Z", closed_by_name: null },
  ];
  const list = buildMonthList({ currentMonth: "2026-11", goLiveMonth: "2026-09", closures });

  it("เรียงใหม่→เก่า ตั้งแต่ go-live ถึงเดือนปัจจุบัน", () => {
    expect(list.map((m) => m.month)).toEqual(["2026-11", "2026-10", "2026-09"]);
    expect(list.map((m) => m.key)).toEqual(["NOV.26", "OCT.26", "SEP.26"]);
  });
  it("เดือนปัจจุบัน = progress ทั้งคู่", () => {
    expect(list[0]!.central.status).toBe("progress");
    expect(list[0]!.province.status).toBe("progress");
  });
  it("เดือนจบแล้วที่ยังไม่มีแถวปิด = open · มีแถว = closed", () => {
    expect(list[1]!.central.status).toBe("closed");
    expect(list[1]!.province.status).toBe("open");
    expect(list[1]!.complete).toBe(false);
  });
  it("ปิดครบ 2 ส่วน = complete", () => {
    expect(list[2]!.complete).toBe(true);
    expect(list[2]!.central.closedByName).toBe("ผู้ทดสอบ ก");
  });
  it("ไม่รู้ go-live = ย้อนหลัง 6 เดือน", () => {
    expect(buildMonthList({ currentMonth: "2026-11", goLiveMonth: null, closures: [] })).toHaveLength(6);
  });
  it("เดือนก่อน go-live ไม่อยู่ในรายการ", () => {
    expect(buildMonthList({ currentMonth: "2026-11", goLiveMonth: "2026-11", closures: [] })).toHaveLength(1);
  });
});

describe("สิทธิ์ซ่อนปุ่ม", () => {
  const host: Perms = { isHost: true, canCloseCentral: true, canCloseProvince: true };
  const recorder: Perms = { isHost: false, canCloseCentral: true, canCloseProvince: false };
  const recorderNoCentral: Perms = { isHost: false, canCloseCentral: false, canCloseProvince: false };
  it("host ปิดได้ทั้งสองส่วน + คำนวณใหม่ + ปิดข้าม", () => {
    expect(canCloseScope(host, "central")).toBe(true);
    expect(canCloseScope(host, "province")).toBe(true);
    expect(canResync(host)).toBe(true);
    expect(canOverrideReady(host)).toBe(true);
  });
  it("recorder ปิดได้เฉพาะส่วนกลาง ไม่มี resync/ปิดข้าม", () => {
    expect(canCloseScope(recorder, "central")).toBe(true);
    expect(canCloseScope(recorder, "province")).toBe(false);
    expect(canResync(recorder)).toBe(false);
    expect(canOverrideReady(recorder)).toBe(false);
  });
  it("recorder ที่ไม่มีส่วนกลางใน division_scope ปิดไม่ได้", () => {
    expect(canCloseScope(recorderNoCentral, "central")).toBe(false);
  });
});

describe("ยืนยันปิดเดือน", () => {
  it("key ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย", () => {
    expect(isConfirmKeyValid(" oct.26 ", "2026-10")).toBe(true);
    expect(isConfirmKeyValid("OCT.26", "2026-10")).toBe(true);
    expect(isConfirmKeyValid("OCT.25", "2026-10")).toBe(false);
    expect(isConfirmKeyValid("", "2026-10")).toBe(false);
  });
  it("เหตุผล 5–500 ตัว ไม่นับช่องว่างหัวท้าย", () => {
    expect(isValidOverrideReason("    abcd   ")).toBe(false);
    expect(isValidOverrideReason("abcde")).toBe(true);
    expect(isValidOverrideReason("x".repeat(500))).toBe(true);
    expect(isValidOverrideReason("x".repeat(501))).toBe(false);
  });
  it("closeFormError เรียงลำดับ เหตุผล → รับทราบ → key", () => {
    const base = { month: "2026-10", typed: "OCT.26", needAck: false, ack: false, needReason: false, reason: "" };
    expect(closeFormError(base)).toBeNull();
    expect(closeFormError({ ...base, needReason: true })).toContain("เหตุผล");
    expect(closeFormError({ ...base, needAck: true })).toContain("รับทราบ");
    expect(closeFormError({ ...base, needAck: true, ack: true, typed: "x" })).toContain("OCT.26");
  });
});

describe("แปลง error เป็นข้อความไทย", () => {
  it("ทุก code มีข้อความไทยไม่ว่าง", () => {
    for (const [code, text] of Object.entries(ERROR_TEXT)) {
      expect(text.length, code).toBeGreaterThan(3);
      expect(/[ก-๙]/.test(text), code).toBe(true);
    }
  });
  it("code แปลก/ข้อความดิบ = ข้อความกลาง ไม่โชว์ของดิบ", () => {
    expect(describeError("relation \"visits\" does not exist")).toBe(ERROR_TEXT.unknown);
    expect(describeError(undefined)).toBe(ERROR_TEXT.unknown);
    expect(describeError("toString")).toBe(ERROR_TEXT.unknown);
  });
  it("syncLabel ครบทุกผล", () => {
    expect(syncLabel("success").tone).toBe("ok");
    expect(syncLabel("failed").tone).toBe("danger");
    expect(syncLabel("busy").tone).toBe("warn");
    expect(syncLabel("not_started").tone).toBe("warn");
    expect(syncLabel("???").tone).toBe("danger");
  });
});

describe("summarizeSync / ตาราง / ตกบริการ", () => {
  it("เอาเวลาสำเร็จล่าสุด และดูรอบล่าสุดว่าล้มเหลวไหม", () => {
    const rows = [
      { source: "auto", started_at: "a", finished_at: "2026-11-06T00:00:00Z", result: "success", error_code: null },
      { source: "close", started_at: "b", finished_at: "2026-11-07T00:00:00Z", result: "failed", error_code: "x" },
    ];
    expect(summarizeSync(rows)).toEqual({ lastSuccessAt: "2026-11-06T00:00:00Z", latestFailed: true });
    expect(summarizeSync([])).toEqual({ lastSuccessAt: null, latestFailed: false });
  });
  it("ชื่อตารางเป็นไทย", () => {
    expect(tableLabelTh("visits")).toBe("ผลบริการ");
    expect(tableLabelTh("station_checks")).toBe("ผลตรวจสถานี");
    expect(tableLabelTh("other")).toBe("ข้อมูลบริการ");
  });
  it("groupMissedByBranch", () => {
    const names = new Map([["b1", "สาขา ก"], ["b2", "สาขา ข"]]);
    const mk = (branchId: string) => ({ contractId: "c", branchId, contractNo: "n", customerName: "x" });
    expect(groupMissedByBranch([mk("b2"), mk("b1"), mk("b1"), mk("b3")], names)).toEqual([
      { branchId: "b1", name: "สาขา ก", count: 2 },
      { branchId: "b2", name: "สาขา ข", count: 1 },
      { branchId: "b3", name: "สาขาไม่ทราบชื่อ", count: 1 },
    ]);
  });
});

describe("monthsApi", () => {
  it("200 → ok", () => {
    const r = parseCloseResponse(200, {
      ok: true,
      closure: { month: "2026-10", scope: "central", closedAt: "t", overridden: true, unreadyCount: 2, carriedCount: 0 },
      sync: { result: "failed", errorCode: "x", monthsSent: [] },
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.closure.overridden).toBe(true);
      expect(r.sync.result).toBe("failed");
    }
  });
  it("409 branches_not_ready → not_ready พร้อม canOverride", () => {
    const r = parseCloseResponse(409, { ok: false, errorCode: "branches_not_ready", branches: [{ id: "1", name: "ก", pending: 3 }], canOverride: true });
    expect(r).toEqual({ kind: "not_ready", branches: [{ id: "1", name: "ก", pending: 3 }], canOverride: true });
  });
  it("409 carried_not_acknowledged → carried", () => {
    expect(parseCloseResponse(409, { errorCode: "carried_not_acknowledged", branches: [{ id: "2", name: "ข" }] }).kind).toBe("carried");
  });
  it("error อื่น/ตัวหน้ากาก → error(code) ไม่เอา message", () => {
    expect(parseCloseResponse(403, { errorCode: "forbidden", message: "secret" })).toEqual({ kind: "error", code: "forbidden" });
    expect(parseCloseResponse(500, null)).toEqual({ kind: "error", code: "unknown" });
  });
  it("resync", () => {
    expect(parseResyncResponse(200, { ok: true, resync: { month: "2026-09", scope: "province", changedBranches: 0 }, sync: { result: "success", monthsSent: ["SEP.26"] } }).kind).toBe("ok");
    expect(parseResyncResponse(409, { errorCode: "stale_resync" })).toEqual({ kind: "error", code: "stale_resync" });
  });
  it("postClose ส่งเฉพาะฟิลด์ที่ตกลง ไม่มีตัวเลข", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: false, errorCode: "already_closed" }), { status: 409 }));
    const r = await postClose({ month: "2026-10", scope: "central", confirmKey: "OCT.26", acknowledgeCarried: true }, f as unknown as typeof fetch);
    expect(r).toEqual({ kind: "error", code: "already_closed" });
    const calls = f.mock.calls as unknown as [string, { body: string }][];
    expect(calls[0]![0]).toBe("/api/months/close");
    expect(JSON.parse(calls[0]![1].body)).toEqual({ month: "2026-10", scope: "central", confirmKey: "OCT.26", acknowledgeCarried: true });
  });
  it("เครือข่ายล้ม = network", async () => {
    const f = vi.fn(async () => {
      throw new Error("x");
    });
    expect(await postClose({ month: "2026-10", scope: "central", confirmKey: "OCT.26" }, f as unknown as typeof fetch)).toEqual({ kind: "error", code: "network" });
    expect(await postResync({ month: "2026-10", scope: "central" }, f as unknown as typeof fetch)).toEqual({ kind: "error", code: "network" });
  });
});

describe("formatBangkok", () => {
  it("แปลงเป็นเวลาไทย", async () => {
    const { formatBangkok } = await import("./monthsLogic");
    expect(formatBangkok("2026-10-05T02:12:00Z")).toBe("05/10/2026 09:12");
    expect(formatBangkok(null)).toBe("—");
    expect(formatBangkok("xx")).toBe("—");
  });
});
