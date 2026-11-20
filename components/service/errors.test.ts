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

describe("describeServiceError — M43 ตรวจภายในเฉพาะ routine (23514)", () => {
  const CHECK = 'new row for relation "visits" violates check constraint "visits_internal_inspection_routine_only"';
  it("23514 ของ CHECK นี้ = ข้อความไทยเฉพาะ ไม่ใช่บั๊ก ไม่โชว์ข้อความดิบ", () => {
    const r = describeServiceError({ code: "23514", message: CHECK });
    expect(r.message).toBe("ติ๊กตรวจภายในได้เฉพาะการเข้าบริการประจำเดือน — เอาติ๊กออกหรือเปลี่ยนประเภทการเข้า แล้วบันทึกอีกครั้ง");
    expect(r.isBug).toBe(false);
    expect(r.message).not.toContain("visits_internal");
  });
  it("อ่านชื่อ constraint จาก details ก็ได้", () => {
    const r = describeServiceError({ code: "23514", message: "x", details: "Failing row ... " + CHECK });
    expect(r.isBug).toBe(false);
    expect(r.message).toContain("ตรวจภายใน");
  });
  it("23514 ของ constraint อื่น = ยังเป็นบั๊กหน้าจอ (ข้อความทั่วไป)", () => {
    const r = describeServiceError({ code: "23514", message: 'violates check constraint "other_check"' });
    expect(r.isBug).toBe(true);
    expect(r.message).not.toContain("ตรวจภายใน");
  });
});
