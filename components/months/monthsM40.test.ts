import { describe, expect, it } from "vitest";

import {
  POST_CLOSE_EDITS_AVAILABLE,
  actionLabelTh,
  badgeCount,
  badgeCountForMonth,
  canListPostCloseEdits,
  canViewReadiness,
  countPostCloseEdits,
  describePostCloseEdit,
  parsePostCloseEdits,
  parseReadinessRows,
  postCloseKey,
  postCloseScopesFor,
  summarizeReadiness,
  tableLabelTh,
  type Perms,
} from "./monthsLogic";

const host: Perms = { isHost: true, canCloseCentral: true, canCloseProvince: true };
const rec: Perms = { isHost: false, canCloseCentral: true, canCloseProvince: false };
const none: Perms = { isHost: false, canCloseCentral: false, canCloseProvince: false };

describe("M40 · ตรวจความครบ (readiness)", () => {
  it("แปลงแถว RPC เป็นรายการสาขาที่ยังไม่พร้อม + สรุป", () => {
    const rows = parseReadinessRows([
      { branch_id: "b1", branch_name: "นครปฐม", pending_count: 3 },
      { branch_id: "b2", branch_name: "หัวหิน", pending_count: 1 },
    ]);
    expect(rows).toEqual([
      { branchId: "b1", name: "นครปฐม", pending: 3 },
      { branchId: "b2", name: "หัวหิน", pending: 1 },
    ]);
    expect(summarizeReadiness(rows!)).toEqual({ ready: false, branchCount: 2, pendingTotal: 4 });
  });
  it("0 แถว = พร้อม", () => {
    const rows = parseReadinessRows([]);
    expect(rows).toEqual([]);
    expect(summarizeReadiness(rows!)).toEqual({ ready: true, branchCount: 0, pendingTotal: 0 });
  });
  it("รูปแบบผิด = null (ไม่ถือว่าพร้อม)", () => {
    expect(parseReadinessRows(null)).toBeNull();
    expect(parseReadinessRows({})).toBeNull();
    expect(parseReadinessRows([{ branch_id: "b", branch_name: "x", pending_count: "3" }])).toBeNull();
    expect(parseReadinessRows([{ branch_id: 1, branch_name: "x", pending_count: 3 }])).toBeNull();
    expect(parseReadinessRows([null])).toBeNull();
  });
  it("ดูได้เฉพาะผู้ปิดส่วนกลางได้", () => {
    expect(canViewReadiness(host)).toBe(true);
    expect(canViewReadiness(rec)).toBe(true);
    expect(canViewReadiness(none)).toBe(false);
  });
});

describe("M40 · แก้หลังปิด", () => {
  const raw = [
    { changed_at: "2026-11-02T03:10:00Z", table_name: "visits", action: "update", branch_id: "b1", branch_name: "นครปฐม", actor_name: "สมชาย", actor_position_code: "OM", actor_position_name: "ผู้จัดการ" },
    { changed_at: "2026-11-02T04:00:00Z", table_name: "station_checks", action: "insert", branch_id: "b2", branch_name: "หัวหิน", actor_name: null, actor_position_code: null, actor_position_name: null },
    { changed_at: "2026-11-02T05:00:00Z", table_name: "monthly_branch_snapshots", action: "delete", branch_id: null, branch_name: null, actor_name: "ก", actor_position_code: null, actor_position_name: null },
  ];
  it("เปิดใช้แล้ว", () => {
    expect(POST_CLOSE_EDITS_AVAILABLE).toBe(true);
  });
  it("แปลงรายการ + นับ N", () => {
    const rows = parsePostCloseEdits(raw)!;
    expect(rows).toHaveLength(3);
    expect(countPostCloseEdits(rows)).toBe(3);
    expect(countPostCloseEdits([])).toBe(0);
  });
  it("แปลงตาราง/การกระทำเป็นไทย + ผู้แก้", () => {
    const [a, b, c] = parsePostCloseEdits(raw)!.map(describePostCloseEdit);
    expect(a).toMatchObject({ what: "ผลบริการ", actionText: "แก้ไข", branch: "นครปฐม", by: "สมชาย (ผู้จัดการ)" });
    expect(b).toMatchObject({ what: "ผลตรวจสถานี", actionText: "เพิ่ม", by: "ไม่ทราบผู้แก้" });
    expect(c).toMatchObject({ what: "ตัวเลขต่างจังหวัด (กรอกมือ)", actionText: "ลบ", branch: "—", by: "ก" });
    expect(tableLabelTh("customers")).toBe("ข้อมูลบริการ");
    expect(actionLabelTh("xyz")).toBe("แก้ไข");
  });
  it("รูปแบบผิด = null", () => {
    expect(parsePostCloseEdits(undefined)).toBeNull();
    expect(parsePostCloseEdits([{ table_name: "visits" }])).toBeNull();
    expect(parsePostCloseEdits(["x"])).toBeNull();
  });
  it("scope ที่เรียกได้: host ทั้งคู่ · recorder central เท่านั้น · อื่นๆ ไม่มี", () => {
    expect(postCloseScopesFor(host)).toEqual(["central", "province"]);
    expect(postCloseScopesFor(rec)).toEqual(["central"]);
    expect(postCloseScopesFor(none)).toEqual([]);
    expect(canListPostCloseEdits(rec, "province")).toBe(false);
    expect(canListPostCloseEdits(rec, "central")).toBe(true);
  });
  it("ป้าย: 0/null/ไม่มีข้อมูล = ไม่แสดง · รวมต่อเดือน", () => {
    const counts = {
      [postCloseKey("2026-10", "central")]: 3,
      [postCloseKey("2026-10", "province")]: 2,
      [postCloseKey("2026-09", "central")]: 0,
      [postCloseKey("2026-09", "province")]: null,
    };
    expect(badgeCount(counts, "2026-10", "central")).toBe(3);
    expect(badgeCount(counts, "2026-09", "central")).toBeUndefined();
    expect(badgeCount(counts, "2026-09", "province")).toBeUndefined();
    expect(badgeCount(counts, "2026-08", "central")).toBeUndefined();
    expect(badgeCountForMonth(counts, "2026-10")).toBe(5);
    expect(badgeCountForMonth(counts, "2026-09")).toBeUndefined();
  });
});
