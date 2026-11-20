/** เมนูซ้าย: ชื่อเมนูตาม DECISIONS 2.37 / mockup `_shell/nav.html` และสิทธิ์เห็นเมนูตาม role */
import { describe, expect, it } from "vitest";

import { NAV_GROUPS, filterNavForRole } from "./nav-items";

const labelsFor = (role: Parameters<typeof filterNavForRole>[1]) =>
  filterNavForRole(NAV_GROUPS, role).flatMap((g) => g.items.map((i) => i.label));

describe("ชื่อเมนู (2.37)", () => {
  const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label));
  it("ใช้ชื่อใหม่ครบ", () => {
    expect(all).toContain("ลงข้อมูลทำบริการประจำเดือน");
    expect(all).toContain("กล่อง AG นอกรอบประจำเดือน");
    expect(all).toContain("ประวัติการแก้ไข");
  });
  it("ไม่เหลือชื่อเก่า", () => {
    expect(all).not.toContain("ประวัติย้อนหลัง");
  });
});

describe("filterNavForRole", () => {
  it("เมนู 'ลูกค้ารอเก็บสถานี': host / admin / recorder เห็น · viewer ไม่เห็น", () => {
    for (const role of ["host", "admin", "recorder"] as const) {
      expect(labelsFor(role)).toContain("ลูกค้ารอเก็บสถานี");
    }
    expect(labelsFor("viewer")).not.toContain("ลูกค้ารอเก็บสถานี");
  });
  it("admin ยังไม่เห็นเมนูลงข้อมูลบริการ / กล่อง AG (ไม่เพิ่มสิทธิ์บันทึก)", () => {
    expect(labelsFor("admin")).not.toContain("ลงข้อมูลทำบริการประจำเดือน");
    expect(labelsFor("admin")).not.toContain("กล่อง AG นอกรอบประจำเดือน");
  });
  it("เฉพาะ host เห็น 'ประวัติการแก้ไข'", () => {
    expect(labelsFor("host")).toContain("ประวัติการแก้ไข");
    for (const role of ["admin", "recorder", "viewer"] as const) {
      expect(labelsFor(role)).not.toContain("ประวัติการแก้ไข");
    }
  });
  it("เมนู 'Dashboard งานขาย (New/Renew)' (2.91): host / admin เห็น · recorder / viewer ไม่เห็น", () => {
    for (const role of ["host", "admin"] as const) expect(labelsFor(role)).toContain("Dashboard งานขาย (New/Renew)");
    for (const role of ["recorder", "viewer"] as const) expect(labelsFor(role)).not.toContain("Dashboard งานขาย (New/Renew)");
  });
  it("viewer เห็นเฉพาะ Dashboard สรุป", () => {
    expect(labelsFor("viewer")).toEqual(["Dashboard สรุปมูลค่าทั้งหมด"]);
  });
});
