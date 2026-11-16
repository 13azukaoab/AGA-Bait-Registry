import { describe, expect, it } from "vitest";

import { describeDbError } from "./errors";

describe("describeDbError — ทีม M26/M33 (หน้าเปิดงาน)", () => {
  it("TM004 บอกรหัสทีมที่ปิด", () => {
    const m = describeDbError({ code: "TM004", message: "ทีมปิดใช้งาน", details: "O" });
    expect(m).toContain("ทีม O");
    expect(m).toContain("ปิดใช้งาน");
  });
  it("TM005 บอกรหัสทีม Sup", () => {
    const m = describeDbError({ code: "TM005", message: "x", details: "Sup" });
    expect(m).toContain("ทีม Sup");
    expect(m).toContain("หัวหน้างาน");
  });
  it("TM006 เฉพาะ host", () => {
    expect(describeDbError({ code: "TM006", message: "x" })).toContain("Host");
  });
  it("TM002 ครอบคลุมการปิดทีมระบบ", () => {
    expect(describeDbError({ code: "TM002", message: "x" })).toContain("ปิดใช้งาน");
  });
  it("AG015 Renew ต้องบันทึกผ่านหน้าเปิดงาน", () => {
    expect(describeDbError({ code: "AG015", message: "x" })).toContain("Renew");
  });
  it("ไม่โชว์ข้อความดิบของ DB", () => {
    const m = describeDbError({ code: "TM004", message: "RAW_DB_TEXT", details: "A" });
    expect(m).not.toContain("RAW_DB_TEXT");
  });
});
