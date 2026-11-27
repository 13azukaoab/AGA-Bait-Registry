import { describe, expect, it } from "vitest";

import {
  buildEvidencePath,
  computeProgress,
  describeTodoError,
  isContractEnded,
  summarizeCollect,
  missedActionState,
  pickPageScope,
  shouldShowMonthAlert,
  sortClosed,
  sortPending,
  toMonthKey,
  validateEvidenceFile,
  validateReason,
} from "./logic";

describe("pickPageScope", () => {
  it("เลือกส่วนกลางก่อน แม้ต่างจังหวัดจะเก่ากว่า", () => {
    const r = pickPageScope([
      { scope: "province", month: "2026-08", isBehind: true },
      { scope: "central", month: "2026-10", isBehind: false },
    ]);
    expect(r?.scope).toBe("central");
  });
  it("ไม่มีส่วนกลาง ใช้เดือนเก่าสุด", () => {
    const r = pickPageScope([{ scope: "province", month: "2026-09", isBehind: true }]);
    expect(r?.month).toBe("2026-09");
  });
  it("ไม่มีแถว = null", () => expect(pickPageScope([])).toBeNull());
});

describe("toMonthKey", () => {
  it("ตัดเป็น YYYY-MM", () => expect(toMonthKey("2026-10-01")).toBe("2026-10"));
});

describe("computeProgress", () => {
  it("188/206 = 91%", () => {
    const items = [
      ...Array.from({ length: 188 }, () => ({ routineCountInMonth: 1 })),
      ...Array.from({ length: 18 }, () => ({ routineCountInMonth: 0 })),
    ];
    expect(computeProgress(items)).toEqual({ total: 206, filled: 188, remaining: 18, percent: 91 });
  });
  it("เข้าหลายครั้งนับเป็น 1 ราย", () => {
    expect(computeProgress([{ routineCountInMonth: 3 }]).filled).toBe(1);
  });
  it("ไม่มีสัญญา = 0%", () => expect(computeProgress([]).percent).toBe(0));
});

describe("missedActionState", () => {
  it("ยังไม่เลยเพดาน: host/recorder กดได้ทั้งสองปุ่ม ปุ่มหลัก = ชดเชย", () => {
    for (const role of ["host", "recorder"] as const) {
      expect(missedActionState(role, false)).toEqual({
        waiveEnabled: true,
        recordEnabled: true,
        primary: "record",
        recordOverCapSuffix: false,
      });
    }
  });
  it("เลยเพดาน + recorder: ชดเชยกดไม่ได้ ปุ่มหลัก = ไม่ชดเชย", () => {
    expect(missedActionState("recorder", true)).toEqual({
      waiveEnabled: true,
      recordEnabled: false,
      primary: "waive",
      recordOverCapSuffix: false,
    });
  });
  it("เลยเพดาน + host: กดได้ มีป้ายเกินเพดาน", () => {
    const s = missedActionState("host", true);
    expect(s.recordEnabled).toBe(true);
    expect(s.recordOverCapSuffix).toBe(true);
  });
  it("admin/viewer: ปิดทั้งสองปุ่ม", () => {
    for (const role of ["admin", "viewer"] as const) {
      const s = missedActionState(role, false);
      expect(s.waiveEnabled).toBe(false);
      expect(s.recordEnabled).toBe(false);
    }
  });
});

describe("sortPending / sortClosed", () => {
  const rows = [
    { missedMonth: "2026-07", customerName: "ข" },
    { missedMonth: "2026-04", customerName: "ค" },
    { missedMonth: "2026-04", customerName: "ก" },
  ];
  it("รอตัดสิน: ตกเก่าสุดก่อน แล้วตามชื่อ", () => {
    expect(sortPending(rows).map((r) => r.customerName)).toEqual(["ก", "ค", "ข"]);
  });
  it("ปิดแล้ว: ตกใหม่สุดก่อน", () => {
    expect(sortClosed(rows).map((r) => r.customerName)).toEqual(["ข", "ก", "ค"]);
  });
  it("ไม่แก้อาร์เรย์เดิม", () => {
    const copy = [...rows];
    sortPending(rows);
    expect(rows).toEqual(copy);
  });
});

describe("validateReason", () => {
  it("ว่างหรือเว้นวรรค = ผิด", () => {
    expect(validateReason("")).not.toBeNull();
    expect(validateReason("   ")).not.toBeNull();
  });
  it("ปกติผ่าน · 300 ผ่าน · 301 ไม่ผ่าน", () => {
    expect(validateReason("ลูกค้ายินยอม")).toBeNull();
    expect(validateReason("ก".repeat(300))).toBeNull();
    expect(validateReason("ก".repeat(301))).not.toBeNull();
  });
});

describe("evidence", () => {
  it("ชนิดไฟล์ + ขนาด", () => {
    expect(validateEvidenceFile({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(validateEvidenceFile({ type: "image/png", size: 5 * 1024 * 1024 })).toBeNull();
    expect(validateEvidenceFile({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
    expect(validateEvidenceFile({ type: "text/html", size: 10 })).toMatch(/PDF/);
    expect(validateEvidenceFile({ type: "image/png", size: 0 })).not.toBeNull();
  });
  it("path = contract/uuid.นามสกุล", () => {
    expect(buildEvidencePath("c1", "u1", "image/jpeg")).toBe("c1/u1.jpg");
    expect(buildEvidencePath("c1", "u1", "application/pdf")).toBe("c1/u1.pdf");
    expect(buildEvidencePath("c1", "u1", "text/plain")).toBeNull();
  });
});

describe("describeTodoError", () => {
  const codes = ["MS001", "MS002", "MS004", "MS005", "MS007", "MS008", "MS009", "MS010", "MS011", "MS012", "AG004", "22001", "42501"];
  it.each(codes)("%s → ข้อความไทย ไม่ใช่บั๊ก", (code) => {
    const r = describeTodoError({ code, message: "x" });
    expect(r.isBug).toBe(false);
    expect(r.message).toMatch(/[ก-๙]/);
  });
  it("รหัสไม่รู้จัก ตกไปตัวแปลกลาง (บั๊ก)", () => {
    const r = describeTodoError({ code: "ZZ999", message: "boom" });
    expect(r.isBug).toBe(true);
  });
  it("เครือข่ายล่ม ใช้ตัวแปลกลาง", () => {
    expect(describeTodoError({ message: "Failed to fetch" }).message).toMatch(/เชื่อมต่อ/);
  });
});

describe("ลูกค้ารอเก็บสถานี", () => {
  const today = "2026-11-17";
  it("active ที่ยังไม่ถึงวันจบ = ยังไม่จบ · วันจบผ่านแล้ว/สถานะอื่น = จบ", () => {
    expect(isContractEnded({ status: "active", endDate: "2026-12-31" }, today)).toBe(false);
    expect(isContractEnded({ status: "active", endDate: "2026-11-16" }, today)).toBe(true);
    expect(isContractEnded({ status: "expired_pending_collection", endDate: "2027-01-01" }, today)).toBe(true);
  });
  it("paused (พัก · M29): ไม่นับว่าจบ ทั้งที่ยังไม่หมดอายุและที่เลยวันสิ้นสุดแล้ว (DB กันเก็บ CP010)", () => {
    expect(isContractEnded({ status: "paused", endDate: "2026-12-31" }, today)).toBe(false);
    expect(isContractEnded({ status: "paused", endDate: "2026-01-31" }, today)).toBe(false);
  });
  it("closed / cancelled = จบ ไม่ว่าวันสิ้นสุดอยู่ที่ไหน · active หมดอายุ = จบ · active วันสุดท้ายวันนี้ = ยังไม่จบ", () => {
    expect(isContractEnded({ status: "closed", endDate: "2027-12-31" }, today)).toBe(true);
    expect(isContractEnded({ status: "cancelled", endDate: "2027-12-31" }, today)).toBe(true);
    expect(isContractEnded({ status: "active", endDate: "2026-11-16" }, today)).toBe(true);
    expect(isContractEnded({ status: "active", endDate: today }, today)).toBe(false);
  });
  it("summarizeCollect ไม่นับ IG ของสัญญาพัก (ไม่โผล่ในยอด/รายการรอเก็บ)", () => {
    const s = summarizeCollect(
      [
        { customerId: "p", remaining: 6, status: "paused", endDate: "2026-12-31" },
        { customerId: "q", remaining: 4, status: "paused", endDate: "2026-01-31" },
        { customerId: "r", remaining: 2, status: "expired_pending_collection", endDate: "2026-09-30" },
      ],
      today,
    );
    expect(s).toEqual({ customers: 1, stations: 2 });
  });
  it("นับลูกค้าไม่ซ้ำ + IG ค้าง เฉพาะสัญญาที่จบแล้วและมีค้าง", () => {
    const s = summarizeCollect(
      [
        { customerId: "a", remaining: 3, status: "expired_pending_collection", endDate: "2026-09-30" },
        { customerId: "a", remaining: 2, status: "closed", endDate: "2025-09-30" },
        { customerId: "b", remaining: 0, status: "closed", endDate: "2026-01-31" },
        { customerId: "c", remaining: 4, status: "active", endDate: "2027-01-31" },
      ],
      today,
    );
    expect(s).toEqual({ customers: 1, stations: 5 });
  });
});

describe("สิทธิ์เข้าหน้า /todo (DECISIONS 2.57)", () => {
  it("host · recorder · admin เข้าได้ · viewer เข้าไม่ได้", async () => {
    const { canAccessPath } = await import("@/lib/auth/access");
    expect(canAccessPath("host", "/todo")).toBe(true);
    expect(canAccessPath("recorder", "/todo")).toBe(true);
    expect(canAccessPath("admin", "/todo")).toBe(true);
    expect(canAccessPath("viewer", "/todo")).toBe(false);
  });
});

describe("shouldShowMonthAlert — กล่องเตือนเดือนค้างไม่บังบทสอน", () => {
  it("เดือนค้าง + ยังไม่กดปิด + บทสอนไม่ทำงาน → แสดง", () => {
    expect(shouldShowMonthAlert({ isBehind: true, dismissed: false, tourRunning: false })).toBe(true);
  });
  it("บทสอนทำงานอยู่ → ยังไม่แสดง (ไม่ให้ dialog modal บังเมนูที่บทสอนไฮไลต์)", () => {
    expect(shouldShowMonthAlert({ isBehind: true, dismissed: false, tourRunning: true })).toBe(false);
  });
  it("บทสอนจบ/ถูกข้าม (tourRunning กลับเป็น false) → กล่องเตือนขึ้น ไม่หายไปเฉยๆ", () => {
    const during = shouldShowMonthAlert({ isBehind: true, dismissed: false, tourRunning: true });
    const after = shouldShowMonthAlert({ isBehind: true, dismissed: false, tourRunning: false });
    expect([during, after]).toEqual([false, true]);
  });
  it("ผู้ใช้กด ไว้ทีหลัง แล้ว → ไม่แสดงอีก แม้บทสอนเริ่ม/จบ", () => {
    expect(shouldShowMonthAlert({ isBehind: true, dismissed: true, tourRunning: false })).toBe(false);
  });
  it("เดือนไม่ค้าง → ไม่แสดง", () => {
    expect(shouldShowMonthAlert({ isBehind: false, dismissed: false, tourRunning: false })).toBe(false);
  });
});
