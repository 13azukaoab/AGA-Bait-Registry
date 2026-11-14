import { describe, it, expect } from "vitest";
import { buildBranchSnapshot } from "./snapshot";
import { TIER_RULES } from "./__fixtures__/tierRules";
import type { Contract, BranchRef, Visit } from "./types";

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

// M18 / DECISIONS 2.45: นับลูกค้า + มูลค่า + Tier เดิม เฉพาะเดือนที่ไปบริการชดเชยจริง (หลังสัญญาจบ)
describe("buildBranchSnapshot + การเข้าชดเชย", () => {
  const c1: Contract = {
    id: "c1",
    startDate: "2026-01-01",
    termYears: 1,
    valueTotal: 150000, // XL1
    stationsInitializedAt: "2026-01-05",
  };
  const mkVisit = (date: string, missedMonth: string, contractId = "c1"): Visit => ({
    contractId,
    visitDate: date,
    visitType: "routine",
    makeupForMonth: missedMonth,
  });

  it("ตก พ.ค. ไปชดเชยจริง ม.ค. 2027 → ม.ค. 2027 นับ 1 ลูกค้า + มูลค่าเต็ม + Tier เดิม", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-05")]);
    expect(row.cust).toBe(1);
    expect(row.xl1).toBe(1);
    expect(row.vXL).toBe(150000);
    expect(row.value).toBe(150000);
    expect(row.value_annual).toBe(150000);
  });

  it("ก.พ. 2027 (ไม่มีการเข้าชดเชย) → ไม่นับ", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-02", TIER_RULES, [mkVisit("2027-01-12", "2026-05")]);
    expect(row.cust).toBe(0);
    expect(row.value).toBe(0);
  });

  it("ยังไม่มีการเข้าชดเชย → ไม่นับเดือนหลังสัญญา", () => {
    expect(buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, []).cust).toBe(0);
  });

  it("ชดเชยในช่วงสัญญา (มิ.ย. 2026) → ไม่นับซ้ำ", () => {
    const row = buildBranchSnapshot(branch, [c1], "2026-06", TIER_RULES, [mkVisit("2026-06-20", "2026-05")]);
    expect(row.cust).toBe(1);
    expect(row.value).toBe(150000);
  });

  it("ชดเชย 2 เดือนที่ตกในเดือนเดียวกัน → นับสัญญาครั้งเดียว", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, [
      mkVisit("2027-01-05", "2026-05"),
      mkVisit("2027-01-20", "2026-08"),
    ]);
    expect(row.cust).toBe(1);
    expect(row.value).toBe(150000);
  });

  it("สัญญายกเลิก → ไม่นับ", () => {
    const row = buildBranchSnapshot(branch, [{ ...c1, cancelledAt: "2026-10-01" }], "2027-01", TIER_RULES, [
      mkVisit("2027-01-12", "2026-05"),
    ]);
    expect(row.cust).toBe(0);
  });

  it("การเข้าชดเชยของสัญญาอื่นไม่ทำให้สัญญานี้ถูกนับ", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, [
      mkVisit("2027-01-12", "2026-05", "other"),
    ]);
    expect(row.cust).toBe(0);
  });

  it("การเข้าที่ไม่ใช่ routine ไม่นับเป็นชดเชย", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, [
      { ...mkVisit("2027-01-12", "2026-05"), visitType: "problem" },
    ]);
    expect(row.cust).toBe(0);
  });

  it("เดือนที่ผูกไว้ไม่ได้ตกจริง (มี routine ปกติ) → ไม่นับเดือนหลังสัญญา", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, [
      { contractId: "c1", visitDate: "2026-05-20", visitType: "routine" },
      mkVisit("2027-01-12", "2026-05"),
    ]);
    expect(row.cust).toBe(0);
  });

  it("เดือนที่ผูกอยู่ก่อนเดือนตั้งสถานี (สัญญาเก่าที่นำเข้า) → ไม่นับ (เกณฑ์เดียวกับ DB)", () => {
    const late = { ...c1, stationsInitializedAt: "2026-06-02" };
    expect(buildBranchSnapshot(branch, [late], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-05")]).cust).toBe(0);
    expect(buildBranchSnapshot(branch, [late], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-07")]).cust).toBe(1);
  });

  it("ยังไม่ตั้งสถานี → การเข้าชดเชยไม่นับ", () => {
    const noInit = { ...c1, stationsInitializedAt: undefined };
    expect(buildBranchSnapshot(branch, [noInit], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-05")]).cust).toBe(0);
  });

  it("ต่อสัญญาแล้ว: สัญญาใหม่ใช้งานในเดือนชดเชย → ไม่นับสัญญาเก่าซ้ำ (2.47)", () => {
    const c2: Contract = { id: "c2", startDate: "2027-01-01", termYears: 1, valueTotal: 30000, renewedFromContractId: "c1" };
    const row = buildBranchSnapshot(branch, [c1, c2], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-05")]);
    expect(row.cust).toBe(1);
    expect(row.value).toBe(30000);
  });

  it("ต่อสัญญาแต่สัญญาใหม่ยังไม่เริ่มในเดือนชดเชย → นับสัญญาเก่า", () => {
    const c2: Contract = { id: "c2", startDate: "2027-03-01", termYears: 1, valueTotal: 30000, renewedFromContractId: "c1" };
    const row = buildBranchSnapshot(branch, [c1, c2], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-05")]);
    expect(row.cust).toBe(1);
    expect(row.value).toBe(150000);
  });

  it("เดือนจาก DB แบบ 'YYYY-MM-01' นับได้เหมือนกัน", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-05-01")]);
    expect(row.cust).toBe(1);
  });
});
