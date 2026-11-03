import { describe, it, expect } from "vitest";
import { buildBranchSnapshot } from "./snapshot";
import { TIER_RULES } from "./__fixtures__/tierRules";
import type { Contract, BranchRef } from "./types";

const branch: BranchRef = { area: "เขต 1", branch: "นครปฐม" };

describe("buildBranchSnapshot", () => {
  it("นับเฉพาะสัญญาที่ month อยู่ในเดือนบริการ และไม่ถูกยกเลิก", () => {
    const contracts: Contract[] = [
      { id: "a", startDate: "2026-01-01", termYears: 3, valueTotal: 50000 }, // S3
      { id: "b", startDate: "2026-01-01", termYears: 1, valueTotal: 150000 }, // XL1
      { id: "c", startDate: "2026-01-01", termYears: 3, valueTotal: 150000 }, // L3
      { id: "d", startDate: "2030-01-01", termYears: 1, valueTotal: 99999 }, // นอกช่วง มี.ค.2026
    ];
    const row = buildBranchSnapshot(branch, contracts, "2026-03", TIER_RULES);
    expect(row.area).toBe("เขต 1");
    expect(row.branch).toBe("นครปฐม");
    expect(row.s3).toBe(1);
    expect(row.xl1).toBe(1);
    expect(row.l3).toBe(1);
    expect(row.cust).toBe(3); // d ไม่ถูกนับ
    expect(row.vS).toBe(50000);
    expect(row.vXL).toBe(150000);
    expect(row.vL).toBe(150000);
    expect(row.value).toBe(350000);
    expect(row.value_annual).toBeCloseTo(16666.67 + 150000 + 50000, 2);
  });

  it("สัญญายกเลิกก่อนเดือนที่คิด → ไม่ถูกนับ", () => {
    const contracts: Contract[] = [
      {
        id: "a",
        startDate: "2026-01-01",
        termYears: 1,
        valueTotal: 24000,
        cancelledAt: "2026-02-10",
      },
    ];
    const row = buildBranchSnapshot(branch, contracts, "2026-03", TIER_RULES);
    expect(row.cust).toBe(0);
    expect(row.value).toBe(0);
  });
});
