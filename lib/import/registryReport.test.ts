/**
 * เทสตัวสร้าง "รายการให้สาขายืนยัน" + ตารางแปลงประเภทลูกค้า — ข้อมูลสมมติ (รันได้ใน CI)
 */
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { dryRunRegistrySheet } from "./registryDryRun";
import {
  buildConfirmationItems,
  customerTypeMappingRows,
  describeProblem,
  renderConfirmationMarkdown,
  renderCustomerTypeMappingTable,
} from "./registryReport";
import type { CellValue } from "./registrySheet";

function serial(iso: string): number {
  return (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

const TOP: CellValue[] = [null, null, null, null, null, "Site plan", "ระยะสัญญา", null, "มูลค่าสัญญา", null, "ประเภทลูกค้า", "ประเภทสัญญา"];
const BOTTOM: CellValue[] = ["ลำดับ", "ชื่อลูกค้า", "ที่อยู่ลูกค้า", "เลขที่สัญญา", "เบอร์โทรลูกค้า", "IG", "เริ่ม", "สิ้นสุด", "1 ปี", "3 ปี", "H = บ้าน /T = ทาวน์โฮม/R=ห้อง", false, false, "ทีม"];

// ข้อมูลสมมติ: แถว 4 ปกติ · 5 วันที่ไม่มีจริง · 6 ไม่มีมูลค่า · 7 ช่องมูลค่า 3 ปีแต่วันที่ 1 ปี · 8 มูลค่าสูง (จะกันไว้)
// แถว 9 ชื่อซ้ำกับแถว 4 · แถว 10 ไม่มีประเภท + เลขสัญญาสั้น
const GRID: CellValue[][] = [
  [],
  TOP,
  BOTTOM,
  [1, "ลูกค้าสมมติ ก", "ที่อยู่สมมติ", "CT26-0000001", "0800000001", 6, serial("2026-01-01"), serial("2026-12-31"), 20000, null, "H", true, false, "A"],
  [2, "ลูกค้าสมมติ ข", "", "CT26-0000002", "0800000002", 6, serial("2026-01-01"), "31/11/2026", 20000, null, "T", true, false, "A"],
  [3, "ลูกค้าสมมติ ค", "", "CT26-0000003", "0800000003", 6, serial("2026-01-01"), serial("2026-12-31"), null, null, "TH", true, false, "A"],
  [4, "ลูกค้าสมมติ ง", "", "CT26-0000004", "0800000004", 6, serial("2026-01-01"), serial("2026-12-31"), null, 60000, "H", true, false, "A"],
  [5, "ลูกค้าสมมติ จ", "", "CT26-0000005", "0800000005", 6, serial("2026-01-01"), serial("2026-12-31"), 2000000, null, "โรงาน", true, false, "A"],
  [6, "ลูกค้าสมมติ ก", "", "CT26-0000006", "0800000006", 6, serial("2026-02-01"), serial("2027-01-31"), 20000, null, "H", true, false, "A"],
  [7, "ลูกค้าสมมติ ฉ", "", "CT26-123", "0800000007", 6, serial("2026-01-01"), serial("2026-12-31"), 20000, null, null, true, false, "A"],
];

const result = dryRunRegistrySheet("พุทธมณฑล", GRID, {
  rules: TIER_RULES,
  months: ["2026-10"],
  holdRows: [{ excelRow: 8, reason: "มูลค่าสูงผิดปกติ (2,000,000 / 1 ปี)" }],
});

describe("describeProblem — ชนิดปัญหา → ข้อความให้สาขา", () => {
  it("วันที่/ระยะสัญญา/เลขสัญญา/มูลค่า/ประเภท มีคำถามเฉพาะ", () => {
    expect(describeProblem("วันสิ้นสุด: วันที่ไม่มีจริง (…)").ask).toMatch(/วันสิ้นสุด/);
    expect(describeProblem("วันเริ่มสัญญา: ปีผิดปกติ (…)").ask).toMatch(/วันเริ่ม/);
    expect(describeProblem("ระยะสัญญาไม่ใช่ 3 ปี (…)").problem).toMatch(/ช่องมูลค่า 3 ปี/);
    expect(describeProblem("เลขที่สัญญาไม่ครบ 7 หลัก (…)").ask).toMatch(/เลขที่สัญญา/);
    expect(describeProblem("ไม่มีมูลค่า").ask).toMatch(/มูลค่า/);
    expect(describeProblem("ไม่มีประเภทลูกค้า").ask).toMatch(/ประเภทลูกค้า/);
  });

  it("ชนิดที่ไม่รู้จัก → ใช้ข้อความเดิม (ตัด … ออก) + ขอให้ตรวจแถว", () => {
    const d = describeProblem('อะไรสักอย่าง "…" (…)');
    expect(d.problem).toBe("อะไรสักอย่าง");
    expect(d.ask).toMatch(/ตรวจ/);
  });
});

describe("buildConfirmationItems", () => {
  const items = buildConfirmationItems([result]);

  it("รวมแถวที่ไม่ผ่าน + แถวที่กันไว้ เรียงตามเลขแถว", () => {
    expect(items.map((i) => i.excelRow)).toEqual([5, 6, 7, 8, 10]);
    expect(items.every((i) => i.branch === "พุทธมณฑล")).toBe(true);
  });

  it("แถวที่กันไว้ใช้เหตุผลที่สั่ง + ขอให้ยืนยันมูลค่า", () => {
    const held = items.find((i) => i.excelRow === 8)!;
    expect(held.problems).toEqual(["มูลค่าสูงผิดปกติ (2,000,000 / 1 ปี)"]);
    expect(held.asks.join(" ")).toMatch(/ยืนยัน/);
  });

  it("แถวที่มีหลายปัญหา รวมคำถามไม่ซ้ำ", () => {
    const r10 = items.find((i) => i.excelRow === 10)!;
    expect(r10.problems.length).toBe(2);
    expect(new Set(r10.asks).size).toBe(r10.asks.length);
  });
});

describe("renderConfirmationMarkdown", () => {
  const md = renderConfirmationMarkdown([result], { title: "ทดสอบ", sourceFile: "ไฟล์สมมติ.xlsx", generatedOn: "17 พ.ย. 2026" });

  it("มีหัวข้อสาขา ตารางแถว และหัวข้อลูกค้าซ้ำ (เลขแถวเท่านั้น)", () => {
    expect(md).toContain("## พุทธมณฑล");
    expect(md).toMatch(/\| 5 \|/);
    expect(md).toContain("ลูกค้าซ้ำ");
    expect(md).toContain("4, 9");
  });

  it("ไม่มีชื่อ เบอร์ ที่อยู่ หรือเลขที่สัญญาลูกค้า", () => {
    expect(md).not.toMatch(/ลูกค้าสมมติ|080000000|ที่อยู่สมมติ|CT26-/);
  });
});

describe("ตารางแปลงประเภทลูกค้า (สร้างจาก CUSTOMER_TYPE_MAPPINGS + จำนวนจริง)", () => {
  it("แสดงเฉพาะกฎที่มีแถวโดน + รหัสทะเบียนทุกตัว (แม้ 0 แถว) · นับแยกสาขา", () => {
    const rows = customerTypeMappingRows([result]);
    const byFrom = Object.fromEntries(rows.map((r) => [r.from, r]));
    expect(byFrom["H"]).toMatchObject({ to: "บ้านเดี่ยว", total: 3, counts: { พุทธมณฑล: 3 } });
    expect(byFrom["TH"]).toMatchObject({ total: 1 });
    expect(byFrom["R"]).toMatchObject({ total: 0 });
    expect(byFrom["โรงาน"]).toMatchObject({ to: "โรงงาน", total: 1 });
    expect(byFrom["ศาลเจ้า"]).toMatchObject({ source: "proposed", total: 0 });
    expect(byFrom["บ้าน"]).toBeUndefined(); // legacy ที่ไม่มีแถวโดน ไม่ต้องแสดง
  });

  it("render เป็นตาราง markdown", () => {
    const md = renderCustomerTypeMappingTable([result]);
    expect(md).toContain("| `H` | บ้านเดี่ยว |");
  });
});
