import { describe, expect, it } from "vitest";

import {
  canAccessPath,
  homeForRole,
  isAppPath,
  rolesForPath,
  safeRedirectPath,
} from "./access";

describe("isAppPath", () => {
  it("เส้นทางในกลุ่มที่ต้องล็อกอิน", () => {
    expect(isAppPath("/todo")).toBe(true);
    expect(isAppPath("/customers")).toBe(true);
    expect(isAppPath("/customers/123")).toBe(true);
    expect(isAppPath("/admin/users")).toBe(true);
    expect(isAppPath("/todo/")).toBe(true);
  });

  it("หน้าสรุป public และหน้าเข้าสู่ระบบไม่อยู่ในกลุ่มนี้", () => {
    expect(isAppPath("/summary")).toBe(false);
    expect(isAppPath("/login")).toBe(false);
    expect(isAppPath("/change-password")).toBe(false);
    expect(isAppPath("/")).toBe(false);
  });

  it("ไม่หลงกับเส้นทางที่ขึ้นต้นคล้ายกันแต่เป็นคำอื่น", () => {
    expect(isAppPath("/todolist")).toBe(false);
    expect(isAppPath("/customers-export")).toBe(false);
  });
});

describe("rolesForPath / canAccessPath", () => {
  it("หน้าทะเบียนลูกค้า: host, admin, recorder เข้าได้ · viewer เข้าไม่ได้", () => {
    expect(rolesForPath("/customers")).toEqual(["host", "admin", "recorder"]);
    expect(canAccessPath("host", "/customers")).toBe(true);
    expect(canAccessPath("admin", "/customers")).toBe(true);
    expect(canAccessPath("recorder", "/customers")).toBe(true);
    expect(canAccessPath("viewer", "/customers")).toBe(false);
  });

  it("หน้าลูกใช้สิทธิ์ของหน้าแม่", () => {
    expect(canAccessPath("recorder", "/customers/123")).toBe(true);
    expect(canAccessPath("viewer", "/customers/123")).toBe(false);
  });

  it("กฎที่เจาะจงกว่าชนะ: /customers/new ไม่ให้ recorder เข้า", () => {
    expect(rolesForPath("/customers/new")).toEqual(["host", "admin"]);
    expect(canAccessPath("admin", "/customers/new")).toBe(true);
    expect(canAccessPath("recorder", "/customers/new")).toBe(false);
  });

  it("หน้ากรอกผลบริการ: host, recorder เข้าได้ · admin เข้าไม่ได้", () => {
    expect(canAccessPath("host", "/service")).toBe(true);
    expect(canAccessPath("recorder", "/service")).toBe(true);
    expect(canAccessPath("admin", "/service")).toBe(false);
  });

  it("กลุ่มดูแลระบบ: เฉพาะ host (รวมหน้ารวม /admin ที่ไม่มีในเมนู)", () => {
    expect(canAccessPath("host", "/admin")).toBe(true);
    expect(canAccessPath("admin", "/admin")).toBe(false);
    expect(canAccessPath("recorder", "/admin")).toBe(false);
    expect(canAccessPath("host", "/admin/users")).toBe(true);
    expect(canAccessPath("recorder", "/admin/users")).toBe(false);
  });

  it("หน้าปิดเดือนอยู่ใต้ /admin แต่ recorder เข้าได้ (กฎเจาะจงชนะกฎของ /admin)", () => {
    expect(canAccessPath("recorder", "/admin/closure")).toBe(true);
    expect(canAccessPath("admin", "/admin/closure")).toBe(false);
  });

  it("ไม่มีกฎครอบ = ไม่ให้เข้า (default closed)", () => {
    expect(rolesForPath("/ยังไม่มีหน้านี้")).toBeNull();
    expect(canAccessPath("host", "/ยังไม่มีหน้านี้")).toBe(false);
  });
});

describe("homeForRole", () => {
  it("host และ recorder เริ่มที่หน้าสถานะทะเบียนบริการ", () => {
    expect(homeForRole("host")).toBe("/todo");
    expect(homeForRole("recorder")).toBe("/todo");
  });

  it("admin เริ่มที่หน้าทะเบียนลูกค้า (ไม่เห็นหน้างานประจำวัน)", () => {
    expect(homeForRole("admin")).toBe("/customers");
  });

  it("viewer ไม่มีหน้าที่ต้องล็อกอิน → หน้าสรุป public", () => {
    expect(homeForRole("viewer")).toBe("/summary");
  });

  it("หน้าแรกที่คืนมา ตำแหน่งนั้นต้องเข้าได้จริง", () => {
    for (const role of ["host", "admin", "recorder"] as const) {
      expect(canAccessPath(role, homeForRole(role))).toBe(true);
    }
  });
});

describe("safeRedirectPath", () => {
  it("ยอมรับ path ภายในที่อยู่ในกลุ่มที่ต้องล็อกอิน", () => {
    expect(safeRedirectPath("/customers", "/todo")).toBe("/customers");
    expect(safeRedirectPath("/customers/123?tab=stations", "/todo")).toBe(
      "/customers/123?tab=stations",
    );
  });

  it("ปฏิเสธลิงก์ออกนอกเว็บ (open redirect)", () => {
    expect(safeRedirectPath("https://evil.example.com", "/todo")).toBe("/todo");
    expect(safeRedirectPath("//evil.example.com", "/todo")).toBe("/todo");
    expect(safeRedirectPath("/\\evil.example.com", "/todo")).toBe("/todo");
    expect(safeRedirectPath("http://evil.example.com/customers", "/todo")).toBe("/todo");
  });

  it("ปฏิเสธค่าว่างและเส้นทางที่ไม่ใช่กลุ่มที่ต้องล็อกอิน (กันวนลูป)", () => {
    expect(safeRedirectPath(null, "/todo")).toBe("/todo");
    expect(safeRedirectPath("", "/todo")).toBe("/todo");
    expect(safeRedirectPath("/login", "/todo")).toBe("/todo");
    expect(safeRedirectPath("/change-password", "/todo")).toBe("/todo");
    expect(safeRedirectPath("/summary", "/todo")).toBe("/todo");
  });
});
