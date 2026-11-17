/**
 * ทดลองนำเข้าทะเบียนส่วนกลาง OCT.26 อีก 21 สาขา (เขต 2–6, 9, 13) จากไฟล์จริง — dry-run ไม่เขียนฐานข้อมูล
 * (phase 6 · SPEC §15 · DECISIONS 2.70 / 2.73 · ตารางชีท → สาขา: centralRegistrySheets.ts)
 *
 * - ไฟล์จริงอยู่ใน fixtures/ (ไม่ commit · มีข้อมูลลูกค้า) → ไม่ครบ = skip เอง (CI ไม่มีไฟล์)
 * - ตำแหน่งไฟล์: env AGA_FIXTURES_DIR หรือ <repo>/fixtures
 * - กฎเดียวกับเขต 1 (zone1Registry.dryrun.test.ts): strict = นำเข้าจริง · lenient = ตัดปัญหาประเภทลูกค้า/ทีมออก
 *   · ลพบุรีข้ามตาม SPEC §6.5 · ชีทไม่อยู่ในตาราง = throw
 * - แยกแถวที่ไม่ผ่าน strict เป็น 2 กลุ่ม (รายงานให้เจ้าของ):
 *     numeric  = ไม่ผ่าน lenient (วันที่/มูลค่า/ระยะสัญญา) → รายการกรอกมือ (แบบ 2.70)
 *     typeOnly = ไม่ผ่าน strict แต่ผ่าน lenient (ประเภทลูกค้าใหม่/ว่าง) → รอเจ้าของตัดสินตารางแปลง
 * - เทียบยอด OCT.26 กับบล็อกสรุปท้ายชีท + ผลรวมมูลค่าในช่องของแถว numeric (ใช้อธิบายส่วนต่าง)
 * - เลขที่สัญญาซ้ำข้ามสาขา (24 สาขารวมเขต 1) — contracts.contract_no เป็น UNIQUE ใน DB
 * - env (ไม่บังคับ): AGA_CENTRAL_DRYRUN_OUT=<path>.json (ตัวเลข + เลขแถวเท่านั้น · เขียนนอก repo)
 * - ⚠ assert เฉพาะจำนวน/เลขแถว ห้าม toEqual กับค่าที่มาจากแถวลูกค้า (diff ของ vitest จะพิมพ์ชื่อออกมา)
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { CENTRAL_REGISTRY_FILES_OCT26, resolveRegistrySheet } from "./centralRegistrySheets";
import { dryRunRegistrySheet, type BranchDryRun } from "./registryDryRun";
import { parseRegistrySheet, type CellValue } from "./registrySheet";
import { buildSellerIndex, mergeSellerIndexes } from "./sellerLookup";
import { readXlsx } from "./xlsx/readXlsx";

const FIXTURES_DIR = process.env.AGA_FIXTURES_DIR ?? resolve(process.cwd(), "fixtures");
const JOB_FILE = join(FIXTURES_DIR, "รายชื่อลูกค้าเปิดงาน ปี2569.xlsx");
const JOB_FILE_2568 = join(FIXTURES_DIR, "รายชื่อลูกค้าเปิดงาน ปี2568.xlsx");
const MONTHS = ["2026-09", "2026-10"];
const OCT = "2026-10";
const CONTRACT_LIKE = /^CT\d{2}-\d+$/;

const SPECS = CENTRAL_REGISTRY_FILES_OCT26;
const OTHER_ZONES = SPECS.filter((f) => f.zone !== "เขต 1");
const HAS_FILES = existsSync(JOB_FILE) && SPECS.every((f) => existsSync(join(FIXTURES_DIR, f.file)));

function contractNoOf(raw: Record<string, string>): string {
  return (raw["เลขที่สัญญา"] ?? "").replace(/\s+/g, "").toUpperCase();
}

function num(s: string | undefined): number {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

interface BranchExtra {
  file: string;
  zone: string;
  /** แถวที่ไม่ผ่าน lenient (วันที่/มูลค่า/ระยะ) → รายการกรอกมือ */
  numericRows: { excelRow: number; kinds: string[]; valueCell: number }[];
  /** แถวที่ไม่ผ่าน strict แต่ผ่าน lenient (ปัญหาประเภทลูกค้าอย่างเดียว) */
  typeOnlyRows: number[];
  /** แถวรูปเลขสัญญาที่อยู่ใต้บล็อกสรุปท้ายชีท */
  contractRowsBelowSummary: number[];
  /**
   * แถวเหนือบล็อกสรุปที่ช่องเลขที่สัญญาไม่ใช่รูป CTyy-… (ผิดรูป/ว่าง) แต่มีมูลค่า → importContracts ข้ามเงียบ (skipped)
   * แต่ Excel นับในบล็อกสรุป · รายงานเป็นรายการกรอกมือ
   */
  skippedWithValue: { excelRow: number; value: number; contractNoBlank: boolean }[];
  /** สัญญาที่ผ่านแต่สิ้นสุดก่อน OCT.26 (ระบบไม่นับ OCT · Excel ยังนับในบล็อกสรุป) — คิดจากผลแบบเปิดข้อเสนออ่านช่วงวันที่ */
  endedBeforeOct: { excelRow: number; value: number }[];
  /** ปี (yy) ในเลขสัญญา → จำนวน · ปีของวันเริ่ม → จำนวน (ใช้ดูว่าทะเบียนเป็นปีปัจจุบันไหม) */
  contractYears: Record<string, number>;
  startYears: Record<string, number>;
}

describe.skipIf(!HAS_FILES)("dry-run ทะเบียนส่วนกลาง OCT.26 อีก 21 สาขา (ไฟล์จริง)", () => {
  const sellerIndex = HAS_FILES
    ? mergeSellerIndexes([
        { label: "2569", index: buildSellerIndex(readXlsx(JOB_FILE)) },
        ...(existsSync(JOB_FILE_2568) ? [{ label: "2568", index: buildSellerIndex(readXlsx(JOB_FILE_2568)) }] : []),
      ])
    : undefined;

  const results: BranchDryRun[] = [];
  /** ผลแบบเปิด readDateRangeText (ข้อเสนอ) */
  const rangeResults = new Map<string, BranchDryRun>();
  const extras = new Map<string, BranchExtra>();
  const skipped: { file: string; sheet: string; reason: string }[] = [];
  /** เลขสัญญา → ที่อยู่ (สาขา + แถว) ทุกสาขา 24 สาขา (รวมเขต 1) */
  const contractPlaces = new Map<string, { branch: string; excelRow: number }[]>();

  for (const spec of HAS_FILES ? SPECS : []) {
    for (const sheet of readXlsx(join(FIXTURES_DIR, spec.file))) {
      const target = resolveRegistrySheet(spec, sheet.name); // ชีทไม่อยู่ในตาราง = throw
      if (target.kind === "skip") {
        skipped.push({ file: spec.file, sheet: sheet.name, reason: target.reason });
        continue;
      }
      const grid: CellValue[][] = sheet.rows;
      const parsed = parseRegistrySheet(grid, target.branch);
      for (const r of parsed.rows) {
        const no = contractNoOf(r.raw as Record<string, string>);
        if (!CONTRACT_LIKE.test(no)) continue;
        contractPlaces.set(no, [...(contractPlaces.get(no) ?? []), { branch: target.branch, excelRow: r.excelRow }]);
      }
      if (spec.zone === "เขต 1") continue; // เขต 1 ใช้แค่ตรวจเลขสัญญาซ้ำข้ามสาขา (ผลเขต 1 อยู่ใน zone1Registry.dryrun.test.ts)

      const res = dryRunRegistrySheet(sheet.name, grid, {
        rules: TIER_RULES,
        months: MONTHS,
        sellerIndex,
        branch: target.branch,
      });
      results.push(res);
      // ข้อเสนอ (ยังไม่ตัดสิน): อ่านวันที่จากข้อความช่วงวันที่ — คำนวณไว้ให้เจ้าของเห็นตัวเลขเท่านั้น
      rangeResults.set(
        target.branch,
        dryRunRegistrySheet(sheet.name, grid, {
          rules: TIER_RULES,
          months: MONTHS,
          sellerIndex,
          branch: target.branch,
          readDateRangeText: true,
        }),
      );

      const byRow = new Map(parsed.rows.map((r) => [r.excelRow, r.raw as Record<string, string>]));
      const lenientBad = new Map<number, string[]>();
      for (const [kind, slot] of Object.entries(res.lenient.errors)) {
        for (const row of slot.excelRows) lenientBad.set(row, [...(lenientBad.get(row) ?? []), kind]);
      }
      const numericRows = [...lenientBad.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([excelRow, kinds]) => {
          const raw = byRow.get(excelRow) ?? {};
          return { excelRow, kinds, valueCell: num(raw["1 ปี"]) + num(raw["3 ปี"]) };
        });
      const typeOnlyRows = res.strictProblems.map((p) => p.excelRow).filter((row) => !lenientBad.has(row));

      const summaryRow = res.inSheetSummary?.excelRow ?? Infinity;
      const contractYears: Record<string, number> = {};
      const startYears: Record<string, number> = {};
      const contractRowsBelowSummary: number[] = [];
      const skippedWithValue: BranchExtra["skippedWithValue"] = [];
      for (const r of parsed.rows) {
        const raw = r.raw as Record<string, string>;
        const no = contractNoOf(raw);
        if (!CONTRACT_LIKE.test(no)) {
          const value = num(raw["1 ปี"]) + num(raw["3 ปี"]);
          if (r.excelRow < summaryRow && value > 0) skippedWithValue.push({ excelRow: r.excelRow, value, contractNoBlank: no === "" });
          continue;
        }
        if (r.excelRow > summaryRow) contractRowsBelowSummary.push(r.excelRow);
        const yy = no.slice(2, 4);
        contractYears[yy] = (contractYears[yy] ?? 0) + 1;
        const sy = /^(\d{4})-/.exec(raw["เริ่ม"] ?? "")?.[1] ?? "?";
        startYears[sy] = (startYears[sy] ?? 0) + 1;
      }
      extras.set(target.branch, {
        file: spec.file,
        zone: spec.zone,
        numericRows,
        typeOnlyRows,
        contractRowsBelowSummary,
        skippedWithValue,
        endedBeforeOct: rangeResults
          .get(target.branch)!
          .snapshots[OCT]!.notCounted.endedBefore.map((row) => {
            const raw = byRow.get(row) ?? {};
            return { excelRow: row, value: num(raw["1 ปี"]) + num(raw["3 ปี"]) };
          }),
        contractYears,
        startYears,
      });
    }
  }

  const crossBranchDuplicates = [...contractPlaces.values()]
    .filter((places) => places.length > 1)
    .map((places) => places);

  it("อ่านครบ 21 สาขาส่วนกลางนอกเขต 1 · ลพบุรีข้ามตาม SPEC §6.5", () => {
    expect(results).toHaveLength(21);
    const expected = OTHER_ZONES.flatMap((f) => Object.values(f.sheets).filter((t): t is string => typeof t === "string"));
    expect(results.map((r) => r.branch).sort()).toEqual(expected.sort());
    expect(skipped.map((s) => s.sheet)).toEqual(["ลพบุรี"]);
    for (const r of results) expect(r.area).toBe(extras.get(r.branch)!.zone);
  });

  it("ทุกแถวสัญญาถูกจัดกลุ่ม (ready + mustFix) ไม่มีแถวหาย · numeric + typeOnly = strict mustFix", () => {
    for (const r of results) {
      const x = extras.get(r.branch)!;
      expect(r.contractRows, r.branch).toBeGreaterThan(0);
      expect(r.strict.ready + r.strict.mustFix, r.branch).toBe(r.contractRows);
      expect(r.lenient.ready + r.lenient.mustFix, r.branch).toBe(r.contractRows);
      expect(r.strict.ready + r.strict.mustFix + r.strict.skipped, r.branch).toBe(r.dataRows);
      expect(x.numericRows.length, r.branch).toBe(r.lenient.mustFix);
      expect(x.numericRows.length + x.typeOnlyRows.length, r.branch).toBe(r.strict.mustFix);
    }
  });

  it("snapshot ภายในสอดคล้องกัน (cust = ผลรวมจำนวน tier · value = ผลรวมมูลค่า tier)", () => {
    for (const r of results) {
      for (const m of MONTHS) {
        for (const row of [r.snapshots[m]!.strict, r.snapshots[m]!.lenient]) {
          expect(row.cust).toBe(row.s1 + row.s3 + row.m1 + row.m3 + row.l1 + row.l3 + row.xl1 + row.xl3);
          expect(row.value).toBeCloseTo(row.vS + row.vM + row.vL + row.vXL, 2);
        }
      }
    }
  });

  it("พบบล็อกสรุปท้ายชีททุกสาขา", () => {
    for (const r of results) expect(r.inSheetSummary, r.branch).not.toBeNull();
  });

  it("จับคู่ผู้ขายครบทุกแถวที่นำเข้า (matched + blank + conflict + noSellerColumn + notFound = ready)", () => {
    for (const r of results) {
      const s = r.sellers!;
      expect(s.matched + s.blank + s.conflict + s.noSellerColumn + s.notFound, r.branch).toBe(r.strict.ready);
      expect(s.saleName + s.amName, r.branch).toBe(s.matched);
      expect(s.amName, r.branch).toBe(s.matchedByPosition["AM"] ?? 0);
    }
  });

  it("ค่าเริ่มต้นไม่อ่านข้อความช่วงวันที่ · เปิดข้อเสนอแล้วแถวนำเข้าเพิ่มขึ้นเท่านั้น (ไม่มีแถวที่เคยผ่านหลุด)", () => {
    for (const r of results) {
      const on = rangeResults.get(r.branch)!;
      expect(r.dateFromRangeTextRows, r.branch).toEqual([]);
      expect(on.contractRows, r.branch).toBe(r.contractRows);
      expect(on.lenient.ready - r.lenient.ready, r.branch).toBeLessThanOrEqual(on.dateFromRangeTextRows.length);
      expect(on.lenient.ready, r.branch).toBeGreaterThanOrEqual(r.lenient.ready);
      expect(on.strict.ready, r.branch).toBeGreaterThanOrEqual(r.strict.ready);
    }
  });

  it("ส่วนต่างกับบล็อกสรุปท้ายชีท อธิบายได้ครบทุกสาขา (แถวกรอกมือที่มีมูลค่า + แถวเลขสัญญาผิดรูป + สัญญาหมดก่อน ต.ค.)", () => {
    for (const r of results) {
      const x = extras.get(r.branch)!;
      const sum = r.inSheetSummary!;
      const skipped = x.skippedWithValue;
      const ended = x.endedBeforeOct;
      for (const [run, oct] of [
        ["default", r.snapshots[OCT]!.lenient],
        ["range", rangeResults.get(r.branch)!.snapshots[OCT]!.lenient],
      ] as const) {
        const runRes = run === "default" ? r : rangeResults.get(r.branch)!;
        const bad = new Set(Object.values(runRes.lenient.errors).flatMap((s) => s.excelRows));
        const numeric = x.numericRows.filter((n) => bad.has(n.excelRow));
        const explainedCount =
          numeric.filter((n) => n.valueCell > 0).length + skipped.length + ended.length;
        const explainedValue =
          numeric.reduce((a, n) => a + n.valueCell, 0) +
          skipped.reduce((a, s) => a + s.value, 0) +
          ended.reduce((a, e) => a + e.value, 0);
        expect(sum.totalCount - oct.cust, `${r.branch} ${run}`).toBe(explainedCount);
        expect(sum.totalValue - oct.value, `${r.branch} ${run}`).toBeCloseTo(explainedValue, 2);
      }
    }
  });

  it("ตัวเลขรวม 21 สาขา (กันถอยหลัง)", () => {
    const total = (f: (r: BranchDryRun) => number, rs: BranchDryRun[] = results) => rs.reduce((n, r) => n + f(r), 0);
    const ranged = [...rangeResults.values()];
    expect(total((r) => r.contractRows)).toBe(2139);
    expect(total((r) => r.strict.ready)).toBe(1661);
    expect(total((r) => r.lenient.ready)).toBe(1692);
    expect(total((r) => r.strict.ready, ranged)).toBe(2006);
    expect(total((r) => r.lenient.ready, ranged)).toBe(2037);
    expect(total((r) => r.dateFromRangeTextRows.length, ranged)).toBe(357);
    // เลขที่สัญญาซ้ำข้ามสาขา (24 สาขา) — contract_no UNIQUE ใน DB
    expect(crossBranchDuplicates.filter((g) => new Set(g.map((p) => p.branch)).size > 1)).toHaveLength(1);
  });

  it("เขียนผลสรุป (ถ้าตั้ง env)", () => {
    const out = process.env.AGA_CENTRAL_DRYRUN_OUT;
    if (out) {
      const branches = results.map((r) => {
        const x = extras.get(r.branch)!;
        const oct = r.snapshots[OCT]!;
        const on = rangeResults.get(r.branch)!;
        return {
          ...x,
          rangeScenario: {
            rangeRows: on.dateFromRangeTextRows,
            strictReady: on.strict.ready,
            lenientReady: on.lenient.ready,
            lenientMustFixRows: on.strictProblems
              .map((p) => p.excelRow)
              .filter((row) => Object.values(on.lenient.errors).some((s) => s.excelRows.includes(row))),
            lenientErrors: on.lenient.errors,
            strictErrors: on.strict.errors,
            octStrict: on.snapshots[OCT]!.strict,
            octLenient: on.snapshots[OCT]!.lenient,
            octNotCounted: on.snapshots[OCT]!.notCounted,
            sellers: on.sellers,
          },
          sheet: r.sheet,
          branch: r.branch,
          headerRows: r.headerRows,
          dataRows: r.dataRows,
          contractRows: r.contractRows,
          strictReady: r.strict.ready,
          strictMustFix: r.strict.mustFix,
          lenientReady: r.lenient.ready,
          lenientMustFix: r.lenient.mustFix,
          strictErrors: r.strict.errors,
          lenientErrors: r.lenient.errors,
          strictProblems: r.strictProblems,
          customerTypeValues: r.customerTypeValues,
          sellers: r.sellers,
          octStrict: oct.strict,
          octLenient: oct.lenient,
          octNotCounted: oct.notCounted,
          inSheetSummary: r.inSheetSummary,
          termMonths: r.termMonths,
          outliers: r.outliers,
          duplicateCounts: {
            samePhoneDifferentName: r.duplicates.samePhoneDifferentName.length,
            sameName: r.duplicates.sameName.length,
          },
        };
      });
      writeFileSync(out, JSON.stringify({ skipped, crossBranchDuplicates, branches }, null, 2), "utf8");
    }
    expect(true).toBe(true);
  });
});
