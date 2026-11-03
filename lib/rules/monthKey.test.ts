import { describe, it, expect } from "vitest";
import { monthKey } from "./monthKey";

describe("monthKey", () => {
  it("'YYYY-MM' → 'MMM.YY' ตัวพิมพ์ใหญ่", () => {
    expect(monthKey("2026-09")).toBe("SEP.26");
    expect(monthKey("2025-01")).toBe("JAN.25");
    expect(monthKey("2026-12")).toBe("DEC.26");
  });
});
