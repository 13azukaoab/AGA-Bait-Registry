/**
 * เทสตารางแก้เลขที่สัญญา (ข้อมูลสมมติ · รันได้ใน CI)
 */
import { describe, expect, it } from "vitest";
import { CENTRAL_REGISTRY_FILES_OCT26 } from "./centralRegistrySheets";
import {
  CONTRACT_EXCLUSIONS_OCT26,
  CONTRACT_NO_CORRECTIONS_OCT26,
  applyContractNoCorrections,
  assignContractExclusions,
  unusedCorrections,
  type ContractExclusion,
  type ContractNoCorrection,
} from "./centralRegistryCorrections";
import type { CellValue } from "./registrySheet";

const TOP: CellValue[] = [null, null, null, null, null, "Site plan", "ระยะสัญญา", null, "มูลค่าสัญญา", null, "ประเภทลูกค้า", "ประเภทสัญญา"];
const BOTTOM: CellValue[] = ["ลำดับ", "ชื่อลูกค้า", "ที่อยู่ลูกค้า", "เลขที่สัญญา", "เบอร์โทรลูกค้า", "IG", "เริ่ม", "สิ้นสุด", "1 ปี", "3 ปี", "H = บ้าน /T = ทาวน์โฮม/R=ห้อง", false, false, "ทีม"];
const GRID: CellValue[][] = [[], [], [], TOP, BOTTOM, [1, "สมมติ", "", " ct26-0000001 ", "", 4, null, null, 1000, null, "H", true, false, "A"]];
const FIX: ContractNoCorrection = { file: "f.xlsx", sheet: "สาทร", excelRow: 6, from: "CT26-0000001", to: "CT26-0000002", reason: "ทดสอบ" };

describe("applyContractNoCorrections", () => {
  it("แก้เลขในเซลล์ตามตาราง (ไม่แก้ grid เดิม) · ชีทอื่นไม่แตะ", () => {
    const res = applyContractNoCorrections("f.xlsx", "สาทร", GRID, [FIX]);
    expect(res.grid[5]![3]).toBe("CT26-0000002");
    expect(GRID[5]![3]).toBe(" ct26-0000001 ");
    expect(res.applied).toEqual([FIX]);
    expect(applyContractNoCorrections("f.xlsx", "ปทุมวัน", GRID, [FIX]).grid).toBe(GRID);
  });

  it("เลขในเซลล์ไม่ตรง from (ไฟล์เปลี่ยน/แถวเลื่อน) = หยุด", () => {
    expect(() => applyContractNoCorrections("f.xlsx", "สาทร", GRID, [{ ...FIX, excelRow: 5 }])).toThrow(/หยุด/);
    expect(() => applyContractNoCorrections("f.xlsx", "สาทร", GRID, [{ ...FIX, from: "CT26-0000009" }])).toThrow(/หยุด/);
  });

  it("รายการที่ไม่ถูกใช้ถูกรายงาน", () => {
    expect(unusedCorrections([], [FIX])).toEqual([FIX]);
    expect(unusedCorrections([FIX], [FIX])).toEqual([]);
  });

  it("ตารางจริง: ไฟล์ตรงตารางไฟล์ทะเบียน · เลขรูป CTyy-nnnnnnn · ไม่ซ้ำตำแหน่ง", () => {
    const files = new Set(CENTRAL_REGISTRY_FILES_OCT26.map((f) => f.file));
    for (const c of CONTRACT_NO_CORRECTIONS_OCT26) {
      expect(files.has(c.file)).toBe(true);
      expect(c.from).toMatch(/^CT\d{2}-\d{7}$/);
      expect(c.to).toMatch(/^CT\d{2}-\d{7}$/);
    }
    const keys = CONTRACT_NO_CORRECTIONS_OCT26.map((c) => `${c.file}|${c.sheet}|${c.excelRow}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("รายการเลขสัญญาที่ต้องตัดออก (2.103)", () => {
  const EX: ContractExclusion = { file: "f.xlsx", sheet: "สาทร", excelRow: 6, contractNo: "CT26-0000001", reason: "ทดสอบ (สมมติ)" };
  const SHEETS = [
    { file: "f.xlsx", sheet: "สาทร", branch: "สาทร" },
    { file: "f.xlsx", sheet: "ปทุมวัน", branch: "ปทุมวัน" },
  ];

  it("แจกรายการให้ชีทตามไฟล์ + ชีท (ส่งต่อเลขแถว/เลขสัญญา/เหตุผล)", () => {
    const m = assignContractExclusions(SHEETS, [EX]);
    expect(m.get("สาทร")).toEqual([{ excelRow: 6, contractNo: "CT26-0000001", reason: "ทดสอบ (สมมติ)" }]);
    expect(m.has("ปทุมวัน")).toBe(false);
  });

  it("รายการที่ไม่ตรงไฟล์/ชีทใด = หยุด (ไม่ข้ามเงียบ)", () => {
    expect(() => assignContractExclusions(SHEETS, [{ ...EX, file: "อื่น.xlsx" }])).toThrow(/หยุด/);
    expect(() => assignContractExclusions(SHEETS, [{ ...EX, sheet: "หัวหิน" }])).toThrow(/หยุด/);
  });

  it("รายการว่าง = ไม่ตัดอะไร", () => {
    expect(assignContractExclusions(SHEETS, []).size).toBe(0);
  });

  it("ตารางจริง: ไฟล์ตรงตารางไฟล์ทะเบียน · เลขรูป CTyy-nnnnnnn · มีเหตุผล · ไม่ซ้ำตำแหน่ง/เลข", () => {
    const files = new Set(CENTRAL_REGISTRY_FILES_OCT26.map((f) => f.file));
    for (const c of CONTRACT_EXCLUSIONS_OCT26) {
      expect(files.has(c.file)).toBe(true);
      expect(c.contractNo).toMatch(/^CT\d{2}-\d{7}$/);
      expect(c.reason.trim()).not.toBe("");
      expect(c.excelRow).toBeGreaterThan(0);
    }
    const keys = CONTRACT_EXCLUSIONS_OCT26.map((c) => `${c.file}|${c.sheet}|${c.excelRow}`);
    expect(new Set(keys).size).toBe(keys.length);
    const nos = CONTRACT_EXCLUSIONS_OCT26.map((c) => c.contractNo);
    expect(new Set(nos).size).toBe(nos.length);
  });
});
