/**
 * เทสแผนนำเข้าทะเบียนส่วนกลาง (pure · ข้อมูลสมมติทั้งหมด · รันได้ใน CI)
 * หัวใจคือ "แผน = dry-run": แถวที่เข้าแผน, จำนวน และยอดเดือนที่คาด ต้องเท่ากับ dryRunRegistrySheet ทุกตัว
 */
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { REGISTRY_IMPORT_OPTIONS } from "./centralRegistrySheets";
import { DUPLICATE_ACROSS_BRANCH_REASON } from "./crossBranchDuplicates";
import { dryRunRegistrySheet } from "./registryDryRun";
import { planRegistryImport, type RegistrySheetInput } from "./registryImportPlan";
import type { CellValue } from "./registrySheet";
import { buildSellerIndex } from "./sellerLookup";

function serial(iso: string): number {
  return (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** หัวตารางแบบชีท "ไม่มี IC" (เหมือน registrySheet.test.ts) — ข้อมูลสมมติ */
const TOP: CellValue[] = [null, null, null, null, null, "Site plan", "ระยะสัญญา", null, "มูลค่าสัญญา", null, "ประเภทลูกค้า", "ประเภทสัญญา"];
const BOTTOM: CellValue[] = ["ลำดับ", "ชื่อลูกค้า", "ที่อยู่ลูกค้า", "เลขที่สัญญา", "เบอร์โทรลูกค้า", "IG", "เริ่ม", "สิ้นสุด", "1 ปี", "3 ปี", "H = บ้าน /T = ทาวน์โฮม/R=ห้อง", false, false, "ทีม"];

function sheet(rows: CellValue[][]): CellValue[][] {
  // แถว Excel: 1–3 หัวเรื่อง · 4–5 หัวตาราง · ข้อมูลเริ่มแถว 6
  return [[], ["สาขาสมมติ"], [], TOP, BOTTOM, ...rows];
}

// สาขา ก (สาทร): 1 ปี · 3 ปี · ช่วงวันที่ข้อความ (ก1) · ประเภทว่าง (ข3) · เลขซ้ำข้ามสาขา (ง1) · เลขผิดรูปมีมูลค่า (ค1) · วันสิ้นสุดผิด (กรอกมือ) · หมดก่อน ต.ค.
const SATHORN = sheet([
  [1, "ลูกค้าสมมติ 1", "", "CT26-0000001", "", 4, serial("2026-01-15"), serial("2027-01-14"), 15000, null, "H", true, false, "A"],
  [2, "ลูกค้าสมมติ 2", "", "CT25-0000002", "", 4, serial("2025-06-01"), serial("2028-05-31"), null, 150000, "T", false, true, "B,C"],
  [3, "ลูกค้าสมมติ 3", "", "CT26-0000003", "", "01/03/2026-28/02/2027", null, null, 60000, null, "", true, false, "A"],
  [4, "ลูกค้าสมมติ 4", "", "CT26-0000099", "", 4, serial("2026-02-01"), serial("2027-01-31"), 20000, null, "H", true, false, "A"],
  [5, "ลูกค้าสมมติ 5", "", "CT26-00006", "", 4, serial("2026-02-01"), serial("2027-01-31"), 20000, null, "H", true, false, "A"],
  [6, "ลูกค้าสมมติ 6", "", "CT26-0000007", "", 4, serial("2026-02-01"), serial("2026-08-20"), 9000, null, "H", true, false, "A"],
  [7, "ลูกค้าสมมติ 7", "", "CT24-0000008", "", 4, serial("2024-01-01"), serial("2024-12-31"), 12000, null, "R", false, false, "D"],
  [8, "ลูกค้าสมมติ 8", "", "CT26-0000009", "", 4, serial("2026-05-15"), serial("2026-10-14"), 50000, null, "H", false, false, ""],
  [null, "รวม", null, null, null, null, null, null, 1000, null, null, null, null, null],
]);
// สาขา ข (ปทุมวัน): เลข CT26-0000099 ซ้ำกับสาทร → กันทั้งคู่
const PATHUMWAN = sheet([
  [1, "ลูกค้าสมมติ 9", "", "CT26-0000099", "", 4, serial("2026-02-01"), serial("2027-01-31"), 20000, null, "H", true, false, "E"],
  [2, "ลูกค้าสมมติ 10", "", "CT26-0000010", "", 4, serial("2026-07-01"), serial("2027-06-30"), 45000, null, "ออฟฟิิต", true, false, "F"],
]);

const SELLERS = buildSellerIndex([
  {
    name: "พ.ค.26",
    rows: [
      ["ลำดับ", "เลขที่สัญญา", "รายชื่อ", "เบิกด่วน", "New", "Renew", "ผู้ขาย", "ตำแหน่ง", "สาขา"],
      [1, "CT26-0000001", "ลูกค้าสมมติ 1", false, true, false, "ผู้ขายสมมติ ก", "Sale", "สาทร"],
      [2, "CT25-0000002", "ลูกค้าสมมติ 2", false, false, true, "ผู้ขายสมมติ ข", "AM", "สาทร"],
    ],
  },
]);

const INPUT: RegistrySheetInput[] = [
  { sheet: "สาทร", branch: "สาทร", grid: SATHORN },
  { sheet: "ปทุมวัน", branch: "ปทุมวัน", grid: PATHUMWAN },
];
const MONTH = "2026-10";

describe("planRegistryImport", () => {
  const plan = planRegistryImport(INPUT, { rules: TIER_RULES, month: MONTH, sellerIndex: SELLERS });
  const sathorn = plan.branches.find((b) => b.branch === "สาทร")!;
  const pathumwan = plan.branches.find((b) => b.branch === "ปทุมวัน")!;

  it("แผน = dry-run strict ทุกสาขา: จำนวนสัญญา · แถวที่กันไว้ · ยอดเดือนที่คาด", () => {
    for (const input of INPUT) {
      const holds = plan.branches.find((b) => b.branch === input.branch)!.heldRows;
      const dry = dryRunRegistrySheet(input.sheet, input.grid, {
        rules: TIER_RULES,
        months: [MONTH],
        sellerIndex: SELLERS,
        branch: input.branch,
        holdRows: holds,
        ...REGISTRY_IMPORT_OPTIONS,
      });
      const b = plan.branches.find((x) => x.branch === input.branch)!;
      expect(b.contracts.length, input.branch).toBe(dry.strict.ready);
      expect(b.mustFixRows, input.branch).toEqual(dry.strictProblems.map((p) => p.excelRow).sort((x, y) => x - y));
      expect(b.expected, input.branch).toEqual(dry.snapshots[MONTH]!.strict);
      expect(b.sellers, input.branch).toEqual({ saleName: dry.sellers!.saleName, amName: dry.sellers!.amName });
    }
  });

  it("ง1: เลขสัญญาซ้ำข้ามสาขาไม่เข้าแผนทั้งคู่ (คำนวณเองจากทุกชีทที่ส่งมา)", () => {
    expect(sathorn.heldRows).toEqual([{ excelRow: 9, reason: DUPLICATE_ACROSS_BRANCH_REASON }]);
    expect(pathumwan.heldRows).toEqual([{ excelRow: 6, reason: DUPLICATE_ACROSS_BRANCH_REASON }]);
    const nos = plan.branches.flatMap((b) => b.contracts.map((c) => c.contractNo));
    expect(nos).not.toContain("CT26-0000099");
  });

  it("แถวกรอกมือไม่เข้าแผน (เลขผิดรูปมีมูลค่า · ระยะสัญญาไม่ตรง)", () => {
    expect(sathorn.mustFixRows).toEqual([10, 11]);
    expect(sathorn.contracts.map((c) => c.excelRow)).toEqual([6, 7, 8, 12, 13]);
  });

  it("แปลงค่าเป็นช่องของตาราง: ระยะเดือน · มูลค่า · New/Renew · ผู้ขาย · ทีม · ประเภท", () => {
    const [c1, c2, c3, c7, c8] = sathorn.contracts;
    expect(c1).toMatchObject({
      contractNo: "CT26-0000001", startDate: "2026-01-15", endDate: "2027-01-14", termMonths: 12, valueTotal: 15000,
      saleType: "new", saleName: "ผู้ขายสมมติ ก", amName: null, isUrgent: false, teamCodes: ["A"], customerTypeLabel: "บ้านเดี่ยว",
    });
    expect(c2).toMatchObject({ termMonths: 36, valueTotal: 150000, saleType: "renew", saleName: null, amName: "ผู้ขายสมมติ ข", teamCodes: ["B", "C"] });
    expect(c3).toMatchObject({ startDate: "2026-03-01", endDate: "2027-02-28", customerTypeLabel: "อื่นๆ (ระบุในหมายเหตุ)" });
    expect(c7).toMatchObject({ saleType: null, customerTypeLabel: "คอนโด / อพาร์ตเมนต์ / หอพัก" });
    expect(c8).toMatchObject({ termMonths: 5, teamCodes: [] });
    expect(pathumwan.contracts[0]).toMatchObject({ customerTypeLabel: "ออฟฟิต" });
  });

  it("ยอดที่คาดของเดือน: นับเฉพาะสัญญาที่ครอบคลุมเดือน (หมดก่อน ต.ค. ไม่นับ)", () => {
    expect(sathorn.expected.cust).toBe(3);
    expect(sathorn.expected.value).toBe(15000 + 150000 + 60000); // 5 เดือน พ.ค.–ก.ย. ไม่ครอบ ต.ค.
    expect(plan.totals).toEqual({ contracts: 6, held: 2, mustFix: 2 });
  });

  it("ไม่มีชื่อลูกค้า/เบอร์ใน heldRows / mustFixRows / totals (PDPA)", () => {
    const text = JSON.stringify({ h: plan.branches.map((b) => [b.heldRows, b.mustFixRows, b.expected]), t: plan.totals });
    expect(text).not.toContain("ลูกค้าสมมติ");
    expect(text).not.toContain("ผู้ขายสมมติ");
  });

  it("สาขาเดียวกันส่งมา 2 ครั้ง = หยุด", () => {
    expect(() => planRegistryImport([INPUT[0]!, INPUT[0]!], { rules: TIER_RULES, month: MONTH })).toThrow(/ซ้ำ/);
  });

  it("มูลค่าที่ทศนิยมเกิน 2 ตำแหน่ง = หยุด (ไม่ปัดเงียบ)", () => {
    const grid = sheet([[1, "ลูกค้าสมมติ", "", "CT26-0000001", "", 4, serial("2026-01-15"), serial("2027-01-14"), 15000.125, null, "H", true, false, "A"]]);
    expect(() => planRegistryImport([{ sheet: "สาทร", branch: "สาทร", grid }], { rules: TIER_RULES, month: MONTH })).toThrow(/ทศนิยม/);
  });

  it("เดือนผิดรูป = หยุด", () => {
    expect(() => planRegistryImport(INPUT, { rules: TIER_RULES, month: "OCT.26" })).toThrow();
  });
});
