/**
 * เทสการแสดงผลกล่องยืนยันก่อนส่ง Dashboard (render เป็น HTML string — ไม่ต้องใช้ DOM)
 * เช็ก: ปิดอยู่ = ไม่มีเนื้อหา · เปิด = บอกเดือน/ส่วน/ปลายทาง · ต้องพิมพ์คำยืนยัน → ปุ่ม "ยืนยันส่ง" disabled · กำลังส่ง = ปุ่มทั้งสอง disabled
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { ConfirmSendDialog, type ConfirmSendDialogProps } from "./ConfirmSendDialog";
import { DashboardSyncClient, type DashboardSyncProps } from "./DashboardSyncClient";
import type { SyncLogRow } from "./syncLogic";

const base: ConfirmSendDialogProps = {
  open: true,
  running: false,
  title: "ยืนยันคำนวณ snapshot ใหม่ และส่ง Dashboard",
  items: [
    { label: "เดือน", value: "ต.ค. 2026 (OCT.26)" },
    { label: "ส่วน", value: "ส่วนกลาง 24 สาขา" },
  ],
  destination: "Dashboard ที่ผู้บริหารดู",
  phrase: "OCT.26",
  onConfirm: () => undefined,
  onCancel: () => undefined,
};
const render = (p: Partial<ConfirmSendDialogProps>) => renderToStaticMarkup(createElement(ConfirmSendDialog, { ...base, ...p }));

/** ดึงแท็ก <button ...>…ข้อความ…</button> ของปุ่มที่มีข้อความนั้น */
function buttonTag(html: string, text: string): string {
  const m = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${text}(?:(?!</button>).)*</button>`, "s"));
  return m ? m[0] : "";
}

describe("ConfirmSendDialog", () => {
  it("ปิดอยู่ = ไม่มีเนื้อหาในกล่อง", () => {
    const out = render({ open: false });
    expect(out).toContain("<dialog");
    expect(out).not.toContain("ยืนยันส่ง");
    expect(out).not.toContain("OCT.26");
  });

  it("เปิด = บอกเดือน / ส่วน / ปลายทาง + มีปุ่มยืนยันส่ง/ยกเลิก", () => {
    const out = render({});
    expect(out).toContain("ต.ค. 2026 (OCT.26)");
    expect(out).toContain("ส่วนกลาง 24 สาขา");
    expect(out).toContain("Dashboard ที่ผู้บริหารดู");
    expect(out).toContain("ยกเลิก");
    expect(out).toContain("ยืนยันส่ง");
  });

  it("ต้องพิมพ์คำยืนยัน: ยังไม่พิมพ์ = ปุ่ม ยืนยันส่ง disabled · ปุ่ม ยกเลิก ยังกดได้", () => {
    const out = render({});
    expect(buttonTag(out, "ยืนยันส่ง")).toContain(" disabled=\"\"");
    expect(buttonTag(out, "ยกเลิก")).not.toContain(" disabled=\"\"");
  });

  it("ไม่กำหนดคำยืนยัน (ปุ่มส่งตอนนี้) = ไม่มีช่องพิมพ์ และปุ่ม ยืนยันส่ง กดได้", () => {
    const out = render({ phrase: undefined });
    expect(out).not.toContain("<input");
    expect(buttonTag(out, "ยืนยันส่ง")).not.toContain(" disabled=\"\"");
  });

  it("กำลังส่ง = ปุ่มทั้งสอง disabled", () => {
    const out = render({ running: true, phrase: undefined });
    expect(buttonTag(out, "กำลังส่ง")).toContain(" disabled=\"\"");
    expect(buttonTag(out, "ยกเลิก")).toContain(" disabled=\"\"");
  });
});

describe("หน้า Dashboard Sync: ปุ่ม ส่งตอนนี้ ต้องผ่านกล่องยืนยัน", () => {
  const okLog: SyncLogRow = {
    id: 1, source: "auto", triggeredByName: null, startedAt: "2026-11-05T23:10:00Z", finishedAt: "2026-11-05T23:10:04Z",
    result: "success", errorCode: null, monthsSent: ["OCT.26"], monthCount: 22, commitSha: "a1b2c3d".padEnd(40, "0"),
  };
  const props: DashboardSyncProps = { logs: [okLog], tokenConfigured: true, nowIso: "2026-11-06T05:00:00Z", canTrigger: true, repo: "o/r", branch: "main" };

  it("ก่อนกดปุ่ม กล่องยืนยันยังไม่เปิด (ไม่มีเนื้อหากล่อง) แต่มีปุ่ม ส่งตอนนี้", () => {
    const out = renderToStaticMarkup(createElement(DashboardSyncClient, props));
    expect(out).toContain("<dialog");
    expect(out).not.toContain("ยืนยันส่งข้อมูลขึ้น Dashboard");
    expect(out).toContain("ส่งตอนนี้");
  });
});
