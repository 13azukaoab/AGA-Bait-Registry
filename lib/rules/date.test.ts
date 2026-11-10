import { describe, it, expect } from "vitest";
import { addYearsMinusDay, monthOf, listMonths } from "./date";

describe("date util", () => {
  it("addYearsMinusDay: วันเริ่ม + N ปี − 1 วัน", () => {
    expect(addYearsMinusDay("2026-01-01", 1)).toBe("2026-12-31");
    expect(addYearsMinusDay("2026-01-15", 1)).toBe("2027-01-14");
    expect(addYearsMinusDay("2026-04-03", 1)).toBe("2027-04-02");
    expect(addYearsMinusDay("2026-01-01", 3)).toBe("2028-12-31");
  });

  it("monthOf: ตัดเอา YYYY-MM", () => {
    expect(monthOf("2026-09-15")).toBe("2026-09");
  });

  it("listMonths: ไล่เดือนต่อเนื่อง n เดือนจากเดือนเริ่ม", () => {
    expect(listMonths("2026-01", 3)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(listMonths("2026-11", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});
