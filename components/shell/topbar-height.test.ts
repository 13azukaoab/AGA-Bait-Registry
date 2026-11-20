import { describe, expect, it } from "vitest";

import { DEFAULT_TOPBAR_HEIGHT, topbarHeightPx } from "./topbar-height";

describe("topbarHeightPx", () => {
  it("ค่าเริ่มต้น 57px", () => {
    expect(DEFAULT_TOPBAR_HEIGHT).toBe(57);
  });
  it("ปัดเป็นจำนวนเต็ม px", () => {
    expect(topbarHeightPx(102.6)).toBe(103);
    expect(topbarHeightPx(57)).toBe(57);
  });
  it("วัดไม่ได้ (0 / ติดลบ / NaN / Infinity) → null คงค่าเดิม", () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(topbarHeightPx(v)).toBeNull();
  });
});
