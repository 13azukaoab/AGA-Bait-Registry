import { describe, expect, it } from "vitest";

import { describeTeamError, parseTeamCodes } from "./teamErrors";

describe("parseTeamCodes", () => {
  it("แยกรหัสทีมที่คั่นด้วยจุลภาค", () => {
    expect(parseTeamCodes("A, Sup")).toEqual(["A", "Sup"]);
    expect(parseTeamCodes("X1")).toEqual(["X1"]);
  });
  it("ว่าง / รูปแบบแปลก / ยาวเกิน = []", () => {
    expect(parseTeamCodes(null)).toEqual([]);
    expect(parseTeamCodes("  ")).toEqual([]);
    expect(parseTeamCodes("A; drop table")).toEqual([]);
    expect(parseTeamCodes("A,".repeat(60))).toEqual([]);
  });
});

describe("describeTeamError", () => {
  it("TM004 ใส่รหัสทีมจาก DETAIL", () => {
    const m = describeTeamError("TM004", "O, P");
    expect(m).toContain("ทีม O, P");
    expect(m).toContain("ปิดใช้งาน");
  });
  it("TM005 ใส่รหัสทีมจาก DETAIL", () => {
    const m = describeTeamError("TM005", "Sup");
    expect(m).toContain("ทีม Sup");
    expect(m).toContain("หัวหน้างาน");
  });
  it("ไม่มี DETAIL → ใช้ข้อความกลาง ไม่โชว์ค่าดิบ", () => {
    expect(describeTeamError("TM004", null)).toContain("ทีมที่เลือก");
    expect(describeTeamError("TM005", "<script>")).not.toContain("<script>");
  });
  it("TM006 เฉพาะ host · รหัสอื่น = null", () => {
    expect(describeTeamError("TM006", null)).toContain("Host");
    expect(describeTeamError("AG001", null)).toBeNull();
  });
});
