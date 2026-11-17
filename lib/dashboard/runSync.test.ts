import { describe, expect, it } from "vitest";

import { DashboardSyncError } from "./errors";
import { runDashboardSync, type DashboardSyncPorts, type FinishLogInput } from "./runSync";
import type { SyncLogRecord } from "./sync";
import type { DashboardData } from "./types";

const DATA = { "OCT.26": [] } as DashboardData;

function record(over: Partial<SyncLogRecord>): SyncLogRecord {
  return { result: "ok", files: [], months: 22, rows: 946, changedMonths: [], message: "m", durationMs: 1, ...over };
}

function ports(over: Partial<DashboardSyncPorts> = {}) {
  const finished: { id: number; input: FinishLogInput }[] = [];
  const p: DashboardSyncPorts = {
    startLog: async () => 7,
    finishLog: async (id, input) => {
      finished.push({ id, input });
    },
    loadData: async () => DATA,
    push: async () => record({}),
    ...over,
  };
  return { p, finished };
}

describe("runDashboardSync", () => {
  it("สำเร็จ → log success + เดือนที่เปลี่ยน + sha", async () => {
    const { p, finished } = ports({
      push: async () => record({ result: "ok", commitSha: "a".repeat(40), changedMonths: ["OCT.26"] }),
    });
    const out = await runDashboardSync("manual", p);
    expect(out).toMatchObject({ status: "done", logId: 7, result: "success", monthsSent: ["OCT.26"] });
    expect(finished).toEqual([
      { id: 7, input: expect.objectContaining({ result: "success", monthsSent: ["OCT.26"], monthCount: 22, commitSha: "a".repeat(40) }) },
    ]);
  });

  it("ข้อมูลเหมือนเดิม → log skipped", async () => {
    const { p, finished } = ports({ push: async () => record({ result: "skip" }) });
    const out = await runDashboardSync("auto", p);
    expect(out).toMatchObject({ result: "skipped", monthsSent: [] });
    expect(finished[0]?.input.result).toBe("skipped");
  });

  it("GitHub ล้มเหลว → log failed + errorCode + ข้อความตัดเหลือ ≤ 500", async () => {
    const { p, finished } = ports({
      push: async () => record({ result: "fail", error: "x".repeat(900), errorCode: "github_401", changedMonths: ["X"] }),
    });
    const out = await runDashboardSync("auto", p);
    expect(out).toMatchObject({ result: "failed", errorCode: "github_401", monthsSent: [] });
    expect(finished[0]?.input.errorMessage?.length).toBe(500);
  });

  it("อ่านฐานข้อมูลพัง → ยังบันทึก log (failed + รหัสจาก DashboardSyncError)", async () => {
    const { p, finished } = ports({
      loadData: async () => {
        throw new DashboardSyncError("closed_snapshot_missing", "เดือน 2026-10 …");
      },
    });
    const out = await runDashboardSync("auto", p);
    expect(out).toMatchObject({ result: "failed", errorCode: "closed_snapshot_missing" });
    expect(finished).toHaveLength(1);
  });

  it("error ทั่วไปตอนอ่าน → load_failed", async () => {
    const { p } = ports({
      loadData: async () => {
        throw new Error("network");
      },
    });
    expect(await runDashboardSync("auto", p)).toMatchObject({ result: "failed", errorCode: "load_failed" });
  });

  it("cron ชนรอบอื่น (startLog คืน null) → busy ไม่อ่าน/ไม่ส่ง/ไม่ปิด log", async () => {
    let loaded = false;
    const { p, finished } = ports({
      startLog: async () => null,
      loadData: async () => {
        loaded = true;
        return DATA;
      },
    });
    expect(await runDashboardSync("auto", p)).toEqual({ status: "busy" });
    expect(loaded).toBe(false);
    expect(finished).toHaveLength(0);
  });

  it("startLog throw (SY001 / ไม่มีสิทธิ์) → ส่งต่อให้ route ไม่อ่านข้อมูล", async () => {
    const { p } = ports({
      startLog: async () => {
        throw Object.assign(new Error("busy"), { code: "SY001" });
      },
    });
    await expect(runDashboardSync("manual", p)).rejects.toMatchObject({ code: "SY001" });
  });

  it("บันทึกผลไม่สำเร็จ → คืนผลการส่ง + logError (ไม่กลืน error)", async () => {
    const { p } = ports({
      finishLog: async () => {
        throw new Error("rpc down");
      },
    });
    const out = await runDashboardSync("auto", p);
    expect(out).toMatchObject({ status: "done", result: "success", logError: "rpc down" });
  });
});
