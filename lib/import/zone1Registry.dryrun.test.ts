/**
 * ทดลองนำเข้าทะเบียนเขต 1 (OCT.26) จากไฟล์จริง — dry-run ไม่เขียนฐานข้อมูล (phase 6 · SPEC §15 ข้อ 1 · DECISIONS 2.70)
 *
 * - ไฟล์จริงอยู่ใน fixtures/ (ไม่ commit · มีข้อมูลลูกค้า) → ไม่เจอไฟล์ = skip เอง (CI ไม่มีไฟล์)
 * - ตำแหน่งไฟล์: env AGA_FIXTURES_DIR หรือ <repo>/fixtures
 * - โหมดนำเข้าจริง (strict): แปลงประเภทลูกค้าตามตาราง · ผู้ขายจับคู่จากไฟล์เปิดงาน (ไม่เจอ = ว่าง)
 *   · แถวที่ไม่ผ่าน = ไม่นำเข้า → รายการกรอกมือ (2.70 · แถว 242 นำเข้าตามปกติ)
 *   · ผู้ขายลง sale_name / am_name ตามตำแหน่ง (AM → am_name · อื่นๆ → sale_name)
 *   · ไฟล์เปิดงาน 2 ปี: 2569 (มาก่อน) + 2568 (ถ้ามีไฟล์) · ชื่อต่างกัน → ใช้ปีล่าสุด (mergeSellerIndexes)
 * - env (ไม่บังคับ · เขียนไฟล์นอก repo หรือ docs/ ก็ได้ เพราะมีแค่ตัวเลข + เลขแถว):
 *     AGA_DRYRUN_OUT=<path>.json        ผลสรุป dry-run
 *     AGA_MANUAL_OUT=<path>.md          รายการแถวที่ต้องกรอกมือ
 *     AGA_TYPEMAP_OUT=<path>.md         ตารางแปลงประเภทลูกค้า
 * - ผลตัดสินเจ้าของ 18 พ.ย. 2026: ใช้ REGISTRY_IMPORT_OPTIONS เหมือน 21 สาขา (ก1 ข3 ค1 ไม่กระทบเขต 1)
 *   + ง1 เลขสัญญาซ้ำข้ามสาขา: สาขาตอบแล้ว (DECISIONS 2.80) → พุทธมณฑล แถว 225 ใช้เลขตามไฟล์ · สุวินทวงศ์ แถว 77 แก้เลข
 *     ผ่านตาราง centralRegistryCorrections.ts → ไม่มีแถวกัน · นำเข้า 332/347 · กรอกมือ 15
 *   → ต้องมีไฟล์ทะเบียนส่วนกลางครบ 8 ไฟล์ (หาคู่ซ้ำข้ามไฟล์) · ไม่ครบ = skip
 * - ⚠ assert เฉพาะจำนวน/เลขแถว ห้าม toEqual กับค่าที่มีชื่อ (diff ของ vitest จะพิมพ์ชื่อออกมา)
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { hasAllCentralFiles, loadCentralRegistry } from "./centralRegistry.testkit";
import { REGISTRY_IMPORT_OPTIONS } from "./centralRegistrySheets";
import { dryRunRegistrySheet, type BranchDryRun } from "./registryDryRun";
import { renderCustomerTypeMappingTable, renderManualEntryMarkdown } from "./registryReport";
import { buildSellerIndex, mergeSellerIndexes } from "./sellerLookup";
import { readXlsx } from "./xlsx/readXlsx";

const FIXTURES_DIR = process.env.AGA_FIXTURES_DIR ?? resolve(process.cwd(), "fixtures");
const ZONE1_NAME = "OCT.26_เขต 1 ปี 2026 (พุทธมณฑล, นครปฐม, หัวหิน).xlsx";
const ZONE1_FILE = join(FIXTURES_DIR, ZONE1_NAME);
const JOB_FILE = join(FIXTURES_DIR, "รายชื่อลูกค้าเปิดงาน ปี2569.xlsx");
const JOB_FILE_2568 = join(FIXTURES_DIR, "รายชื่อลูกค้าเปิดงาน ปี2568.xlsx");
const MONTHS = ["2026-09", "2026-10"];

/** แถวที่ไม่ผ่าน strict ตามรายงาน dry-run รอบแรก (docs/ผลทดลองนำเข้าเขต1-OCT26.md หัวข้อ 5) = รายการกรอกมือ 15 แถว (2.70) */
const EXPECTED_MUSTFIX: Record<string, number[]> = {
  พุทธมณฑล: [13, 14, 75, 80, 85, 103, 223, 224, 228, 235],
  นครปฐม: [],
  หัวหิน: [8, 43, 49, 52, 60],
};

const HAS_FILES = existsSync(ZONE1_FILE) && existsSync(JOB_FILE) && hasAllCentralFiles(FIXTURES_DIR);

describe.skipIf(!HAS_FILES)("dry-run ทะเบียนเขต 1 OCT.26 (ไฟล์จริง)", () => {
  const central = HAS_FILES ? loadCentralRegistry(FIXTURES_DIR) : null;
  const sheets = central ? central.sheets.filter((s) => s.spec.zone === "เขต 1") : [];
  const sellerIndex = HAS_FILES
    ? mergeSellerIndexes([
        { label: "2569", index: buildSellerIndex(readXlsx(JOB_FILE)) },
        ...(existsSync(JOB_FILE_2568) ? [{ label: "2568", index: buildSellerIndex(readXlsx(JOB_FILE_2568)) }] : []),
      ])
    : undefined;
  const results: BranchDryRun[] = sheets.map((s) =>
    dryRunRegistrySheet(s.sheet, s.grid, {
      rules: TIER_RULES,
      months: MONTHS,
      sellerIndex,
      branch: s.branch,
      holdRows: central!.holds.get(s.branch),
      excludeRows: s.excludeRows,
      ...REGISTRY_IMPORT_OPTIONS,
    }),
  );
  const byBranch = (rs: BranchDryRun[], b: string) => rs.find((r) => r.branch === b)!;

  it("อ่านได้ครบ 3 สาขาของเขต 1", () => {
    expect(results.map((r) => r.branch).sort()).toEqual(["นครปฐม", "พุทธมณฑล", "หัวหิน"].sort());
    results.forEach((r) => expect(r.area).toBe("เขต 1"));
  });

  it("ทุกแถวสัญญาถูกจัดกลุ่ม (ready + กันไว้ + mustFix) ไม่มีแถวหาย · ก1/ค1 ไม่กระทบเขต 1", () => {
    for (const r of results) {
      expect(r.contractRows).toBeGreaterThan(0);
      expect(r.dateFromRangeTextRows).toEqual([]);
      expect(r.malformedContractRows).toEqual([]);
      expect(r.strict.ready + r.strict.held.length + r.strict.excluded.length + r.strict.mustFix).toBe(r.contractRows);
      expect(r.lenient.ready + r.lenient.mustFix).toBe(r.contractRows);
      expect(r.strict.ready + r.strict.held.length + r.strict.excluded.length + r.strict.mustFix + r.strict.skipped).toBe(r.dataRows);
    }
  });

  it("2.80: พุทธมณฑล แถว 225 นำเข้าตามไฟล์ (คู่ซ้ำที่สุวินทวงศ์แก้เลขแล้ว) · ไม่มีแถวกันในเขต 1", () => {
    for (const r of results) expect(r.heldRows, r.branch).toEqual([]);
    expect(central!.holds.size).toBe(0);
    expect(byBranch(results, "พุทธมณฑล").strictProblems.map((p) => p.excelRow)).not.toContain(225);
  });

  it("ข3: ประเภทว่างในเขต 1 มีแถวเดียว (หัวหิน 49) ซึ่งอยู่ในรายการกรอกมือแล้ว → ผลไม่เปลี่ยน", () => {
    expect(results.flatMap((r) => r.blankTypeFilledRows.map((row) => `${r.branch}:${row}`))).toEqual(["หัวหิน:49"]);
  });

  it("แถวที่ไม่ผ่าน strict ตรงกับ 15 แถวของ 2.70 ทุกแถว (= กรอกมือ 15 · 2.80) · แถว 242 นำเข้าตามปกติ", () => {
    for (const r of results) {
      expect(r.strictProblems.map((p) => p.excelRow)).toEqual(EXPECTED_MUSTFIX[r.branch]);
    }
    expect(byBranch(results, "พุทธมณฑล").strictProblems.map((p) => p.excelRow)).not.toContain(242);
  });

  it("นำเข้า 332 / 347 แถว (2.80) · ยอด OCT.26 strict = lenient = รอบแรก ทุกสาขา", () => {
    expect(results.reduce((n, r) => n + r.strict.ready, 0)).toBe(332);
    expect(results.reduce((n, r) => n + r.contractRows, 0)).toBe(347);
    const oct = (rs: BranchDryRun[], b: string) => byBranch(rs, b).snapshots["2026-10"]!.lenient;
    expect(oct(results, "นครปฐม")).toMatchObject({ cust: 31 });
    expect(oct(results, "นครปฐม").value).toBeCloseTo(1_972_860.07, 2);
    expect(oct(results, "หัวหิน")).toMatchObject({ cust: 71 });
    expect(oct(results, "หัวหิน").value).toBeCloseTo(5_450_904.16, 2);
    expect(oct(results, "พุทธมณฑล")).toMatchObject({ cust: 230 });
    expect(oct(results, "พุทธมณฑล").value).toBeCloseTo(14_496_636.86, 2);
    // strict (นำเข้าจริง) = lenient ทุกสาขา (ไม่มีแถวกันแล้ว · 2.80)
    for (const b of ["นครปฐม", "หัวหิน", "พุทธมณฑล"]) {
      expect(byBranch(results, b).snapshots["2026-10"]!.strict).toMatchObject({ cust: oct(results, b).cust, value: oct(results, b).value });
    }
  });

  it("snapshot ภายในสอดคล้องกัน (cust = ผลรวมจำนวน tier · value = ผลรวมมูลค่า tier)", () => {
    for (const r of results) {
      for (const m of MONTHS) {
        for (const row of [r.snapshots[m]!.strict, r.snapshots[m]!.lenient]) {
          const counts = row.s1 + row.s3 + row.m1 + row.m3 + row.l1 + row.l3 + row.xl1 + row.xl3;
          expect(row.cust).toBe(counts);
          expect(row.value).toBeCloseTo(row.vS + row.vM + row.vL + row.vXL, 2);
        }
      }
    }
  });

  it("จับคู่ผู้ขายครบทุกแถวที่นำเข้า (matched + blank + conflict + notFound = ready)", () => {
    for (const r of results) {
      const s = r.sellers!;
      expect(s.matched + s.blank + s.conflict + s.noSellerColumn + s.notFound).toBe(r.strict.ready);
      expect(Object.values(s.matchedBySource).reduce((a, b) => a + b, 0)).toBe(s.matched);
      // ทุกแถวที่จับคู่ได้มีชื่อ → ลงช่องใดช่องหนึ่งพอดี
      expect(s.saleName + s.amName).toBe(s.matched);
      expect(s.amName).toBe(s.matchedByPosition["AM"] ?? 0);
    }
  });

  it("พบบล็อกสรุปท้ายชีททุกสาขา (ใช้เป็นตัวเทียบแหล่งเดียวกัน)", () => {
    for (const r of results) expect(r.inSheetSummary).not.toBeNull();
  });

  it("เขียนผลสรุป/รายการกรอกมือ/ตารางแปลง (ถ้าตั้ง env)", () => {
    const out = process.env.AGA_DRYRUN_OUT;
    if (out) {
      const index = sellerIndex
        ? {
            contracts: sellerIndex.contracts,
            sheetsRead: sellerIndex.sheetsRead,
            sheetsWithoutSeller: sellerIndex.sheetsWithoutSeller,
            sheetsSkipped: sellerIndex.sheetsSkipped,
            crossSourceConflicts: sellerIndex.crossSourceConflicts.size,
          }
        : null;
      writeFileSync(out, JSON.stringify({ sellerIndex: index, results }, null, 2), "utf8");
    }
    const manual = process.env.AGA_MANUAL_OUT;
    if (manual) {
      writeFileSync(
        manual,
        renderManualEntryMarkdown(results, {
          title: "รายการแถวที่ต้องกรอกมือ — ทะเบียนเขต 1 (OCT.26)",
          sourceFile: ZONE1_NAME,
          generatedOn: new Date().toISOString().slice(0, 10),
        }) + "\n",
        "utf8",
      );
    }
    const typemap = process.env.AGA_TYPEMAP_OUT;
    if (typemap) writeFileSync(typemap, renderCustomerTypeMappingTable(results) + "\n", "utf8");
    expect(true).toBe(true);
  });
});
