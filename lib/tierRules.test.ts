/** DECISIONS 2.119: ป้าย Tier บนหน้าจอใช้เกณฑ์ของเดือนที่ส่งมา (เดือนปัจจุบัน/เดือนบริการ) ไม่ใช่เดือนเริ่มสัญญา */
import { describe, expect, it } from "vitest";

import { toContractRow } from "@/components/customer-detail/data";
import { toRegistryRow } from "@/components/customers/registryData";
import { tierFor } from "@/components/customers-new/rowCalc";
import type { TierRule } from "@/lib/rules";
import { TIER_RULES } from "@/lib/rules/__fixtures__/tierRules";
import { currentBangkokMonth } from "@/lib/service/months";
import { contractTierForMonth } from "@/lib/tierRules";

// สัญญาเริ่ม ม.ค. 26 มูลค่า 400,000 / 12 เดือน · ชุด 2000-01 ไม่มี XXL · ชุด 2026-11 มี XXL 300,000 (ข้อมูลสมมติ)
const RULES_2026_11: TierRule[] = [
  ...TIER_RULES.map((r) => ({ ...r, effectiveMonth: "2000-01" })),
  ...TIER_RULES.map((r) => ({ ...r, effectiveMonth: "2026-11" })),
  { tier: "XXL", minAnnual: 300000, effectiveMonth: "2026-11" },
];

describe("contractTierForMonth", () => {
  it("เดือนบริการ ต.ค. 26 -> XL · พ.ย. 26 -> XXL (สัญญาเริ่ม ม.ค. 26 ไม่เกี่ยว)", () => {
    expect(contractTierForMonth(400000, 12, RULES_2026_11, "2026-10")).toBe("XL");
    expect(contractTierForMonth(400000, 12, RULES_2026_11, "2026-11")).toBe("XXL");
  });
  it("มีชุดเดียวไม่มี XXL -> XL เหมือนเดิม", () => {
    expect(contractTierForMonth(400000, 12, TIER_RULES, "2026-11")).toBe("XL");
  });
});

describe("เดือนปัจจุบันเวลาไทย", () => {
  it("ข้ามเที่ยงคืนไทย: 2026-10-31 17:30 UTC = 1 พ.ย. ไทย -> ใช้ชุด พ.ย.", () => {
    const month = currentBangkokMonth(new Date("2026-10-31T17:30:00Z"));
    expect(month).toBe("2026-11");
    expect(contractTierForMonth(400000, 12, RULES_2026_11, month)).toBe("XXL");
    expect(contractTierForMonth(400000, 12, RULES_2026_11, currentBangkokMonth(new Date("2026-10-31T16:30:00Z")))).toBe("XL");
  });
  it("หน้าเปิดงานใหม่ (tierFor) ใช้เดือนปัจจุบัน -> XXL1", () => {
    expect(tierFor(400000, 12, RULES_2026_11, new Date("2026-11-28T05:00:00Z"))?.label).toBe("XXL1");
  });
});

describe("ทะเบียน / รายละเอียดลูกค้า: สัญญาเริ่ม ม.ค. 26 ขึ้นตามเดือนปัจจุบัน", () => {
  const raw = {
    id: "c1",
    customer_id: "u1",
    contract_no: "T-1",
    start_date: "2026-01-15",
    end_date: "2027-01-14",
    term_months: 12,
    value_total: 400000,
    status: "active" as const,
    customers: { name: "ทดสอบ", branch_id: "b1", customer_types: null, branches: { name: "สาขา", zones: { name: "เขต 1" } } },
    stations: [{ count: 3 }],
  };
  it("ทะเบียน พ.ย. 26 -> XXL · ต.ค. 26 -> XL", () => {
    expect(toRegistryRow(raw, RULES_2026_11, "2026-11-28", "default")?.tier).toBe("XXL");
    expect(toRegistryRow(raw, RULES_2026_11, "2026-10-31", "default")?.tier).toBe("XL");
  });
  it("รายละเอียดลูกค้า พ.ย. 26 -> XXL", () => {
    const c = {
      ...raw,
      sale_type: "new",
      closed_at: null,
      cancelled_at: null,
      renewed_from_contract_id: null,
      stations_initialized_at: null,
      contract_teams: [],
    };
    expect(toContractRow(c as never, RULES_2026_11, "2026-11-28").tier).toBe("XXL");
  });
});
