import { describe, expect, it } from "vitest";

import { canAccessPath, homeForRole } from "@/lib/auth/access";
import type { UserRole } from "@/lib/db/types";

import { adminLandingPath } from "./adminLanding";

describe("adminLandingPath (/admin → เมนูแรกของกลุ่มดูแลระบบที่เข้าได้)", () => {
  it("host → /admin/closure (เมนูแรกของกลุ่ม)", () => {
    expect(adminLandingPath("host")).toBe("/admin/closure");
  });
  it("recorder → /admin/closure (เห็นแค่เมนูปิดเดือนในกลุ่มนี้)", () => {
    expect(adminLandingPath("recorder")).toBe("/admin/closure");
  });
  it("admin (ไม่มีเมนูในกลุ่มดูแลระบบ) → หน้าแรกของตำแหน่ง /customers", () => {
    expect(adminLandingPath("admin")).toBe("/customers");
    expect(adminLandingPath("admin")).toBe(homeForRole("admin"));
  });
  it("viewer (ไม่มีเมนูที่เข้าได้) → homeForRole", () => {
    expect(adminLandingPath("viewer")).toBe(homeForRole("viewer"));
  });
  it("ทุกตำแหน่ง: ปลายทางต้องเป็นหน้าที่ตำแหน่งนั้นเข้าได้จริง หรือเป็นหน้าแรกของตำแหน่ง", () => {
    for (const role of ["host", "admin", "recorder", "viewer"] as UserRole[]) {
      const target = adminLandingPath(role);
      expect(canAccessPath(role, target) || target === homeForRole(role)).toBe(true);
    }
  });
});
