/**
 * แผนนำเข้าทะเบียนส่วนกลาง OCT.26 ทั้ง 24 สาขาจากไฟล์จริง — ต้องตรงกับ dry-run ทุกสาขา (ไม่เขียนฐานข้อมูล)
 *
 * - ไฟล์จริงอยู่ใน fixtures/ (ไม่ commit · มีข้อมูลลูกค้า) → ไม่ครบ = skip เอง (CI ไม่มีไฟล์)
 * - ตำแหน่งไฟล์: env AGA_FIXTURES_DIR หรือ <repo>/fixtures
 * - ⚠ assert เฉพาะจำนวน/เลขแถว/ยอดเงิน ห้าม toEqual กับค่าที่มาจากแถวลูกค้า (diff ของ vitest จะพิมพ์ชื่อออกมา)
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { JOB_OPENING_FILES, hasAllCentralFiles, loadCentralRegistry, loadSellerIndex } from "./centralRegistryFiles";
import { REGISTRY_IMPORT_OPTIONS } from "./centralRegistrySheets";
import { dryRunRegistrySheet } from "./registryDryRun";
import { planRegistryImport, type RegistryImportPlan } from "./registryImportPlan";

const FIXTURES_DIR = process.env.AGA_FIXTURES_DIR ?? resolve(process.cwd(), "fixtures");
const OCT = "2026-10";
const HAS_FILES = hasAllCentralFiles(FIXTURES_DIR) && JOB_OPENING_FILES.every((f) => existsSync(join(FIXTURES_DIR, f.file)));

describe.skipIf(!HAS_FILES)("แผนนำเข้าทะเบียนส่วนกลาง OCT.26 · 24 สาขา (ไฟล์จริง)", () => {
  const central = HAS_FILES ? loadCentralRegistry(FIXTURES_DIR) : { sheets: [], skipped: [], holds: new Map() };
  const sellerIndex = HAS_FILES ? loadSellerIndex(FIXTURES_DIR) : undefined;
  const plan: RegistryImportPlan = HAS_FILES
    ? planRegistryImport(
        central.sheets.map((s) => ({ sheet: s.sheet, branch: s.branch, grid: s.grid })),
        { rules: TIER_RULES, month: OCT, sellerIndex },
      )
    : { month: OCT, branches: [], totals: { contracts: 0, held: 0, mustFix: 0 } };

  it("ทุกสาขา: แผน = dry-run strict (จำนวน · แถวกรอกมือ · แถวที่กันไว้ · ยอด OCT.26 · ผู้ขาย)", () => {
    expect(plan.branches).toHaveLength(24);
    for (const s of central.sheets) {
      const dry = dryRunRegistrySheet(s.sheet, s.grid, {
        rules: TIER_RULES,
        months: [OCT],
        sellerIndex,
        branch: s.branch,
        holdRows: central.holds.get(s.branch),
        ...REGISTRY_IMPORT_OPTIONS,
      });
      const b = plan.branches.find((x) => x.branch === s.branch)!;
      expect(b.contracts.length, s.branch).toBe(dry.strict.ready);
      expect(b.mustFixRows.length, s.branch).toBe(dry.strict.mustFix);
      expect(b.heldRows.map((h) => h.excelRow), s.branch).toEqual(dry.heldRows.map((h) => h.excelRow));
      const exp = dry.snapshots[OCT]!.strict;
      for (const k of ["s1", "s3", "m1", "m3", "l1", "l3", "xl1", "xl3", "cust"] as const) expect(b.expected[k], `${s.branch} ${k}`).toBe(exp[k]);
      for (const k of ["vS", "vM", "vL", "vXL", "value"] as const) {
        expect(Math.round(b.expected[k] * 100), `${s.branch} ${k}`).toBe(Math.round(exp[k] * 100));
      }
      expect(b.sellers.saleName, s.branch).toBe(dry.sellers!.saleName);
      expect(b.sellers.amName, s.branch).toBe(dry.sellers!.amName);
    }
  });

  it("ตัวเลขรวมตามรายงาน dry-run: นำเข้า 2,367 · กรอกมือ 123 (ต้องแก้ 121 + กันไว้ 2) · sale_name 512 · am_name 573", () => {
    expect(plan.totals.contracts).toBe(2367);
    expect(plan.totals.held).toBe(2);
    expect(plan.totals.mustFix + plan.totals.held).toBe(123);
    const sum = (f: (b: RegistryImportPlan["branches"][number]) => number) => plan.branches.reduce((n, b) => n + f(b), 0);
    expect(sum((b) => b.sellers.saleName)).toBe(512);
    expect(sum((b) => b.sellers.amName)).toBe(573);
  });

  it("ยอด OCT.26 ที่รายงานไว้: พุทธมณฑล 229 / 14,472,707.38 · นครปฐม 31 / 1,972,860.07 · หัวหิน 71 / 5,450,904.16", () => {
    const of = (n: string) => plan.branches.find((b) => b.branch === n)!.expected;
    expect([of("พุทธมณฑล").cust, Math.round(of("พุทธมณฑล").value * 100)]).toEqual([229, 1447270738]);
    expect([of("นครปฐม").cust, Math.round(of("นครปฐม").value * 100)]).toEqual([31, 197286007]);
    expect([of("หัวหิน").cust, Math.round(of("หัวหิน").value * 100)]).toEqual([71, 545090416]);
  });

  it("ข้อมูลสำหรับรายงาน (จำนวนเท่านั้น): ชื่อว่าง · ชื่อซ้ำในสาขา · New/Renew/ว่าง · ทีม · หมดก่อน ต.ค.", () => {
    const all = plan.branches.flatMap((b) => b.contracts);
    const placeholder = plan.branches.reduce((n, b) => n + b.placeholderNames, 0);
    const dupGroups = plan.branches.reduce((n, b) => n + b.sameNameGroups.groups, 0);
    const dupRows = plan.branches.reduce((n, b) => n + b.sameNameGroups.rows, 0);
    expect(placeholder).toBe(0);
    expect([dupGroups, dupRows]).toEqual([75, 168]);
    expect(all.filter((c) => c.saleType === "new").length).toBe(944);
    expect(all.filter((c) => c.saleType === "renew").length).toBe(838);
    expect(all.filter((c) => c.saleType === null).length).toBe(585);
    expect(all.filter((c) => c.teamCodes.length > 0).length).toBe(2363);
    expect(plan.branches.reduce((n, b) => n + b.expected.cust, 0)).toBe(CUST_OCT_TOTAL);
    expect(plan.branches.reduce((n, b) => n + Math.round(b.expected.value * 100), 0)).toBe(VALUE_OCT_TOTAL_CENTS);
  });
});

/** จำนวนสัญญาที่นับใน OCT.26 รวม 24 สาขา (ตรวจจากผลจริงแล้ว · ส่วนต่างจาก 2,367 = สัญญาที่หมด/เริ่มนอก ต.ค.) */
const CUST_OCT_TOTAL = 2364;
/** มูลค่ารวม OCT.26 (สตางค์) */
const VALUE_OCT_TOTAL_CENTS = 13291221634; // 132,912,216.34 บาท
