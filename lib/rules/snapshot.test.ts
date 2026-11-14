import { describe, it, expect } from "vitest";
import { buildBranchSnapshot } from "./snapshot";
import { TIER_RULES } from "./__fixtures__/tierRules";
import type { Contract, BranchRef, MissedServiceResolution } from "./types";
import { MAKEUP_SNAPSHOT_POLICY } from "./missedResolution";

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

// M18 / DECISIONS 2.41 ②: เดือนชดเชยหลังสัญญาจบ นับลูกค้า + มูลค่า + Tier ในเดือนนั้น
describe("buildBranchSnapshot + เดือนชดเชย", () => {
  const c1: Contract = { id: "c1", startDate: "2026-01-01", termYears: 1, valueTotal: 150000 }; // XL1
  const mk = (missedMonth: string, makeupMonth: string): MissedServiceResolution => ({
    contractId: "c1",
    missedMonth,
    kind: "makeup",
    makeupMonth,
  });

  it("ตก พ.ค. ชดเชย ม.ค. 2027 → ม.ค. 2027 นับ 1 ลูกค้า + มูลค่าเต็ม + Tier เดิม", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, {
      resolutions: [mk("2026-05", "2027-01")],
      visits: [],
      policy: "scheduled",
    });
    expect(row.cust).toBe(1);
    expect(row.xl1).toBe(1);
    expect(row.vXL).toBe(150000);
    expect(row.value).toBe(150000);
    expect(row.value_annual).toBe(150000);
  });

  it("ก.พ. 2027 (ไม่มีชดเชย) → ไม่นับ", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-02", TIER_RULES, {
      resolutions: [mk("2026-05", "2027-01")],
      visits: [],
      policy: "scheduled",
    });
    expect(row.cust).toBe(0);
    expect(row.value).toBe(0);
  });

  it("ชดเชยในช่วงสัญญา (มิ.ย. 2026) → ไม่นับซ้ำ", () => {
    const row = buildBranchSnapshot(branch, [c1], "2026-06", TIER_RULES, {
      resolutions: [mk("2026-05", "2026-06")],
      visits: [],
      policy: "scheduled",
    });
    expect(row.cust).toBe(1);
    expect(row.value).toBe(150000);
  });

  it("ชดเชย 2 เดือนที่ตกในเดือนเดียวกัน → นับสัญญาครั้งเดียว", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, {
      resolutions: [mk("2026-05", "2027-01"), mk("2026-08", "2027-01")],
      visits: [],
      policy: "scheduled",
    });
    expect(row.cust).toBe(1);
    expect(row.value).toBe(150000);
  });

  it("ไม่ชดเชย → ไม่นับเดือนหลังสัญญา", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, {
      resolutions: [{ contractId: "c1", missedMonth: "2026-05", kind: "waived" }],
      visits: [],
      policy: "scheduled",
    });
    expect(row.cust).toBe(0);
  });

  it("สัญญายกเลิกก่อนเดือนชดเชย → ไม่นับ", () => {
    const row = buildBranchSnapshot(
      branch,
      [{ ...c1, cancelledAt: "2026-10-01" }],
      "2027-01",
      TIER_RULES,
      { resolutions: [mk("2026-05", "2027-01")], visits: [], policy: "scheduled" },
    );
    expect(row.cust).toBe(0);
  });

  it("การตัดสินของสัญญาอื่นไม่ทำให้สัญญานี้ถูกนับ", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, {
      resolutions: [{ ...mk("2026-05", "2027-01"), contractId: "other" }],
      visits: [],
      policy: "scheduled",
    });
    expect(row.cust).toBe(0);
  });

  it("policy visited: ชดเชย ม.ค. 2027 แต่ไม่ได้ไป → ไม่นับ · ไปแล้ว → นับ", () => {
    const opts = { resolutions: [mk("2026-05", "2027-01")], policy: "visited" as const };
    expect(buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, { ...opts, visits: [] }).cust).toBe(0);
    const visited = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, {
      ...opts,
      visits: [{ contractId: "c1", visitDate: "2027-01-12", visitType: "routine", makeupForMonth: "2026-05" }],
    });
    expect(visited.cust).toBe(1);
  });

  it("เดือนที่ตกมี routine ภายหลัง (ไม่ตกแล้ว) → การตัดสินเดิมไม่ทำให้นับเดือนชดเชย", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, {
      resolutions: [mk("2026-05", "2027-01")],
      visits: [{ contractId: "c1", visitDate: "2026-05-20", visitType: "routine" }],
      policy: "scheduled",
    });
    expect(row.cust).toBe(0);
  });

  it("ไม่ส่ง policy → ใช้ค่าเริ่มต้นจุดเดียว (MAKEUP_SNAPSHOT_POLICY)", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, {
      resolutions: [mk("2026-05", "2027-01")],
      visits: [],
    });
    expect(row.cust).toBe(MAKEUP_SNAPSHOT_POLICY === "scheduled" ? 1 : 0);
  });
});
