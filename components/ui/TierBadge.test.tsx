/**
 * เทสป้าย Tier: ครบ 10 แบบ (S/M/L/XL/XXL × 1/3 ปี) และ XXL ใช้ class `tier xxl1` / `tier xxl3`
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SIZE_ORDER } from "@/components/customers/registryFilters";

import { TierBadge } from "./TierBadge";

describe("TierBadge", () => {
  it("ป้าย XXL 1 ปี / 3 ปี ใช้ class xxl1 / xxl3", () => {
    expect(renderToStaticMarkup(<TierBadge tier="XXL" years={1} />)).toContain('class="tier xxl1"');
    expect(renderToStaticMarkup(<TierBadge tier="XXL" years={3} />)).toContain('class="tier xxl3"');
  });
  it("ระยะเป็นเดือน: 36 = กลุ่ม 3 ปี · อื่นๆ (รวม Custom) = กลุ่ม 1 ปี", () => {
    expect(renderToStaticMarkup(<TierBadge tier="XXL" termMonths={36} />)).toContain("tier xxl3");
    expect(renderToStaticMarkup(<TierBadge tier="XXL" termMonths={5} />)).toContain("tier xxl1");
  });
  it("8 แบบเดิมไม่เปลี่ยน", () => {
    expect(renderToStaticMarkup(<TierBadge tier="XL" years={3} />)).toContain('class="tier xl3"');
    expect(renderToStaticMarkup(<TierBadge tier="S" years={1} />)).toContain('class="tier s1"');
  });
  it("ตัวกรองขนาด (Tier) รู้จัก XXL เรียงสูงสุดท้ายสุด", () => {
    expect(SIZE_ORDER).toEqual(["S", "M", "L", "XL", "XXL"]);
  });
});
