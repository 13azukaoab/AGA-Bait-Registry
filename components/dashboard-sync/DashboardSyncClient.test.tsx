/**
 * เทสการแสดงผลหน้า Dashboard Sync (render เป็น HTML string — ไม่ต้องใช้ DOM)
 * เช็ก: ซ่อนปุ่ม "ส่งตอนนี้" ตาม role · สถานะ "ยังไม่ได้ตั้งค่า" ไม่เป็น error · error แสดงเป็นข้อความไทยไม่ใช่รหัสดิบ
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { DashboardSyncClient, type DashboardSyncProps } from "./DashboardSyncClient";
import type { SyncLogRow } from "./syncLogic";

const NOW = "2026-11-06T05:00:00Z";
const okLog: SyncLogRow = {
  id: 1, source: "auto", triggeredByName: null, startedAt: "2026-11-05T23:10:00Z", finishedAt: "2026-11-05T23:10:04Z",
  result: "success", errorCode: null, monthsSent: ["OCT.26"], monthCount: 22, commitSha: "a1b2c3d".padEnd(40, "0"),
};
const base: DashboardSyncProps = { logs: [okLog], tokenConfigured: true, nowIso: NOW, canTrigger: true, repo: "o/r", branch: "main" };
const render = (p: Partial<DashboardSyncProps>) => renderToStaticMarkup(createElement(DashboardSyncClient, { ...base, ...p }));

describe("ปุ่ม ส่งตอนนี้ ตาม role", () => {
  it("host เห็นปุ่ม", () => expect(render({})).toContain("ส่งตอนนี้"));
  it("recorder/อื่นๆ (canTrigger=false) ไม่มีปุ่ม แต่ยังเห็นสถานะ", () => {
    const out = render({ canTrigger: false });
    expect(out).not.toContain("ส่งตอนนี้</span>");
    expect(out).toContain("ส่งสำเร็จ");
  });
});

describe("ยังไม่ได้ตั้งค่าการเชื่อมต่อ", () => {
  it("ไม่มี token = ข้อความ 'ยังไม่ได้ตั้งค่า' ชัดเจน · ปุ่มส่ง disabled · ไม่ใช้สีแดง/ไม่ใช่ error", () => {
    const out = render({ logs: [], tokenConfigured: false });
    expect(out).toContain("ยังไม่ได้ตั้งค่าการเชื่อมต่อกับ GitHub");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>/);
    expect(out).not.toContain("ส่งไม่สำเร็จ ·");
    expect(out).not.toContain("DASHBOARD_GITHUB_TOKEN");
  });
  it("รอบล่าสุดล้มเหลวด้วย config_missing ก็แสดงเป็น 'ยังไม่ได้ตั้งค่า'", () => {
    const failed: SyncLogRow = { ...okLog, id: 2, startedAt: "2026-11-06T01:00:00Z", result: "failed", errorCode: "config_missing" };
    const out = render({ logs: [failed, okLog] });
    expect(out).toContain("ยังไม่ได้ตั้งค่าการเชื่อมต่อกับ GitHub");
    expect(out).not.toContain("ส่งไม่สำเร็จ ·");
  });
  it("ยังไม่เคยส่ง (ตั้งแล้ว) = ข้อความว่าง ไม่ใช่ error", () => {
    const out = render({ logs: [] });
    expect(out).toContain("ยังไม่เคยส่งข้อมูลเข้า Dashboard");
    expect(out).not.toContain("ส่งไม่สำเร็จ ·");
  });
});

describe("error แสดงเป็นไทย", () => {
  it("ล้มเหลว github_401 = สาเหตุ/วิธีแก้ไทย · ไม่โชว์รหัสดิบในการ์ดหลัก", () => {
    const failed: SyncLogRow = { ...okLog, id: 3, startedAt: "2026-11-06T01:00:00Z", result: "failed", errorCode: "github_401" };
    const out = render({ logs: [failed] });
    expect(out).toContain("GitHub ไม่ยอมรับ token");
    expect(out).toContain("ส่งไม่สำเร็จ ·");
    expect(out).not.toContain("github_401");
  });
});
