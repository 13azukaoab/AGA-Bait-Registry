import { describe, expect, it } from "vitest";

import { summaryViewMode } from "./view-mode";

describe("summaryViewMode", () => {
  it("ไม่ล็อกอิน (ไม่มีโปรไฟล์) = public", () => {
    expect(summaryViewMode(null)).toBe("public");
  });
  it("ล็อกอินและใช้งานได้ = shell", () => {
    expect(summaryViewMode({ isActive: true, mustChangePassword: false })).toBe("shell");
  });
  it("ปิดบัญชี = public", () => {
    expect(summaryViewMode({ isActive: false, mustChangePassword: false })).toBe("public");
  });
  it("ต้องเปลี่ยนรหัสผ่าน = public", () => {
    expect(summaryViewMode({ isActive: true, mustChangePassword: true })).toBe("public");
  });
});
