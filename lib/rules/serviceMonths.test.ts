import { describe, it, expect } from "vitest";
import { serviceMonths, defaultEndDate } from "./serviceMonths";

describe("serviceMonths", () => {
  it("นับจากเดือนเริ่ม × (ปี×12) ไม่ใช้วันสิ้นสุด", () => {
    expect(serviceMonths("2026-01-15", 1)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]);
    expect(serviceMonths("2026-04-03", 1)).toEqual([
      "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
      "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03",
    ]);
    expect(serviceMonths("2026-01-01", 3)).toHaveLength(36);
    expect(serviceMonths("2026-01-01", 3)[0]).toBe("2026-01");
    expect(serviceMonths("2026-01-01", 3)[35]).toBe("2028-12");
  });
});

describe("defaultEndDate", () => {
  it("= วันเริ่ม + N ปี − 1 วัน", () => {
    expect(defaultEndDate("2026-01-01", 1)).toBe("2026-12-31");
    expect(defaultEndDate("2026-01-15", 1)).toBe("2027-01-14");
    expect(defaultEndDate("2026-01-01", 3)).toBe("2028-12-31");
  });
});
