import { describe, expect, it } from "vitest";
import { userLabel } from "./userLabel";

describe("userLabel", () => {
  it("แสดงชื่อ + ตำแหน่งสั้น", () => {
    expect(
      userLabel({ displayName: "ทดสอบ Project Manager", positionShortName: "PM", username: "pm.test" }),
    ).toEqual({ name: "ทดสอบ Project Manager", position: "PM", full: "ทดสอบ Project Manager · PM" });
  });

  it("ไม่มี displayName ใช้ username", () => {
    expect(userLabel({ displayName: null, positionShortName: "OM", username: "om.test" }).full).toBe("om.test · OM");
    expect(userLabel({ displayName: "   ", positionShortName: "OM", username: "om.test" }).name).toBe("om.test");
  });

  it("ไม่มีตำแหน่ง แสดงแค่ชื่อ ไม่มี ' · ' ค้าง", () => {
    for (const p of [null, undefined, "", "  "]) {
      const l = userLabel({ displayName: "สมชาย", positionShortName: p, username: "x" });
      expect(l).toEqual({ name: "สมชาย", position: "", full: "สมชาย" });
    }
  });

  it("ตัดช่องว่างหัวท้าย", () => {
    expect(userLabel({ displayName: "  สมชาย ", positionShortName: " PM ", username: "x" }).full).toBe("สมชาย · PM");
  });
});
