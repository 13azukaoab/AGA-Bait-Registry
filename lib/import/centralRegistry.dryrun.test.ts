/**
 * ทดลองนำเข้าทะเบียนส่วนกลาง OCT.26 อีก 21 สาขา (เขต 2–6, 9, 13) จากไฟล์จริง — dry-run ไม่เขียนฐานข้อมูล
 * (phase 6 · SPEC §15 · DECISIONS 2.70 / 2.73 · ผลตัดสินเจ้าของ 18 พ.ย. 2026: ก1 ข1 ข3 ค1 ง1 จ1)
 *
 * - ไฟล์จริงอยู่ใน fixtures/ (ไม่ commit · มีข้อมูลลูกค้า) → ไม่ครบ = skip เอง (CI ไม่มีไฟล์)
 * - ตำแหน่งไฟล์: env AGA_FIXTURES_DIR หรือ <repo>/fixtures
 * - ตัวเลือกนำเข้า = REGISTRY_IMPORT_OPTIONS (ก1 อ่านช่วงวันที่ข้อความ · ข3 ประเภทว่าง → อื่นๆ · ค1 เลขสัญญาผิดรูปมีมูลค่า = ต้องแก้)
 *   + holdRows = เลขสัญญาซ้ำข้ามสาขา (ง1) จากทั้ง 24 สาขา · ลพบุรีข้ามตาม SPEC §6.5 · ชีทไม่อยู่ในตาราง = throw
 * - strict = นำเข้าจริง · lenient = ตัดปัญหาประเภทลูกค้า/ทีมออก (แยก "สูตรผิด" ออกจาก "ข้อมูลไม่สะอาด")
 * - เทียบยอด OCT.26 (lenient) กับบล็อกสรุปท้ายชีท: ส่วนต่าง = แถวกรอกมือที่มีมูลค่า + สัญญาหมดก่อน ต.ค. (Excel นับทุกแถว)
 * - env (ไม่บังคับ): AGA_CENTRAL_DRYRUN_OUT=<path>.json (ตัวเลข + เลขแถวเท่านั้น · เขียนนอก repo)
 * - ⚠ assert เฉพาะจำนวน/เลขแถว ห้าม toEqual กับค่าที่มาจากแถวลูกค้า (diff ของ vitest จะพิมพ์ชื่อออกมา)
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { hasAllCentralFiles, loadCentralRegistry, type CentralRegistry } from "./centralRegistry.testkit";
import { REGISTRY_IMPORT_OPTIONS } from "./centralRegistrySheets";
import { DUPLICATE_ACROSS_BRANCH_REASON } from "./crossBranchDuplicates";
import { dryRunRegistrySheet, type BranchDryRun } from "./registryDryRun";
import { buildSellerIndex, mergeSellerIndexes } from "./sellerLookup";
import { readXlsx } from "./xlsx/readXlsx";

const FIXTURES_DIR = process.env.AGA_FIXTURES_DIR ?? resolve(process.cwd(), "fixtures");
const JOB_FILE = join(FIXTURES_DIR, "รายชื่อลูกค้าเปิดงาน ปี2569.xlsx");
const JOB_FILE_2568 = join(FIXTURES_DIR, "รายชื่อลูกค้าเปิดงาน ปี2568.xlsx");
const MONTHS = ["2026-09", "2026-10"];
const OCT = "2026-10";
const CONTRACT_LIKE = /^CT\d{2}-\d+$/;

const HAS_FILES = existsSync(JOB_FILE) && hasAllCentralFiles(FIXTURES_DIR);

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
  /** แถวที่ไม่ผ่าน lenient (วันที่/มูลค่า/ระยะ/เลขสัญญาผิดรูป) → รายการกรอกมือ */
  numericRows: { excelRow: number; kinds: string[]; valueCell: number }[];
  /** แถวที่ไม่ผ่าน strict แต่ผ่าน lenient (ปัญหาประเภทลูกค้าอย่างเดียว) — หลัง ข1/ข3 ควรว่าง */
  typeOnlyRows: number[];
  /** แถวเหนือบล็อกสรุปที่ระบบยัง "ข้าม" ทั้งที่มีมูลค่า — หลัง ค1 ควรว่าง */
  skippedWithValue: number[];
  /** แถวรูปเลขสัญญาที่อยู่ใต้บล็อกสรุปท้ายชีท */
  contractRowsBelowSummary: number[];
  /** สัญญาที่ผ่านแต่สิ้นสุดก่อน OCT.26 (ระบบไม่นับ · Excel ยังนับ · จ1) */
  endedBeforeOct: { excelRow: number; value: number }[];
  /** แถวที่กันไว้ (ง1) + มูลค่าในช่อง */
  heldValues: { excelRow: number; value: number }[];
}

describe.skipIf(!HAS_FILES)("dry-run ทะเบียนส่วนกลาง OCT.26 อีก 21 สาขา (ไฟล์จริง)", () => {
  const sellerIndex = HAS_FILES
    ? mergeSellerIndexes([
        { label: "2569", index: buildSellerIndex(readXlsx(JOB_FILE)) },
        ...(existsSync(JOB_FILE_2568) ? [{ label: "2568", index: buildSellerIndex(readXlsx(JOB_FILE_2568)) }] : []),
      ])
    : undefined;
  const central: CentralRegistry = HAS_FILES ? loadCentralRegistry(FIXTURES_DIR) : { sheets: [], skipped: [], holds: new Map() };

  const results: BranchDryRun[] = [];
  const extras = new Map<string, BranchExtra>();

  for (const s of central.sheets) {
    if (s.spec.zone === "เขต 1") continue; // ผลเขต 1 อยู่ใน zone1Registry.dryrun.test.ts
    const res = dryRunRegistrySheet(s.sheet, s.grid, {
      rules: TIER_RULES,
      months: MONTHS,
      sellerIndex,
      branch: s.branch,
      holdRows: central.holds.get(s.branch),
      ...REGISTRY_IMPORT_OPTIONS,
    });
    results.push(res);

    const byRow = new Map(s.parsed.rows.map((r) => [r.excelRow, r.raw as Record<string, string>]));
    const valueOf = (row: number) => {
      const raw = byRow.get(row) ?? {};
      return num(raw["1 ปี"]) + num(raw["3 ปี"]);
    };
    const lenientBad = new Map<number, string[]>();
    for (const [kind, slot] of Object.entries(res.lenient.errors)) {
      for (const row of slot.excelRows) lenientBad.set(row, [...(lenientBad.get(row) ?? []), kind]);
    }
    const summaryRow = res.inSheetSummary?.excelRow ?? Infinity;
    const problemRows = new Set(res.strictProblems.map((p) => p.excelRow));
    extras.set(s.branch, {
      file: s.spec.file,
      zone: s.spec.zone,
      numericRows: [...lenientBad.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([excelRow, kinds]) => ({ excelRow, kinds, valueCell: valueOf(excelRow) })),
      typeOnlyRows: [...problemRows].filter((row) => !lenientBad.has(row)),
      skippedWithValue: s.parsed.rows
        .filter((r) => r.excelRow < summaryRow && !CONTRACT_LIKE.test(contractNoOf(r.raw as Record<string, string>)))
        .filter((r) => valueOf(r.excelRow) > 0 && !problemRows.has(r.excelRow))
        .map((r) => r.excelRow),
      contractRowsBelowSummary: s.parsed.rows
        .filter((r) => r.excelRow > summaryRow && CONTRACT_LIKE.test(contractNoOf(r.raw as Record<string, string>)))
        .map((r) => r.excelRow),
      endedBeforeOct: res.snapshots[OCT]!.notCounted.endedBefore.map((row) => ({ excelRow: row, value: valueOf(row) })),
      heldValues: res.heldRows.map((h) => ({ excelRow: h.excelRow, value: valueOf(h.excelRow) })),
    });
  }

  it("อ่านครบ 21 สาขาส่วนกลางนอกเขต 1 · ลพบุรีข้ามตาม SPEC §6.5", () => {
    expect(results).toHaveLength(21);
    expect(central.skipped.map((s) => s.sheet)).toEqual(["ลพบุรี"]);
    for (const r of results) expect(r.area).toBe(extras.get(r.branch)!.zone);
  });

  it("ทุกแถวถูกจัดกลุ่ม ไม่มีแถวหาย (ready + กันไว้ + ต้องแก้ = แถวสัญญา + แถวเลขผิดรูป)", () => {
    for (const r of results) {
      const x = extras.get(r.branch)!;
      expect(r.strict.ready + r.strict.held.length + r.strict.mustFix, r.branch).toBe(r.contractRows + r.malformedContractRows.length);
      expect(r.lenient.ready + r.lenient.mustFix, r.branch).toBe(r.contractRows + r.malformedContractRows.length);
      expect(r.strict.ready + r.strict.held.length + r.strict.mustFix + r.strict.skipped, r.branch).toBe(r.dataRows);
      expect(x.skippedWithValue, r.branch).toEqual([]); // ค1: ไม่มีแถวมีมูลค่าถูกข้ามเงียบแล้ว
      expect(x.contractRowsBelowSummary, r.branch).toEqual([]);
    }
  });

  it("ข1/ข3: ไม่เหลือแถวที่ติดเฉพาะประเภทลูกค้า", () => {
    for (const r of results) expect(extras.get(r.branch)!.typeOnlyRows, r.branch).toEqual([]);
  });

  it("ง1: เลขสัญญาซ้ำข้ามสาขา — สุวินทวงศ์ แถว 77 ไม่นำเข้า (คู่กับพุทธมณฑล แถว 225 ในเขต 1)", () => {
    expect([...central.holds.keys()].sort()).toEqual(["พุทธมณฑล", "สุวินทวงศ์"].sort());
    expect(central.holds.get("พุทธมณฑล")!.map((h) => h.excelRow)).toEqual([225]);
    const suwin = results.find((r) => r.branch === "สุวินทวงศ์")!;
    expect(suwin.heldRows).toEqual([{ excelRow: 77, reason: DUPLICATE_ACROSS_BRANCH_REASON }]);
    for (const r of results.filter((x) => x.branch !== "สุวินทวงศ์")) expect(r.heldRows, r.branch).toEqual([]);
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

  it("ส่วนต่างกับบล็อกสรุปท้ายชีท อธิบายได้ครบทุกสาขา (แถวกรอกมือที่มีมูลค่า + สัญญาหมดก่อน ต.ค.)", () => {
    for (const r of results) {
      const x = extras.get(r.branch)!;
      const sum = r.inSheetSummary!;
      const oct = r.snapshots[OCT]!.lenient; // lenient ไม่โดน hold → เทียบสูตรล้วน
      const withValue = x.numericRows.filter((n) => n.valueCell > 0);
      expect(sum.totalCount - oct.cust, r.branch).toBe(withValue.length + x.endedBeforeOct.length);
      expect(sum.totalValue - oct.value, r.branch).toBeCloseTo(
        withValue.reduce((a, n) => a + n.valueCell, 0) + x.endedBeforeOct.reduce((a, e) => a + e.value, 0),
        2,
      );
    }
  });

  it("ตัวเลขรวม 21 สาขา (กันถอยหลัง)", () => {
    const total = (f: (r: BranchDryRun) => number) => results.reduce((n, r) => n + f(r), 0);
    expect(total((r) => r.contractRows)).toBe(2139);
    expect(total((r) => r.malformedContractRows.length)).toBe(4);
    expect(total((r) => r.dateFromRangeTextRows.length)).toBe(357);
    expect(total((r) => r.blankTypeFilledRows.length)).toBe(13);
    expect(total((r) => r.strict.ready)).toBe(EXPECTED_READY);
    expect(total((r) => r.strict.mustFix)).toBe(EXPECTED_MUSTFIX);
    expect(total((r) => r.strict.held.length)).toBe(1);
  });

  it("เขียนผลสรุป (ถ้าตั้ง env)", () => {
    const out = process.env.AGA_CENTRAL_DRYRUN_OUT;
    if (out) {
      const branches = results.map((r) => {
        const oct = r.snapshots[OCT]!;
        return {
          ...extras.get(r.branch)!,
          sheet: r.sheet,
          branch: r.branch,
          contractRows: r.contractRows,
          malformedContractRows: r.malformedContractRows,
          dateFromRangeTextRows: r.dateFromRangeTextRows,
          blankTypeFilledRows: r.blankTypeFilledRows,
          heldRows: r.heldRows,
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
        };
      });
      writeFileSync(out, JSON.stringify({ skipped: central.skipped, branches }, null, 2), "utf8");
    }
    expect(true).toBe(true);
  });
});

/** ตัวเลขหลังผลตัดสิน 18 พ.ย. (ตรวจจากผลจริงแล้ว) */
const EXPECTED_READY = 2036;
const EXPECTED_MUSTFIX = 106;
