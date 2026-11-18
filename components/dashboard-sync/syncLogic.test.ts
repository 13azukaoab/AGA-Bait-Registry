import { describe, expect, it } from "vitest";

import {
  autoStreak,
  canTriggerSync,
  deriveSyncState,
  describeSyncError,
  elapsedSeconds,
  failureStats,
  filterLogs,
  formatThaiDateTime,
  groupHistory,
  interpretSyncResponse,
  nextAutoSyncLabel,
  relativeDay,
  sourceLabel,
  type SyncLogRow,
} from "./syncLogic";

let seq = 0;
function log(over: Partial<SyncLogRow> & { startedAt: string }): SyncLogRow {
  seq += 1;
  return {
    id: seq,
    source: "auto",
    triggeredByName: null,
    finishedAt: over.startedAt.replace(/:\d\dZ$/, ":05Z"),
    result: "success",
    errorCode: null,
    monthsSent: [],
    monthCount: 22,
    commitSha: null,
    ...over,
  };
}

describe("canTriggerSync — ซ่อนปุ่มตาม role", () => {
  it("มีเฉพาะ host", () => {
    expect(canTriggerSync("host")).toBe(true);
    for (const r of ["recorder", "admin", "viewer", "", null, undefined]) expect(canTriggerSync(r)).toBe(false);
  });
});

describe("deriveSyncState", () => {
  it("ยังไม่ตั้ง token = not_configured แม้ไม่มี log เลย", () => {
    expect(deriveSyncState([], false)).toBe("not_configured");
  });
  it("ตั้งแล้วแต่ยังไม่เคยส่ง = never_sent", () => {
    expect(deriveSyncState([], true)).toBe("never_sent");
    // export ไม่นับเป็นการส่ง
    expect(deriveSyncState([log({ startedAt: "2026-11-01T01:00:00Z", source: "export" })], true)).toBe("never_sent");
  });
  it("รอบล่าสุดล้มเหลวด้วย config_missing = not_configured (ไม่ใช่ last_failed)", () => {
    const l = log({ startedAt: "2026-11-01T01:00:00Z", result: "failed", errorCode: "config_missing" });
    expect(deriveSyncState([l], true)).toBe("not_configured");
  });
  it("ล้มเหลวด้วยรหัสอื่น = last_failed · ข้าม = last_skipped · สำเร็จ = last_ok · กำลังส่ง = running", () => {
    expect(deriveSyncState([log({ startedAt: "2026-11-01T01:00:00Z", result: "failed", errorCode: "github_502" })], true)).toBe("last_failed");
    expect(deriveSyncState([log({ startedAt: "2026-11-01T01:00:00Z", result: "skipped" })], true)).toBe("last_skipped");
    expect(deriveSyncState([log({ startedAt: "2026-11-01T01:00:00Z" })], true)).toBe("last_ok");
    expect(deriveSyncState([log({ startedAt: "2026-11-01T01:00:00Z", result: null, finishedAt: null })], true)).toBe("running");
  });
  it("ใช้รอบล่าสุดตามเวลา ไม่ใช่ลำดับใน array", () => {
    const old = log({ startedAt: "2026-10-01T01:00:00Z", result: "failed", errorCode: "github_401" });
    const recent = log({ startedAt: "2026-11-01T01:00:00Z" });
    expect(deriveSyncState([recent, old], true)).toBe("last_ok");
    expect(deriveSyncState([old, recent], true)).toBe("last_ok");
  });
});

describe("describeSyncError — ไม่มีข้อความดิบ", () => {
  it("config_missing = ยังไม่ได้ตั้งค่า (kind config)", () => {
    const e = describeSyncError("config_missing");
    expect(e.kind).toBe("config");
    expect(e.title).toContain("ยังไม่ได้ตั้งค่า");
  });
  it("github_<status> แปลงตามกลุ่ม", () => {
    expect(describeSyncError("github_401").kind).toBe("auth");
    expect(describeSyncError("github_403").kind).toBe("auth");
    expect(describeSyncError("github_404").kind).toBe("config");
    expect(describeSyncError("github_502").kind).toBe("transient");
    expect(describeSyncError("github_418").kind).toBe("unknown");
  });
  it("รหัสไม่รู้จัก/ว่าง/ข้อความแปลกปลอม = ข้อความกลาง ไม่สะท้อนค่าเดิม", () => {
    for (const c of [null, undefined, "", "weird", "DROP TABLE x", "github_abc"]) {
      const e = describeSyncError(c);
      expect(e.kind).toBe("unknown");
      expect(`${e.title}${e.fix}`).not.toMatch(/DROP|weird|github_abc/);
    }
  });
  it("ทุกรหัสของ DashboardSyncError มีข้อความไทย", () => {
    for (const c of [
      "config_missing", "invalid_data", "months_dropped", "value_drop", "legacy_missing",
      "closed_snapshot_missing", "index_missing", "index_marker_missing", "load_failed", "unknown", "timeout", "busy",
    ]) {
      const e = describeSyncError(c);
      expect(e.title).toMatch(/[ก-๙]/);
      expect(e.fix).toMatch(/[ก-๙]|ไม่ต้อง/);
    }
  });
});

describe("interpretSyncResponse", () => {
  it("200 success / skipped", () => {
    expect(interpretSyncResponse(200, { ok: true, result: "success" }).kind).toBe("success");
    expect(interpretSyncResponse(200, { ok: true, result: "skipped" }).kind).toBe("skipped");
  });
  it("502 config_missing = failed + notConfigured (ไม่ใช้ message ดิบ)", () => {
    const o = interpretSyncResponse(502, { ok: false, result: "failed", errorCode: "config_missing", message: "ยังไม่ได้ตั้ง DASHBOARD_GITHUB_TOKEN" });
    expect(o).toMatchObject({ kind: "failed", notConfigured: true });
    expect(o.message).not.toContain("DASHBOARD_GITHUB_TOKEN");
  });
  it("502 รหัสอื่น = failed แต่ไม่ใช่ notConfigured", () => {
    expect(interpretSyncResponse(502, { ok: false, result: "failed", errorCode: "github_502", message: "raw" })).toMatchObject({
      kind: "failed",
      notConfigured: false,
    });
  });
  it("409 / busy · 401 / 403 · 500 · body แปลก", () => {
    expect(interpretSyncResponse(409, { ok: false, errorCode: "busy" }).kind).toBe("busy");
    expect(interpretSyncResponse(401, {}).kind).toBe("denied");
    expect(interpretSyncResponse(403, { errorCode: "forbidden" }).kind).toBe("denied");
    expect(interpretSyncResponse(500, { ok: false, errorCode: "start_failed" }).kind).toBe("error");
    expect(interpretSyncResponse(500, null).kind).toBe("error");
    expect(interpretSyncResponse(502, "<html>").kind).toBe("error");
  });
});

describe("เวลาไทย", () => {
  it("UTC → ไทย +7 (ข้ามวัน)", () => {
    expect(formatThaiDateTime("2026-11-05T23:30:00Z")).toBe("06/11/2026 06:30");
    expect(formatThaiDateTime("bad")).toBe("-");
    expect(formatThaiDateTime(null)).toBe("-");
  });
  it("relativeDay ตามวันปฏิทินไทย", () => {
    const now = Date.parse("2026-11-06T05:00:00Z"); // 12:00 ไทย
    expect(relativeDay("2026-11-05T23:30:00Z", now)).toBe("วันนี้"); // 06:30 ไทย วันที่ 6
    expect(relativeDay("2026-11-05T10:00:00Z", now)).toBe("เมื่อวาน");
    expect(relativeDay("2026-11-01T10:00:00Z", now)).toBe("5 วันที่แล้ว");
  });
  it("nextAutoSyncLabel: ก่อน 06:00 = วันนี้ · หลัง = พรุ่งนี้", () => {
    expect(nextAutoSyncLabel(Date.parse("2026-11-05T20:00:00Z"))).toBe("06/11/2026 ~06:00"); // 03:00 ไทย
    expect(nextAutoSyncLabel(Date.parse("2026-11-06T05:00:00Z"))).toBe("07/11/2026 ~06:00"); // 12:00 ไทย
    expect(nextAutoSyncLabel(Date.parse("2026-11-30T20:00:00Z"))).toBe("01/12/2026 ~06:00"); // ข้ามเดือน
  });
  it("elapsedSeconds", () => {
    expect(elapsedSeconds({ startedAt: "2026-11-01T01:00:00Z", finishedAt: "2026-11-01T01:00:04Z" })).toBe(4);
    expect(elapsedSeconds({ startedAt: "2026-11-01T01:00:00Z", finishedAt: null })).toBeNull();
    expect(elapsedSeconds({ startedAt: "2026-11-01T01:00:10Z", finishedAt: "2026-11-01T01:00:00Z" })).toBeNull();
  });
});

describe("สถิติ", () => {
  const logs = [
    log({ startedAt: "2026-11-05T23:10:00Z" }),
    log({ startedAt: "2026-11-04T23:10:00Z", result: "skipped" }),
    log({ startedAt: "2026-11-03T23:10:00Z", result: "failed", errorCode: "github_502" }),
    log({ startedAt: "2026-11-02T23:10:00Z" }),
  ];
  it("autoStreak นับถึงรอบล้มเหลวล่าสุด", () => {
    expect(autoStreak(logs)).toBe(2);
    expect(autoStreak([])).toBe(0);
  });
  it("failureStats: ล้มเหลวที่มีส่งสำเร็จตามหลังแล้ว = ไม่ค้าง", () => {
    const now = Date.parse("2026-11-06T05:00:00Z");
    expect(failureStats(logs, now)).toEqual({ count: 1, unresolved: 0 });
    const onlyFail = [log({ startedAt: "2026-11-05T23:10:00Z", result: "failed", errorCode: "github_401" })];
    expect(failureStats(onlyFail, now)).toEqual({ count: 1, unresolved: 1 });
    // เกิน 30 วัน ไม่นับ
    expect(failureStats(onlyFail, Date.parse("2026-12-30T00:00:00Z"))).toEqual({ count: 0, unresolved: 0 });
  });
});

describe("ตัวกรอง + รวมแถวข้าม", () => {
  const rows = [
    log({ startedAt: "2026-11-06T23:00:00Z", result: "skipped" }),
    log({ startedAt: "2026-11-05T23:00:00Z", result: "skipped" }),
    log({ startedAt: "2026-11-04T23:00:00Z", result: "skipped" }),
    log({ startedAt: "2026-11-03T23:00:00Z" }),
    log({ startedAt: "2026-11-02T23:00:00Z", result: "skipped" }),
    log({ startedAt: "2026-11-01T23:00:00Z", source: "manual" }),
  ];
  it("รวม skip ติดกัน ≥2 เป็น group · skip เดี่ยวเป็นแถวปกติ", () => {
    const items = groupHistory(filterLogs(rows, { result: "all", source: "all" }), true);
    expect(items.map((i) => i.kind)).toEqual(["group", "row", "row", "row"]);
    expect(items[0]!.kind === "group" && items[0]!.logs.length).toBe(3);
  });
  it("ปิดการรวม = ทุกแถว", () => {
    expect(groupHistory(rows, false)).toHaveLength(6);
  });
  it("กรองตามผลและช่องทาง", () => {
    expect(filterLogs(rows, { result: "skipped", source: "all" })).toHaveLength(4);
    expect(filterLogs(rows, { result: "all", source: "manual" })).toHaveLength(1);
  });
});

describe("sourceLabel", () => {
  it("ช่องทางที่รู้จักเป็นไทย · ไม่รู้จัก = ข้อความกลาง", () => {
    expect(sourceLabel("auto")).toBe("Auto Sync 06:00");
    expect(sourceLabel("???")).toBe("ไม่ทราบช่องทาง");
  });
});
