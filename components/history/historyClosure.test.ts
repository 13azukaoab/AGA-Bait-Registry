import { describe, expect, it } from "vitest";

import { closureSince, isPostCloseEdit, tsToMicros } from "./historyClosure";
import type { BranchRef, ClosureRef } from "./historyTypes";

const branches: BranchRef[] = [
  { id: "c1", name: "ลาดพร้าว", division: "central", zoneId: "z1", zoneName: "เขต 4" },
  { id: "p1", name: "เชียงใหม่", division: "province", zoneId: "z9", zoneName: "เขต 9" },
];
const closures: ClosureRef[] = [
  { monthKey: "2026-10", scope: "central", closedAt: "2026-11-02T03:00:00.500000+00:00", lastResyncAt: null },
  { monthKey: "2026-09", scope: "central", closedAt: "2026-10-02T03:00:00+00:00", lastResyncAt: "2026-10-20T03:00:00+00:00" },
];
const base = { tableName: "visits", monthKey: "2026-10", branchId: "c1", changedAt: "2026-11-05T00:00:00+00:00" };

describe("tsToMicros", () => {
  it("แยกไมโครวินาทีได้", () => {
    expect(tsToMicros("2026-11-02T03:00:00.500001+00:00") - tsToMicros("2026-11-02T03:00:00.500000+00:00")).toBe(1);
  });
});

describe("closureSince", () => {
  it("ใช้ค่ามากสุดของ closed_at / last_resync_at", () => {
    expect(closureSince(closures[1])).toBe("2026-10-20T03:00:00+00:00");
    expect(closureSince({ monthKey: "x", scope: "central", closedAt: null, lastResyncAt: null })).toBeNull();
  });
});

describe("isPostCloseEdit", () => {
  it("แก้หลังปิด = เวลาใหม่กว่าเวลาปิด", () => {
    expect(isPostCloseEdit(base, branches, closures)).toBe(true);
  });
  it("เวลาเท่ากับเวลาปิดเป๊ะ (ไมโครวินาที) ไม่นับ · ช้ากว่า 1 ไมโครวินาทีนับ", () => {
    expect(isPostCloseEdit({ ...base, changedAt: "2026-11-02T03:00:00.500000+00:00" }, branches, closures)).toBe(false);
    expect(isPostCloseEdit({ ...base, changedAt: "2026-11-02T03:00:00.500001+00:00" }, branches, closures)).toBe(true);
  });
  it("ก่อนเวลาปิด ไม่นับ", () => {
    expect(isPostCloseEdit({ ...base, changedAt: "2026-11-01T00:00:00+00:00" }, branches, closures)).toBe(false);
  });
  it("ใช้เวลาคำนวณใหม่ล่าสุดเป็นเกณฑ์เมื่อมี", () => {
    expect(isPostCloseEdit({ ...base, monthKey: "2026-09", changedAt: "2026-10-10T00:00:00+00:00" }, branches, closures)).toBe(false);
    expect(isPostCloseEdit({ ...base, monthKey: "2026-09", changedAt: "2026-10-21T00:00:00+00:00" }, branches, closures)).toBe(true);
  });
  it("ส่วนไม่ตรง (ต่างจังหวัดยังไม่ปิด) / ไม่มีสาขา / ไม่มีเดือน ไม่นับ", () => {
    expect(isPostCloseEdit({ ...base, branchId: "p1" }, branches, closures)).toBe(false);
    expect(isPostCloseEdit({ ...base, branchId: null }, branches, closures)).toBe(false);
    expect(isPostCloseEdit({ ...base, monthKey: null }, branches, closures)).toBe(false);
  });
  it("ตารางปิดเดือนไม่นับ", () => {
    expect(isPostCloseEdit({ ...base, tableName: "month_closures" }, branches, closures)).toBe(false);
  });
});
