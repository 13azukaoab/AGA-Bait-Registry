import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// CustomerLink ใช้ router ของ Next — เทสต์ render ฝั่ง server ไม่มี app router จึงจำลองขึ้นมา
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {} }),
  usePathname: () => "/todo",
  useSearchParams: () => new URLSearchParams(),
}));

import { MissedBox } from "./MissedBox";
import { CLOSED_LIMIT, MISSED_PAGE_SIZE, nextVisible, visibleSlice, type ClosedMissed, type PendingMissed } from "./logic";

// ข้อมูลทดสอบสมมติทั้งหมด
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pend = (n: number): PendingMissed => ({
  contractId: UUID(n),
  customerId: UUID(5000 + n),
  customerName: `ลูกค้าทดสอบ ${String(n).padStart(4, "0")}`,
  branchName: "สาขาทดสอบ",
  branchId: "b1",
  zoneId: "z1",
  contractNo: `T-${n}`,
  missedMonth: "2026-09",
  lastServiceMonth: "2027-08",
  deadlineMonth: "2028-08",
  pastDeadline: false,
});
const closedItem = (n: number): ClosedMissed =>
  ({ contractId: UUID(n), customerId: UUID(7000 + n), customerName: `ปิดแล้ว ${n}`, branchName: "สาขาทดสอบ", contractNo: `C-${n}`, missedMonth: "2026-08", kind: "waived", reason: "ทดสอบ", decidedOn: null }) as unknown as ClosedMissed;

const noop = () => {};
const html = (p: PendingMissed[], extra: Partial<React.ComponentProps<typeof MissedBox>> = {}, closed: ClosedMissed[] = []) =>
  renderToStaticMarkup(<MissedBox pending={p} closed={closed} role="host" currentMonth="2026-11" onWaive={noop} onReopen={noop} {...extra} />);
const rowCount = (h: string) => (h.match(/ตกบริการ กันยายน 2026/g) ?? []).length;

describe("ตัวช่วยแสดงเป็นหน้า (F2)", () => {
  it("visibleSlice ตามลำดับเดิม ไม่เรียงใหม่ · ไม่ติดลบ", () => {
    expect(visibleSlice([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(visibleSlice([1, 2], 10)).toEqual([1, 2]);
    expect(visibleSlice([1, 2], -3)).toEqual([]);
  });
  it("nextVisible เพิ่มทีละ 50 ไม่เกินทั้งหมด", () => {
    expect(MISSED_PAGE_SIZE).toBe(50);
    expect(nextVisible(50, 120)).toBe(100);
    expect(nextVisible(100, 120)).toBe(120);
    expect(nextVisible(120, 120)).toBe(120);
  });
});

describe("MissedBox แสดง 50 เรื่องแรก + แสดงเพิ่ม", () => {
  const all = Array.from({ length: 120 }, (_, i) => pend(i + 1));
  it("เริ่มที่ 50 เรื่อง · หัวกล่องบอกจำนวนทั้งหมด · ปุ่ม 'แสดงเพิ่ม' · ตัวเลขรวมไม่ใช่ 50", () => {
    const h = html(all);
    expect(rowCount(h)).toBe(50);
    expect(h).toContain("ค้าง 120 เรื่อง · แสดง 50");
    expect(h).toContain("แสดง 50 จาก 120 เรื่อง");
    expect(h).toContain("แสดงเพิ่ม (อีก 50 เรื่อง)");
    expect(h).toMatch(/rounded-full[^>]*>120</); // ชิปตัวเลขรวมในหัวกล่อง = 120
    // ลำดับเดิม: 0001 อยู่ ส่วน 0051 ยังไม่แสดง
    expect(h).toContain("ลูกค้าทดสอบ 0001");
    expect(h).toContain("ลูกค้าทดสอบ 0050");
    expect(h).not.toContain("ลูกค้าทดสอบ 0051");
    expect(h.indexOf("ลูกค้าทดสอบ 0001")).toBeLessThan(h.indexOf("ลูกค้าทดสอบ 0050"));
  });
  it("หลังกดเพิ่มหนึ่งครั้ง = 100 เรื่อง (จำลองด้วย initialVisible) · ปุ่มเหลือ 'อีก 20 เรื่อง' · ตัวเลขรวมเท่าเดิม", () => {
    const h = html(all, { initialVisible: 100 });
    expect(rowCount(h)).toBe(100);
    expect(h).toContain("ค้าง 120 เรื่อง · แสดง 100");
    expect(h).toContain("แสดงเพิ่ม (อีก 20 เรื่อง)");
    expect(h).toContain("ลูกค้าทดสอบ 0100");
    expect(h).not.toContain("ลูกค้าทดสอบ 0101");
  });
  it("แสดงครบแล้ว = ไม่มีปุ่ม ไม่มีข้อความ 'แสดง N จาก M'", () => {
    const h = html(all, { initialVisible: 120 });
    expect(rowCount(h)).toBe(120);
    expect(h).not.toContain("แสดงเพิ่ม");
    expect(h).not.toContain("ค้าง 120 เรื่อง · แสดง");
  });
  it("ค้างไม่เกิน 50: ทำงานเหมือนเดิม (ไม่มีปุ่ม)", () => {
    const h = html(all.slice(0, 7));
    expect(rowCount(h)).toBe(7);
    expect(h).not.toContain("แสดงเพิ่ม");
  });
  it("ว่าง = ข้อความเดิม", () => {
    expect(html([])).toContain("ไม่มีเรื่องตกบริการค้างตัดสิน");
  });
});

describe("เรื่องที่ปิดแล้ว = 'ล่าสุด' เมื่อเต็มเพดาน", () => {
  it("น้อยกว่าเพดาน = 'เรื่องที่ปิดแล้ว N ราย' · เต็มเพดาน = 'ล่าสุด 200 รายการ'", () => {
    expect(CLOSED_LIMIT).toBe(200);
    expect(html([], {}, [closedItem(1), closedItem(2)])).toContain("เรื่องที่ปิดแล้ว 2 ราย");
    const many = Array.from({ length: CLOSED_LIMIT }, (_, i) => closedItem(i + 1));
    const h = html([], {}, many);
    expect(h).toContain(`เรื่องที่ปิดล่าสุด ${CLOSED_LIMIT} รายการ`);
    expect(h).not.toContain("เรื่องที่ปิดแล้ว 200 ราย");
  });
});
