import { describe, it, expect } from "vitest";
import { buildBranchSnapshot } from "./snapshot";
import { CHANGE_MONTH, TIER_RULES, TIER_RULE_VERSIONS } from "./__fixtures__/tierRules";
import type { Contract, BranchRef, Visit } from "./types";

const branch: BranchRef = { area: "เขต 1", branch: "นครปฐม" };

describe("buildBranchSnapshot", () => {
  it("นับเฉพาะสัญญาที่ month อยู่ในเดือนบริการ และไม่ถูกยกเลิก", () => {
    const contracts: Contract[] = [
      { id: "a", startDate: "2026-01-01", termMonths: 36, valueTotal: 50000 }, // S3
      { id: "b", startDate: "2026-01-01", termMonths: 12, valueTotal: 150000 }, // XL1
      { id: "c", startDate: "2026-01-01", termMonths: 36, valueTotal: 150000 }, // L3
      { id: "d", startDate: "2030-01-01", termMonths: 12, valueTotal: 99999 }, // นอกช่วง มี.ค.2026
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
        termMonths: 12,
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
    termMonths: 12,
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
    const c2: Contract = { id: "c2", startDate: "2027-01-01", termMonths: 12, valueTotal: 30000, renewedFromContractId: "c1" };
    const row = buildBranchSnapshot(branch, [c1, c2], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-05")]);
    expect(row.cust).toBe(1);
    expect(row.value).toBe(30000);
  });

  it("ต่อสัญญาแต่สัญญาใหม่ยังไม่เริ่มในเดือนชดเชย → นับสัญญาเก่า", () => {
    const c2: Contract = { id: "c2", startDate: "2027-03-01", termMonths: 12, valueTotal: 30000, renewedFromContractId: "c1" };
    const row = buildBranchSnapshot(branch, [c1, c2], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-05")]);
    expect(row.cust).toBe(1);
    expect(row.value).toBe(150000);
  });

  it("เดือนจาก DB แบบ 'YYYY-MM-01' นับได้เหมือนกัน", () => {
    const row = buildBranchSnapshot(branch, [c1], "2027-01", TIER_RULES, [mkVisit("2027-01-12", "2026-05-01")]);
    expect(row.cust).toBe(1);
  });
});

// M20 (DECISIONS 2.31): snapshot ใช้เกณฑ์ของเดือนที่คำนวณ · สัญญาเดียวกันเปลี่ยน Tier ได้เมื่อข้ามเดือนที่เปลี่ยนเกณฑ์
describe("buildBranchSnapshot + เกณฑ์ตามเดือน (M20)", () => {
  // 3 ปี 105,000 → 35,000/ปี: เกณฑ์เดิม M3 · เกณฑ์ใหม่ (สมมติ M เริ่ม 40,000) S3
  const c: Contract = { id: "v1", startDate: "2026-06-01", termMonths: 36, valueTotal: 105000 };

  it("เดือนก่อนเปลี่ยนเกณฑ์ → นับเป็น M3", () => {
    const row = buildBranchSnapshot(branch, [c], "2026-12", TIER_RULE_VERSIONS);
    expect(row.m3).toBe(1);
    expect(row.s3).toBe(0);
    expect(row.vM).toBe(105000);
  });

  it("ตั้งแต่เดือนที่เปลี่ยนเกณฑ์ → นับเป็น S3 (มูลค่าเท่าเดิม)", () => {
    const row = buildBranchSnapshot(branch, [c], CHANGE_MONTH, TIER_RULE_VERSIONS);
    expect(row.s3).toBe(1);
    expect(row.m3).toBe(0);
    expect(row.vS).toBe(105000);
    expect(row.value).toBe(105000);
  });

  it("กรณีบังคับจาก SPEC ยังผ่านเมื่อส่งเกณฑ์หลายชุด", () => {
    const contracts: Contract[] = [
      { id: "a", startDate: "2026-01-01", termMonths: 36, valueTotal: 50000 }, // S3
      { id: "b", startDate: "2026-01-01", termMonths: 12, valueTotal: 150000 }, // XL1
      { id: "c", startDate: "2026-01-01", termMonths: 36, valueTotal: 150000 }, // L3
      { id: "d", startDate: "2026-01-01", termMonths: 12, valueTotal: 29999.5 }, // S1
    ];
    const row = buildBranchSnapshot(branch, contracts, "2026-03", TIER_RULE_VERSIONS);
    expect([row.s3, row.xl1, row.l3, row.s1]).toEqual([1, 1, 1, 1]);
  });
});

describe("M30 — สัญญาระยะเดือน (Custom)", () => {
  it("ข้อ 6: สัญญา 5 เดือน นับใน s1/m1/l1/xl1 ครบ 5 เดือนพอดี (มูลค่าจริงจัด Tier)", () => {
    const contracts: Contract[] = [
      { id: "a", startDate: "2026-01-15", termMonths: 5, valueTotal: 20000 }, // S1 (ไม่ขยายเป็นต่อปี)
      { id: "b", startDate: "2026-01-15", termMonths: 5, valueTotal: 50000 }, // L1 (ไม่ใช่ XL)
    ];
    const counted: string[] = [];
    for (const month of ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]) {
      const row = buildBranchSnapshot(branch, contracts, month, TIER_RULES);
      if (row.cust > 0) {
        counted.push(month);
        expect(row.s1).toBe(1);
        expect(row.l1).toBe(1);
        expect(row.s3 + row.m1 + row.m3 + row.l3 + row.xl1 + row.xl3).toBe(0);
        expect(row.vS).toBe(20000);
        expect(row.vL).toBe(50000);
        expect(row.value_annual).toBe(70000);
      }
    }
    expect(counted).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
  });

  it("Custom 24 เดือน → กลุ่ม 1 ปี · มูลค่าจัด Tier = มูลค่า ÷ 2", () => {
    const contracts: Contract[] = [{ id: "a", startDate: "2026-01-01", termMonths: 24, valueTotal: 120000 }];
    const row = buildBranchSnapshot(branch, contracts, "2027-12", TIER_RULES);
    expect(row.l1).toBe(1); // 60,000/ปี = L
    expect(row.value_annual).toBe(60000);
    expect(buildBranchSnapshot(branch, contracts, "2028-01", TIER_RULES).cust).toBe(0);
  });

  it("ข้อ 5: 12 / 36 เดือนให้แถวเหมือนกฎปีเดิม (กรณีบังคับ CLAUDE.md)", () => {
    const contracts: Contract[] = [
      { id: "a", startDate: "2026-01-01", termMonths: 36, valueTotal: 50000 },
      { id: "b", startDate: "2026-01-01", termMonths: 12, valueTotal: 150000 },
      { id: "c", startDate: "2026-01-01", termMonths: 36, valueTotal: 150000 },
      { id: "d", startDate: "2026-01-01", termMonths: 12, valueTotal: 29999.5 },
    ];
    const row = buildBranchSnapshot(branch, contracts, "2026-12", TIER_RULES);
    expect([row.s3, row.xl1, row.l3, row.s1]).toEqual([1, 1, 1, 1]);
    const after = buildBranchSnapshot(branch, contracts, "2027-01", TIER_RULES);
    expect([after.s3, after.xl1, after.l3, after.s1]).toEqual([1, 0, 1, 0]);
  });
});
