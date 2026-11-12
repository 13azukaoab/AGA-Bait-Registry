import { describe, expect, it } from "vitest";

import { formatDuration, formatTimeInput, isValidTime, toMinutes, trimDbTime, workTime } from "./timeInput";

describe("formatTimeInput", () => {
  it("เติม : ให้เมื่อพิมพ์เลขล้วน", () => {
    expect(formatTimeInput("1445")).toBe("14:45");
    expect(formatTimeInput("930")).toBe("93:0");
    expect(formatTimeInput("09")).toBe("09");
  });
  it("ตัดตัวอักษรและเกิน 4 หลัก", () => {
    expect(formatTimeInput("14:45")).toBe("14:45");
    expect(formatTimeInput("1445999")).toBe("14:45");
    expect(formatTimeInput("ab")).toBe("");
  });
});

describe("isValidTime / toMinutes", () => {
  it("รับ 00:00–23:59", () => {
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(toMinutes("09:30")).toBe(570);
  });
  it("ปฏิเสธ 24:00, 12:60, รูปแบบไม่ครบ", () => {
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("12:60")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
    expect(toMinutes("93:0")).toBeNull();
  });
});

describe("workTime", () => {
  it("ยังไม่กรอกครบ", () => {
    expect(workTime("", "10:00")).toEqual({ status: "empty" });
  });
  it("รูปแบบผิด", () => {
    expect(workTime("9:3", "10:00")).toEqual({ status: "badFormat" });
  });
  it("ออกต้องหลังเข้า (เท่ากัน/ก่อน = ผิด)", () => {
    expect(workTime("10:00", "10:00")).toEqual({ status: "notAfter" });
    expect(workTime("14:45", "09:00")).toEqual({ status: "notAfter" });
  });
  it("คำนวณนาที", () => {
    expect(workTime("09:30", "14:45")).toEqual({ status: "ok", minutes: 315 });
  });
});

describe("formatDuration / trimDbTime", () => {
  it("แสดงชั่วโมง นาที", () => {
    expect(formatDuration(315)).toBe("5 ชม. 15 นาที");
    expect(formatDuration(45)).toBe("0 ชม. 45 นาที");
  });
  it("ตัดวินาทีจากฐานข้อมูล", () => {
    expect(trimDbTime("14:45:00")).toBe("14:45");
    expect(trimDbTime(null)).toBe("");
  });
});
