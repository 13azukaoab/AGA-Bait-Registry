import { describe, expect, it } from "vitest";

import {
  CONFIRM_PHRASE,
  EMPTY_FILTER,
  activeHostCount,
  canManageRow,
  computeStats,
  formatLastLogin,
  matchesFilter,
  selectablePositions,
  validateCreate,
  validateEdit,
  type PositionOption,
  type UserRow,
} from "./userLogic";

// ข้อมูลสมมติ (ไม่ใช่คนจริง)
const POS: PositionOption[] = [
  { code: "job_admin", nameTh: "แอดมิน (Admin)", shortNameTh: "แอดมิน", role: "admin", assignable: true, sortOrder: 1 },
  { code: "supervisor", nameTh: "หัวหน้างาน (Supervisor)", shortNameTh: "หัวหน้างาน", role: "recorder", assignable: true, sortOrder: 2 },
  { code: "pm", nameTh: "Project Manager (PM)", shortNameTh: "PM", role: "host", assignable: true, sortOrder: 3 },
  { code: "owner", nameTh: "เจ้าของ", shortNameTh: "เจ้าของ", role: "host", assignable: false, sortOrder: 5 },
];

function user(o: Partial<UserRow> & { userId: string }): UserRow {
  return {
    username: "ag-01001",
    displayName: "สมมติ หนึ่ง",
    positionCode: "pm",
    role: "host",
    isActive: true,
    mustChangePassword: false,
    lastLogin: null,
    ...o,
  };
}

describe("selectablePositions / canManageRow", () => {
  it("ตำแหน่งเจ้าของ (assignable=false) ไม่อยู่ในตัวเลือก", () => {
    expect(selectablePositions(POS).map((p) => p.code)).toEqual(["job_admin", "supervisor", "pm"]);
  });
  it("บัญชีเจ้าของจัดการจากหน้านี้ไม่ได้ · ตำแหน่งที่ไม่รู้จัก = ไม่ได้ · ยังไม่มีตำแหน่ง = ได้", () => {
    expect(canManageRow({ positionCode: "owner" }, POS)).toBe(false);
    expect(canManageRow({ positionCode: "ghost" }, POS)).toBe(false);
    expect(canManageRow({ positionCode: "pm" }, POS)).toBe(true);
    expect(canManageRow({ positionCode: null }, POS)).toBe(true);
  });
});

describe("validateCreate", () => {
  const ok = { username: "AG-01234", displayName: "สมมติ สอง", positionCode: "supervisor" };
  it("ผ่านเมื่อครบ (พิมพ์ใหญ่ก็ได้ — normalize เป็นตัวเล็ก)", () => {
    expect(validateCreate(ok, POS, [])).toEqual({});
  });
  it("username ผิดรูปแบบ / ซ้ำ (ไม่สนตัวพิมพ์)", () => {
    expect(validateCreate({ ...ok, username: "a" }, POS, []).username).toBeTruthy();
    expect(validateCreate({ ...ok, username: "ag 1234" }, POS, []).username).toBeTruthy();
    expect(validateCreate(ok, POS, ["ag-01234"]).username).toContain("มีบัญชีแล้ว");
  });
  it("ชื่อว่าง/ยาวเกิน · เลือกเจ้าของไม่ได้ · ไม่เลือกตำแหน่งไม่ได้", () => {
    expect(validateCreate({ ...ok, displayName: "  " }, POS, []).displayName).toBeTruthy();
    expect(validateCreate({ ...ok, displayName: "ก".repeat(101) }, POS, []).displayName).toBeTruthy();
    expect(validateCreate({ ...ok, positionCode: "owner" }, POS, []).positionCode).toBeTruthy();
    expect(validateCreate({ ...ok, positionCode: "" }, POS, []).positionCode).toBeTruthy();
  });
});

describe("validateEdit", () => {
  const pm1 = user({ userId: "u1" });
  const pm2 = user({ userId: "u2", username: "ag-01002" });
  const base = { displayName: "สมมติ หนึ่ง", positionCode: "pm", confirm: "" };

  it("แก้ชื่อเฉย ๆ (ตำแหน่งเดิม) ไม่ต้องพิมพ์คำยืนยัน", () => {
    expect(validateEdit(base, pm1, POS, [pm1, pm2])).toEqual({});
  });
  it("เปลี่ยนตำแหน่งต้องพิมพ์คำยืนยันให้ตรง", () => {
    const d = { ...base, positionCode: "job_admin" };
    expect(validateEdit(d, pm1, POS, [pm1, pm2]).confirm).toBeTruthy();
    expect(validateEdit({ ...d, confirm: CONFIRM_PHRASE }, pm1, POS, [pm1, pm2])).toEqual({});
  });
  it("host คนสุดท้ายลดเป็นตำแหน่งที่ไม่ใช่ host ไม่ได้", () => {
    const d = { ...base, positionCode: "job_admin", confirm: CONFIRM_PHRASE };
    expect(validateEdit(d, pm1, POS, [pm1]).positionCode).toContain("อย่างน้อย 1 คน");
    expect(validateEdit(d, pm1, POS, [pm1, pm2]).positionCode).toBeUndefined();
  });
  it("เปลี่ยนไปตำแหน่งเจ้าของไม่ได้", () => {
    const d = { ...base, positionCode: "owner", confirm: CONFIRM_PHRASE };
    expect(validateEdit(d, pm1, POS, [pm1, pm2]).positionCode).toBeTruthy();
  });
});

describe("computeStats / matchesFilter / activeHostCount", () => {
  const users = [
    user({ userId: "1", positionCode: "pm" }),
    user({ userId: "2", positionCode: "supervisor", role: "recorder" }),
    user({ userId: "3", positionCode: "supervisor", role: "recorder", isActive: false }),
  ];
  it("นับต่อตำแหน่งเฉพาะที่ใช้งาน + จำนวนปิด", () => {
    expect(computeStats(users)).toEqual({ total: 3, off: 1, byPosition: { pm: 1, supervisor: 1 } });
  });
  it("ตัวกรองการ์ด/สถานะ/ค้นหา", () => {
    expect(users.filter((u) => matchesFilter(u, { ...EMPTY_FILTER, card: "off" })).map((u) => u.userId)).toEqual(["3"]);
    expect(users.filter((u) => matchesFilter(u, { ...EMPTY_FILTER, card: "supervisor" })).map((u) => u.userId)).toEqual(["2"]);
    expect(users.filter((u) => matchesFilter(u, { ...EMPTY_FILTER, status: "on" })).length).toBe(2);
    expect(users.filter((u) => matchesFilter(u, { ...EMPTY_FILTER, query: "AG-01001" })).length).toBe(3);
    expect(users.filter((u) => matchesFilter(u, { ...EMPTY_FILTER, query: "ไม่มี" })).length).toBe(0);
  });
  it("นับ host ที่ใช้งาน ไม่รวมคนที่ยกเว้น", () => {
    expect(activeHostCount(users)).toBe(1);
    expect(activeHostCount(users, "1")).toBe(0);
  });
});

describe("formatLastLogin (เวลาไทย)", () => {
  const now = new Date("2026-11-17T05:00:00Z"); // 12:00 น. ไทย
  it("ไม่เคยเข้า / วันนี้ / เมื่อวาน / วันที่", () => {
    expect(formatLastLogin(null, now)).toBe("ยังไม่เคยเข้า");
    expect(formatLastLogin("2026-11-17T01:41:00Z", now)).toBe("วันนี้ 08:41");
    expect(formatLastLogin("2026-11-16T10:20:00Z", now)).toBe("เมื่อวาน 17:20");
    expect(formatLastLogin("2026-11-04T03:00:00Z", now)).toBe("04/11/2026");
    expect(formatLastLogin("ผิด", now)).toBe("—");
  });
  it("ข้ามเที่ยงคืนตามเวลาไทย (17:30Z = 00:30 วันถัดไป)", () => {
    expect(formatLastLogin("2026-11-16T17:30:00Z", now)).toBe("วันนี้ 00:30");
  });
});
