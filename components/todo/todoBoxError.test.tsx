/**
 * ทดสอบการแสดงผลเมื่อกล่องหนึ่งโหลดไม่สำเร็จ (null = โหลดไม่ได้) — ข้อมูลทดสอบสมมติทั้งหมด
 * ต้องบอกชัดว่าโหลดไม่ได้ · ห้ามแสดงเป็น 0 · กล่องอื่นแสดงปกติ
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {} }),
  usePathname: () => "/todo",
  useSearchParams: () => new URLSearchParams(),
}));

import { MissedBox } from "./MissedBox";
import { MonthAlert } from "./MonthAlert";
import { BOX_ERROR_TEXT, FailedCard, ListCard, StatCards } from "./SummaryCards";
import type { ClosedMissed, PendingMissed } from "./logic";

const noop = () => {};
const closedItem = { contractId: "c9", customerId: "u9", customerName: "ปิดแล้ว 9", branchName: "สาขาทดสอบ", contractNo: "C-9", missedMonth: "2026-08", kind: "waived", reason: "ทดสอบ", decidedOn: null } as unknown as ClosedMissed;
const pendItem: PendingMissed = {
  contractId: "c1",
  customerId: "u1",
  customerName: "ลูกค้าทดสอบ 1",
  branchName: "สาขาทดสอบ",
  branchId: "b1",
  zoneId: "z1",
  contractNo: "T-1",
  missedMonth: "2026-09",
  lastServiceMonth: "2026-08",
  deadlineMonth: "2026-12",
  pastDeadline: false,
};

describe("StatCards — null = โหลดไม่ได้", () => {
  it("ใบที่พลาดขึ้นข้อความ · ใบที่ผ่านยังเป็นตัวเลข", () => {
    const h = renderToStaticMarkup(<StatCards missedCount={null} collect={{ customers: 3, stations: 5 }} agPendingCount={0} />);
    expect(h).toContain(BOX_ERROR_TEXT);
    expect(h.split(BOX_ERROR_TEXT)).toHaveLength(2); // มีใบเดียวที่พลาด
    expect(h).toContain("IG เหลือ 5 สถานี");
    expect(h).toContain("กล่องเหยื่อรอถอด");
  });
  it("ทั้ง 3 ใบพลาด → ไม่มีตัวเลข 0 แสดงเป็นค่า", () => {
    const h = renderToStaticMarkup(<StatCards missedCount={null} collect={null} agPendingCount={null} />);
    expect(h.split(BOX_ERROR_TEXT)).toHaveLength(4);
    expect(h).not.toMatch(/tabular-nums[^>]*>0</);
  });
});

describe("ListCard failed", () => {
  it("แสดงข้อความโหลดไม่สำเร็จ · ไม่มีป้ายจำนวน · ไม่ขึ้น 'ว่าง'", () => {
    const h = renderToStaticMarkup(
      <ListCard title="กล่องเหยื่อรอถอด" count={0} failed tone="accent" empty="ไม่มีกล่องเหยื่อรอถอด" footerHref="/bait" footerLabel="ดู →" />,
    );
    expect(h).toContain(BOX_ERROR_TEXT);
    expect(h).not.toContain("ไม่มีกล่องเหยื่อรอถอด");
    expect(h).not.toMatch(/rounded-full px-2 text-xs[^>]*>0</);
    expect(h).toContain("/bait"); // ลิงก์ท้ายกล่องยังอยู่
  });
  it("ไม่ failed + count 0 = ว่างจริงตามเดิม", () => {
    const h = renderToStaticMarkup(<ListCard title="x" count={0} tone="accent" empty="ไม่มีรายการ" footerHref="/" footerLabel="ดู" />);
    expect(h).toContain("ไม่มีรายการ");
    expect(h).not.toContain(BOX_ERROR_TEXT);
  });
});

describe("FailedCard", () => {
  it("มีหัวข้อ + ข้อความ", () => {
    const h = renderToStaticMarkup(<FailedCard title="สถานะงานกรอกผล · พฤศจิกายน 2026" />);
    expect(h).toContain("สถานะงานกรอกผล");
    expect(h).toContain(BOX_ERROR_TEXT);
  });
});

describe("MissedBox — pending/closed เป็น null", () => {
  const base = { role: "host" as const, currentMonth: "2026-11", onWaive: noop, onReopen: noop };
  it("pending พลาด → ข้อความโหลดไม่ได้ ไม่มีเลข 0 · ส่วนที่ปิดแล้วยังแสดง", () => {
    const h = renderToStaticMarkup(<MissedBox pending={null} closed={[closedItem]} {...base} />);
    expect(h).toContain(BOX_ERROR_TEXT);
    expect(h).not.toContain("ไม่มีเรื่องตกบริการค้างตัดสิน");
    expect(h).toContain("เรื่องที่ปิดแล้ว 1 ราย");
  });
  it("closed พลาด → รายการรอตัดสินยังแสดง + ข้อความโหลดไม่ได้ที่ส่วนปิดแล้ว", () => {
    const h = renderToStaticMarkup(<MissedBox pending={[pendItem]} closed={null} {...base} />);
    expect(h).toContain("ลูกค้าทดสอบ 1");
    expect(h).toContain(BOX_ERROR_TEXT);
  });
  it("ทั้งคู่ปกติ → ไม่มีข้อความผิดพลาด", () => {
    const h = renderToStaticMarkup(<MissedBox pending={[pendItem]} closed={[closedItem]} {...base} />);
    expect(h).not.toContain(BOX_ERROR_TEXT);
  });
});

describe("MonthAlert — ตัวเลขโหลดไม่ได้", () => {
  it("null = ขึ้นว่าโหลดตัวเลขไม่สำเร็จ ไม่ใช่ 0", () => {
    const h = renderToStaticMarkup(<MonthAlert month="2026-10" currentMonth="2026-11" unfilled={null} pending={null} onClose={noop} />);
    expect(h.match(/โหลดตัวเลขไม่สำเร็จ/g)).toHaveLength(2);
  });
  it("มีตัวเลข = แสดงตามเดิม", () => {
    const h = renderToStaticMarkup(<MonthAlert month="2026-10" currentMonth="2026-11" unfilled={4} pending={0} onClose={noop} />);
    expect(h).toContain("<b>4</b> ราย");
    expect(h).toContain("<b>0</b> ราย");
  });
});
