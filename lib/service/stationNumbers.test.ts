import { describe, expect, it } from "vitest";

import { MAX_STATIONS_PER_ENTRY, formatStationNumbers, parseStationNumbers } from "./stationNumbers";

describe("parseStationNumbers", () => {
  it("แปลงเลขเดี่ยว + ช่วง ตามตัวอย่างใน SPEC (3, 5, 8-12 = 7 สถานี)", () => {
    const r = parseStationNumbers("3, 5, 8-12");
    expect(r).toEqual({ ok: true, numbers: [3, 5, 8, 9, 10, 11, 12] });
  });

  it("เรียงจากน้อยไปมาก และตัดเลขซ้ำ", () => {
    expect(parseStationNumbers("12, 3, 3, 10-11, 11")).toEqual({ ok: true, numbers: [3, 10, 11, 12] });
  });

  it("รับช่องว่าง/ขีดยาว/ทิลเดอ และจุลภาคภาษาไทยที่พิมพ์ติดกันได้", () => {
    expect(parseStationNumbers(" 81 – 85 ")).toEqual({ ok: true, numbers: [81, 82, 83, 84, 85] });
    expect(parseStationNumbers("1~3,7")).toEqual({ ok: true, numbers: [1, 2, 3, 7] });
    expect(parseStationNumbers("1 2  4")).toEqual({ ok: true, numbers: [1, 2, 4] });
  });

  it("ช่องว่างเปล่า = ไม่มีเลข", () => {
    expect(parseStationNumbers("   ")).toEqual({ ok: true, numbers: [] });
  });

  it("ปฏิเสธเลข 0 / ติดลบ / ไม่ใช่ตัวเลข", () => {
    expect(parseStationNumbers("0").ok).toBe(false);
    expect(parseStationNumbers("IG-3").ok).toBe(false);
    expect(parseStationNumbers("3, abc").ok).toBe(false);
    expect(parseStationNumbers("2.5").ok).toBe(false);
  });

  it("ปฏิเสธช่วงกลับด้าน (12-8)", () => {
    const r = parseStationNumbers("12-8");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("12-8");
  });

  it("ปฏิเสธช่วงที่ใหญ่เกินกำหนด (กันพิมพ์ผิดเป็น 1-10000)", () => {
    expect(parseStationNumbers(`1-${MAX_STATIONS_PER_ENTRY + 1}`).ok).toBe(false);
    expect(parseStationNumbers(`1-${MAX_STATIONS_PER_ENTRY}`).ok).toBe(true);
  });
});

describe("formatStationNumbers", () => {
  it("ย่อเลขต่อเนื่องเป็นช่วง", () => {
    expect(formatStationNumbers([3, 5, 8, 9, 10, 11, 12])).toBe("3, 5, 8-12");
  });

  it("รับเลขไม่เรียง/ซ้ำ และว่าง", () => {
    expect(formatStationNumbers([5, 3, 4, 4])).toBe("3-5");
    expect(formatStationNumbers([])).toBe("");
  });

  it("แปลงไปกลับได้ค่าเดิม", () => {
    const r = parseStationNumbers(formatStationNumbers([1, 2, 3, 7, 9, 10]));
    expect(r).toEqual({ ok: true, numbers: [1, 2, 3, 7, 9, 10] });
  });
});
