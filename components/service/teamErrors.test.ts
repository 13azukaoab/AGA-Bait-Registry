import { describe, expect, it } from "vitest";

import { describeServiceError } from "./errors";

describe("describeServiceError — ทีม M26/M33 (หน้า /service)", () => {
  it("TM004 บอกรหัสทีมที่ปิด · ไม่ใช่บั๊กหน้าจอ", () => {
    const r = describeServiceError({ code: "TM004", message: "x", details: "O, P" });
    expect(r.message).toContain("ทีม O, P");
    expect(r.message).toContain("ปิดใช้งาน");
    expect(r.isBug).toBe(false);
  });
  it("TM005 บอกรหัสทีม Sup", () => {
    const r = describeServiceError({ code: "TM005", message: "x", details: "Sup" });
    expect(r.message).toContain("ทีม Sup");
    expect(r.isBug).toBe(false);
  });
  it("TM006 / TM002 / AG015 มีข้อความไทยเฉพาะ ไม่ตกเป็นข้อความทั่วไป", () => {
    for (const code of ["TM006", "TM002", "AG015"]) {
      const r = describeServiceError({ code, message: "x" });
      expect(r.isBug).toBe(false);
      expect(r.message).not.toContain("บันทึกไม่สำเร็จ ลองอีกครั้ง");
    }
  });
});
