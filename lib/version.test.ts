import { describe, expect, it } from "vitest";

import { formatVersion } from "./version";

describe("formatVersion", () => {
  it("แสดงเวอร์ชันพร้อม commit sha", () => {
    expect(formatVersion("0.7.0", "a1b2c3d")).toBe("v0.7.0 · a1b2c3d");
  });

  it("ไม่มี sha แสดงเฉพาะเวอร์ชัน", () => {
    expect(formatVersion("0.7.0", "")).toBe("v0.7.0");
  });

  it("ตัดช่องว่างหัวท้าย", () => {
    expect(formatVersion(" 1.0.0-rc.1 ", " abc1234 ")).toBe("v1.0.0-rc.1 · abc1234");
  });
});
