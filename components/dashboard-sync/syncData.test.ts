import { describe, expect, it } from "vitest";

import { destinationFromEnv, isTokenConfigured, toSyncLogRow } from "./syncData";

describe("isTokenConfigured", () => {
  it("ไม่มี / ว่าง / เว้นวรรค = false · มีค่า = true (คืนแค่ boolean)", () => {
    expect(isTokenConfigured({})).toBe(false);
    expect(isTokenConfigured({ DASHBOARD_GITHUB_TOKEN: "" })).toBe(false);
    expect(isTokenConfigured({ DASHBOARD_GITHUB_TOKEN: "   " })).toBe(false);
    expect(isTokenConfigured({ DASHBOARD_GITHUB_TOKEN: "x" })).toBe(true);
  });
});

describe("destinationFromEnv", () => {
  it("ค่าตั้งต้นตาม SPEC · ค่าผิดรูปแบบกลับไปค่าตั้งต้น", () => {
    expect(destinationFromEnv({})).toEqual({ repo: "13azukaoab/AGA-Bait-Dashboard", branch: "main" });
    expect(destinationFromEnv({ DASHBOARD_GITHUB_REPO: "bad repo", DASHBOARD_GITHUB_BRANCH: "a b" })).toEqual({
      repo: "13azukaoab/AGA-Bait-Dashboard",
      branch: "main",
    });
    expect(destinationFromEnv({ DASHBOARD_GITHUB_REPO: "o/r", DASHBOARD_GITHUB_BRANCH: "dev" })).toEqual({ repo: "o/r", branch: "dev" });
  });
});

describe("toSyncLogRow", () => {
  const base = {
    id: 1,
    source: "manual",
    triggered_by: "u1",
    started_at: "2026-11-01T01:00:00Z",
    finished_at: "2026-11-01T01:00:04Z",
    result: "success",
    error_code: null,
    months_sent: ["OCT.26"],
    month_count: 22,
    commit_sha: "a".repeat(40),
  };
  it("แปลงชื่อผู้กด · ไม่มีชื่อ = null", () => {
    expect(toSyncLogRow(base, new Map([["u1", "สมชาย"]]))?.triggeredByName).toBe("สมชาย");
    expect(toSyncLogRow(base, new Map())?.triggeredByName).toBeNull();
  });
  it("source/result นอกชุดที่รู้จัก = ทิ้งแถว (ไม่แสดงค่าแปลก)", () => {
    expect(toSyncLogRow({ ...base, source: "zzz" }, new Map())).toBeNull();
    expect(toSyncLogRow({ ...base, result: "weird" }, new Map())).toBeNull();
  });
  it("result null = กำลังส่ง", () => {
    expect(toSyncLogRow({ ...base, result: null, finished_at: null }, new Map())?.result).toBeNull();
  });
});
