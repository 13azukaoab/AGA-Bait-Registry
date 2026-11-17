/**
 * ทดลองนำเข้าทะเบียนรายสาขาแบบ dry-run (phase 6 · SPEC §15 ข้อ 1) — pure function ไม่เขียนฐานข้อมูล
 *
 * Logic summary:
 *   1. แต่ละชีท → parseRegistrySheet → importContracts 2 รอบ
 *      - strict  = ข้อมูลตามจริง (ผู้ขายใส่ค่าแทนเพราะทะเบียนไม่มีคอลัมน์นี้) → ใช้นับ "ปัญหาข้อมูล"
 *      - lenient = ตัดปัญหาที่ไม่กระทบตัวเลข (ประเภทลูกค้า, ทีม) ออก → เหลือเฉพาะปัญหาวันที่/มูลค่า/ระยะสัญญา
 *        ใช้แยก "สูตรผิด" ออกจาก "ข้อมูลไม่สะอาด" (ถ้า lenient ยังไม่ตรง = ต้องหาสาเหตุที่วันที่/มูลค่า/สูตร)
 *   2. สัญญาที่ผ่าน → buildBranchSnapshot (lib/rules) ของแต่ละเดือนที่ขอ (เกณฑ์ Tier ส่งเข้ามา ห้าม hardcode)
 *   3. รวบรวมปัญหาเป็น "จำนวน + เลขแถว Excel" เท่านั้น — ห้ามมีชื่อ/เบอร์/ที่อยู่ในผลลัพธ์ (PDPA)
 *      · ลูกค้าซ้ำ (2.59) ตรวจด้วยเบอร์โทร/ชื่อในหน่วยความจำ แล้วคืนแค่เลขแถว
 *   4. ไม่ตัดสินวิธีล้างข้อมูลเอง — รายงานอย่างเดียว (เจ้าของเลือกวิธีแก้)
 */
import { buildBranchSnapshot } from "../rules/snapshot";
import { annualValueForTerm, serviceMonthsForTerm } from "../rules/term";
import type { Contract, SnapshotRow, TierRule } from "../rules/types";
import { normalizeBranch } from "./branches";
import { importContracts } from "./importContracts";
import {
  parseRegistrySheet,
  readRegistryTierSummary,
  type CellValue,
  type RegistryRow,
  type RegistryTierSummary,
} from "./registrySheet";
import type { CleanedRow, ImportResult } from "./types";

/** ค่าแทนในช่องผู้ขาย (ทะเบียนไม่มีคอลัมน์ผู้ขาย) — ข้อมูลจริงต้องเอาจากไฟล์เปิดงานของ Admin */
export const DRY_RUN_SELLER = "(dry-run: ทะเบียนไม่มีคอลัมน์ผู้ขาย)";
/** ค่าแทนประเภทลูกค้าในรอบ lenient (เพื่อแยกปัญหาประเภทออกจากปัญหาตัวเลข) */
const LENIENT_TYPE = "อื่นๆ (ระบุในหมายเหตุ)";

export interface RowsByKind {
  [kind: string]: { count: number; excelRows: number[] };
}

export interface ImportRunSummary {
  ready: number;
  mustFix: number;
  skipped: number;
  errors: RowsByKind;
  warnings: RowsByKind;
  fixes: RowsByKind;
}

export interface MonthlySnapshot {
  strict: SnapshotRow;
  lenient: SnapshotRow;
  /** สัญญา (lenient) ที่ไม่ถูกนับในเดือนนี้เพราะเดือนบริการไม่ครอบคลุม — แยกตามสาเหตุ */
  notCounted: { endedBefore: number[]; startsAfter: number[] };
}

export interface BranchDryRun {
  sheet: string;
  branch: string;
  area: string;
  headerRows: [number, number];
  /** แถวที่มีข้อมูลในคอลัมน์หลัก (รวมบล็อกสรุปท้ายชีท) */
  dataRows: number;
  /** แถวที่ช่องเลขที่สัญญาเป็นรูป CTyy-… */
  contractRows: number;
  strict: ImportRunSummary;
  lenient: ImportRunSummary;
  snapshots: Record<string, MonthlySnapshot>;
  /** บล็อกสรุปท้ายชีท (สูตร Excel ของสาขาเอง) */
  inSheetSummary: RegistryTierSummary | null;
  /** ระยะสัญญาของสัญญาที่ผ่าน (lenient) — นับตามจำนวนเดือน */
  termMonths: Record<string, number>;
  outliers: {
    /** มูลค่าต่อปีสูงสุด 5 อันดับ */
    topAnnual: { excelRow: number; valueTotal: number; termMonths: number; annual: number }[];
    /** มูลค่าน้อยผิดปกติ (< 1,000 บาท) */
    tinyValue: number[];
    /** วันที่ที่พิมพ์เป็นข้อความ (ไม่ใช่ช่องวันที่ของ Excel) */
    textDates: number[];
  };
  duplicates: {
    /** กลุ่มแถวที่เบอร์โทรเดียวกันแต่ชื่อต่างกัน (อาจเป็นลูกค้าเปลี่ยนชื่อ · DECISIONS 2.59) */
    samePhoneDifferentName: number[][];
    /** กลุ่มแถวที่ชื่อเดียวกัน (ลูกค้า 1 รายหลายสัญญา หรือแถวซ้ำ) */
    sameName: number[][];
  };
}

/** ข้อความ error/warning → "ชนิด" (ตัดค่าเฉพาะแถวออก เพื่อนับรวมได้) */
function kindOf(msg: string): string {
  return msg
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\([^)]*\)/g, "(…)")
    .replace(/แถว \d+/g, "แถว …")
    .replace(/ห่างจากที่ควรเป็น \d+ วัน/g, "ห่างจากที่ควรเป็น … วัน");
}

function addTo(map: RowsByKind, msg: string, excelRow: number): void {
  const k = kindOf(msg);
  const slot = (map[k] ??= { count: 0, excelRows: [] });
  slot.count += 1;
  slot.excelRows.push(excelRow);
}

function summarize(result: ImportResult, rows: RegistryRow[]): ImportRunSummary {
  const excel = (rowIndex: number) => rows[rowIndex - 1]?.excelRow ?? -1;
  const errors: RowsByKind = {};
  const warnings: RowsByKind = {};
  const fixes: RowsByKind = {};
  for (const r of result.mustFix) {
    r.errors.forEach((e) => addTo(errors, e, excel(r.rowIndex)));
    r.warnings.forEach((w) => addTo(warnings, w, excel(r.rowIndex)));
  }
  for (const r of result.ready) {
    r.warnings.forEach((w) => addTo(warnings, w, excel(r.rowIndex)));
    r.fixes.forEach((f) => addTo(fixes, f, excel(r.rowIndex)));
  }
  return {
    ready: result.summary.ready,
    mustFix: result.summary.mustFix,
    skipped: result.summary.skipped,
    errors,
    warnings,
    fixes,
  };
}

function toContract(r: CleanedRow): Contract {
  return { id: r.contractNo, startDate: r.startDate, termMonths: r.termMonths, valueTotal: r.valueTotal };
}

function squash(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function groupRows(rows: RegistryRow[], key: (r: RegistryRow) => string): Map<string, RegistryRow[]> {
  const m = new Map<string, RegistryRow[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

const CONTRACT_LIKE = /^CT\d{2}-\d+$/;
const TINY_VALUE = 1000;

export interface DryRunOptions {
  /** เกณฑ์ Tier (รูปเดียวกับที่อ่านจาก tier_rules) */
  rules: TierRule[];
  /** เดือนที่จะคำนวณ snapshot ('YYYY-MM') */
  months: string[];
}

/** dry-run 1 ชีท (1 สาขา) */
export function dryRunRegistrySheet(sheetName: string, grid: CellValue[][], opts: DryRunOptions): BranchDryRun {
  const parsed = parseRegistrySheet(grid, sheetName.trim(), { sellerPlaceholder: DRY_RUN_SELLER });
  const br = normalizeBranch(sheetName);
  if (!br.branch || !br.zone) throw new Error(`dryRun: ชื่อชีท "${sheetName}" ไม่ใช่สาขาที่รู้จัก`);
  const ref = { area: br.zone, branch: br.branch };

  const rows = parsed.rows;
  const contractRows = rows.filter((r) => {
    const raw = r.raw as Record<string, string>;
    return CONTRACT_LIKE.test((raw["เลขที่สัญญา"] ?? "").replace(/\s+/g, "").toUpperCase());
  });

  const strictResult = importContracts(rows.map((r) => r.raw));
  const lenientRows = rows.map((r) => ({ ...(r.raw as Record<string, string>), ประเภท: LENIENT_TYPE, ทีม: "" }));
  const lenientResult = importContracts(lenientRows);

  const excelOf = (rowIndex: number) => rows[rowIndex - 1]?.excelRow ?? -1;
  const strictContracts = strictResult.ready.map(toContract);
  const lenientContracts = lenientResult.ready.map(toContract);

  const snapshots: Record<string, MonthlySnapshot> = {};
  for (const month of opts.months) {
    const endedBefore: number[] = [];
    const startsAfter: number[] = [];
    for (const r of lenientResult.ready) {
      const sm = serviceMonthsForTerm(r.startDate, r.termMonths);
      if (sm.includes(month)) continue;
      if ((sm[0] ?? "") > month) startsAfter.push(excelOf(r.rowIndex));
      else endedBefore.push(excelOf(r.rowIndex));
    }
    snapshots[month] = {
      strict: buildBranchSnapshot(ref, strictContracts, month, opts.rules),
      lenient: buildBranchSnapshot(ref, lenientContracts, month, opts.rules),
      notCounted: { endedBefore, startsAfter },
    };
  }

  const termMonths: Record<string, number> = {};
  for (const r of lenientResult.ready) termMonths[r.termMonths] = (termMonths[r.termMonths] ?? 0) + 1;

  const topAnnual = lenientResult.ready
    .map((r) => ({
      excelRow: excelOf(r.rowIndex),
      valueTotal: r.valueTotal,
      termMonths: r.termMonths,
      annual: Math.round(annualValueForTerm(r.valueTotal, r.termMonths) * 100) / 100,
    }))
    .sort((a, b) => b.annual - a.annual)
    .slice(0, 5);
  const tinyValue = lenientResult.ready.filter((r) => r.valueTotal < TINY_VALUE).map((r) => excelOf(r.rowIndex));

  const startCol = parsed.columns.startDate;
  const endCol = parsed.columns.endDate;
  const textDates = contractRows
    .filter((r) => {
      const cells = grid[r.excelRow - 1] ?? [];
      return [cells[startCol], cells[endCol]].some((v) => typeof v === "string" && v.trim() !== "");
    })
    .map((r) => r.excelRow);

  const nameOf = (r: RegistryRow) => squash((r.raw as Record<string, string>)["รายชื่อ"] ?? "");
  const byPhone = groupRows(contractRows, (r) => (r.phoneDigits.length >= 9 ? r.phoneDigits : ""));
  const samePhoneDifferentName = [...byPhone.values()]
    .filter((g) => g.length > 1 && new Set(g.map(nameOf)).size > 1)
    .map((g) => g.map((r) => r.excelRow));
  const sameName = [...groupRows(contractRows, nameOf).values()]
    .filter((g) => g.length > 1)
    .map((g) => g.map((r) => r.excelRow));

  return {
    sheet: sheetName,
    branch: ref.branch,
    area: ref.area,
    headerRows: parsed.headerRows,
    dataRows: rows.length,
    contractRows: contractRows.length,
    strict: summarize(strictResult, rows),
    lenient: summarize(lenientResult, rows),
    snapshots,
    inSheetSummary: readRegistryTierSummary(grid),
    termMonths,
    outliers: { topAnnual, tinyValue, textDates },
    duplicates: { samePhoneDifferentName, sameName },
  };
}
