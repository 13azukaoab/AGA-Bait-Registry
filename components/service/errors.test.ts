import { describe, expect, it } from "vitest";

import { describeServiceError } from "./errors";

describe("describeServiceError — M37 ชื่อจุดกล่อง AG", () => {
  it("SV012 = ไม่ใช่กล่อง AG", () => {
    const r = describeServiceError({ code: "SV012", message: "x" });
    expect(r.message).toContain("กล่อง AG");
    expect(r.isBug).toBe(false);
  });

  it("SV013 = สถานีถอด/กำจัด/หาย/ถอนแล้ว", () => {
    const r = describeServiceError({ code: "SV013" });
    expect(r.message).toContain("ถอดแล้ว");
    expect(r.message).toContain("แก้ชื่อจุดไม่ได้");
    expect(r.isBug).toBe(false);
  });

  it("SV014 = แก้ตรงไม่ได้ ต้องใช้ปุ่มแก้ชื่อจุด", () => {
    const r = describeServiceError({ code: "SV014" });
    expect(r.message).toContain("ปุ่มแก้ชื่อจุด");
    expect(r.isBug).toBe(false);
  });

  it("22001 = ชื่อจุดยาวเกิน 40 ตัวอักษร (ไม่ใช่บั๊ก ผู้ใช้แก้เองได้)", () => {
    const r = describeServiceError({ code: "22001" });
    expect(r.message).toContain("40 ตัวอักษร");
    expect(r.isBug).toBe(false);
  });

  it("42501 = ไม่มีสิทธิ์", () => {
    const r = describeServiceError({ code: "42501" });
    expect(r.message).toContain("ไม่มีสิทธิ์");
    expect(r.isBug).toBe(false);
  });
});
