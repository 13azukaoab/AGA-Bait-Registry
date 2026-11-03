import { describe, it, expect } from "vitest";
import type { SnapshotRow } from "../rules/types";
import { toDashboardRow } from "./row";

describe("toDashboardRow", () => {
  const snap: SnapshotRow = {
    area: "เขต 1", branch: "พุทธมณฑล",
    s1: 41, s3: 123, m1: 12, m3: 13, l1: 5, l3: 5, xl1: 1, xl3: 0,
    cust: 200, vS: 7344973.74, vM: 1860525.89, vL: 1308417, vXL: 318860,
    value: 10832776.63, value_annual: 9999999,
  };

  it("ตัด value_annual ทิ้ง เหลือ 16 ฟิลด์เป๊ะ", () => {
    const row = toDashboardRow(snap);
    expect(Object.keys(row)).toHaveLength(16);
    expect("value_annual" in row).toBe(false);
  });

  it("ค่าทุกฟิลด์ตรงกับต้นฉบับ", () => {
    expect(toDashboardRow(snap)).toEqual({
      area: "เขต 1", branch: "พุทธมณฑล",
      s1: 41, s3: 123, m1: 12, m3: 13, l1: 5, l3: 5, xl1: 1, xl3: 0,
      cust: 200, vS: 7344973.74, vM: 1860525.89, vL: 1308417, vXL: 318860,
      value: 10832776.63,
    });
  });
});
