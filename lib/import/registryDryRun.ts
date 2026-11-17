/**
 * ทดลองนำเข้าทะเบียนรายสาขาแบบ dry-run (phase 6 · SPEC §15 ข้อ 1) — pure function ไม่เขียนฐานข้อมูล
 *
 * Logic summary:
 *   1. แต่ละชีท → parseRegistrySheet → importContracts 2 รอบ
 *      - strict  = โหมดนำเข้าจริง (DECISIONS 2.70)
 *          · ประเภทลูกค้าแปลงตามตาราง customerTypes.ts (H/T/TH/R + คำสะกดผิด + ศาลเจ้า)
 *          · ผู้ขาย = จับคู่เลขที่สัญญากับไฟล์เปิดงาน (sellerLookup.ts) · ไม่เจอ = ปล่อยว่าง (allowMissingSeller)
 *          · แถวที่สั่งกันไว้ (holdRows เช่น มูลค่าสูงผิดปกติ) ไม่นำเข้า (ตัวเลือก · เขต 1 ไม่ใช้)
 *        → ใช้นับ "ปัญหาข้อมูล" และเป็นตัวเลขที่จะเข้าระบบจริง
 *      - lenient = ตัดปัญหาที่ไม่กระทบตัวเลข (ประเภทลูกค้า, ทีม) ออก → เหลือเฉพาะปัญหาวันที่/มูลค่า/ระยะสัญญา
 *        ใช้แยก "สูตรผิด" ออกจาก "ข้อมูลไม่สะอาด" (ถ้า lenient ยังไม่ตรง = ต้องหาสาเหตุที่วันที่/มูลค่า/สูตร)
 *   2. สัญญาที่ผ่าน → buildBranchSnapshot (lib/rules) ของแต่ละเดือนที่ขอ (เกณฑ์ Tier ส่งเข้ามา ห้าม hardcode)
 *   3. รวบรวมปัญหาเป็น "จำนวน + เลขแถว Excel" เท่านั้น — ห้ามมีชื่อ/เบอร์/ที่อยู่ในผลลัพธ์ (PDPA)
 *      · ลูกค้าซ้ำ (2.59) ตรวจด้วยเบอร์โทร/ชื่อในหน่วยความจำ แล้วคืนแค่เลขแถว
 *      · ผู้ขาย รายงานเป็น "จำนวน" เท่านั้น (ไม่มีชื่อผู้ขาย)
 *   4. ไม่ตัดสินวิธีล้างข้อมูลเอง — รายงานอย่างเดียว (เจ้าของเลือกวิธีแก้)
 *      รายการแถวที่ต้องกรอกมือ + ตารางแปลงประเภทสร้างต่อใน registryReport.ts
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
import { lookupSeller, type SellerIndex } from "./sellerLookup";
import type { CleanedRow, ImportResult } from "./types";

/** ค่าแทนประเภทลูกค้าในรอบ lenient (เพื่อแยกปัญหาประเภทออกจากปัญหาตัวเลข) */
const LENIENT_TYPE = "อื่นๆ (ระบุในหมายเหตุ)";

export interface RowsByKind {
  [kind: string]: { count: number; excelRows: number[] };
}

export interface ImportRunSummary {
  /** ผ่านและจะนำเข้า (ไม่รวมแถวที่สั่งกันไว้) */
  ready: number;
  /** แถวที่ผ่านกฎแต่ถูกกันไว้ (holdRows) — เลขแถว Excel · lenient ว่างเสมอ */
  held: number[];
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

/** ปัญหาของแถวที่ไม่ผ่าน (strict) — "ชนิด" ที่ตัดค่าเฉพาะแถวออกแล้ว (ไม่มีข้อมูลลูกค้า) */
export interface RowProblem {
  excelRow: number;
  kinds: string[];
}

/** แถวที่สั่งกันไว้ไม่ให้นำเข้า (ผ่านกฎแต่ต้องตรวจก่อน) → ไปอยู่ในรายการกรอกมือ */
export interface HoldRow {
  excelRow: number;
  /** เหตุผล (ไม่มีข้อมูลลูกค้า) เช่น "มูลค่าสูงผิดปกติ" */
  reason: string;
}

/** ผลจับคู่ผู้ขายของแถวที่จะนำเข้า (strict ready) — จำนวนเท่านั้น ไม่มีชื่อ */
export interface SellerMatchSummary {
  matched: number;
  /** เจอเลขสัญญาในไฟล์เปิดงานแต่ช่องผู้ขายว่าง */
  blank: number;
  /** เลขเดียวกันมีผู้ขายต่างกันในไฟล์เปิดงาน */
  conflict: number;
  /** เจอเลขสัญญา แต่ไฟล์ที่เจอไม่มีคอลัมน์ผู้ขาย (เช่น ไฟล์เปิดงาน 2568) */
  noSellerColumn: number;
  notFound: number;
  /** ที่จับคู่ได้ แยกตามตำแหน่ง (Sale / AM / "" = ไม่ระบุ) */
  matchedByPosition: Record<string, number>;
  /** ที่จับคู่ได้ แยกตามไฟล์ (ป้ายจาก mergeSellerIndexes เช่น "2569") · ดัชนีไฟล์เดียว = "" */
  matchedBySource: Record<string, number>;
  /** แถวที่หลายไฟล์ให้ชื่อผู้ขายต่างกัน (ใช้ไฟล์ล่าสุดแล้ว) */
  crossSourceConflicts: number;
  /** ที่ไม่เจอ (notFound + noSellerColumn) แยกตามปีในเลขสัญญา (CTyy → "yy") */
  notFoundByContractYear: Record<string, number>;
  /** แถวที่จะลงชื่อใน contracts.sale_name (ตำแหน่ง Sale / อื่นๆ) */
  saleName: number;
  /** แถวที่จะลงชื่อใน contracts.am_name (ตำแหน่ง AM) */
  amName: number;
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
  /** เลขแถว Excel ที่วันที่อ่านจากข้อความช่วงวันที่ (เฉพาะเมื่อเปิด readDateRangeText · ปิด = ว่าง) */
  dateFromRangeTextRows: number[];
  strict: ImportRunSummary;
  lenient: ImportRunSummary;
  /** แถวที่ไม่ผ่าน strict รายแถว (สำหรับรายการแถวที่ต้องกรอกมือ) */
  strictProblems: RowProblem[];
  /** แถวที่กันไว้ + เหตุผล (เฉพาะแถวที่ผ่านกฎ · แถวที่ไม่ผ่านอยู่ใน strictProblems อยู่แล้ว) */
  heldRows: HoldRow[];
  /** ค่าประเภทลูกค้าดิบในแถวสัญญา → จำนวนแถว (ค่าประเภทไม่ใช่ข้อมูลส่วนบุคคล) · "" = ว่าง */
  customerTypeValues: Record<string, number>;
  /** null = ไม่ได้ส่งไฟล์เปิดงานมา */
  sellers: SellerMatchSummary | null;
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

/** ข้อความ error/warning → "ชนิด" (ตัดค่าเฉพาะแถวออก เพื่อนับรวมได้ และไม่ให้ค่าจริงหลุดลงรายงาน) */
export function kindOf(msg: string): string {
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

function summarize(result: ImportResult, rows: RegistryRow[], held: number[] = []): ImportRunSummary {
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
    held,
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

function contractYear(contractNo: string): string {
  return /^CT(\d{2})-/.exec(contractNo)?.[1] ?? "?";
}

const CONTRACT_LIKE = /^CT\d{2}-\d+$/;
const TINY_VALUE = 1000;

export interface DryRunOptions {
  /** เกณฑ์ Tier (รูปเดียวกับที่อ่านจาก tier_rules) */
  rules: TierRule[];
  /** เดือนที่จะคำนวณ snapshot ('YYYY-MM') */
  months: string[];
  /** ดัชนีผู้ขายจากไฟล์เปิดงาน · ไม่ส่ง = ผู้ขายว่างทุกแถว (ยังนำเข้าได้ · 2.70 ฉ) */
  sellerIndex?: SellerIndex;
  /** แถวที่กันไว้ไม่นำเข้า (เลขแถว Excel ของชีทนี้) */
  holdRows?: HoldRow[];
  /**
   * ชื่อสาขาปลายทาง (ตามตารางชีท → สาขาที่ระบุเอง เช่น centralRegistrySheets.ts)
   * ต้องสะกดตรง master ทุกตัวอักษร · ไม่ส่ง = ใช้ชื่อชีท (แบบเขต 1)
   */
  branch?: string;
  /** ⚠ ข้อเสนอ (ปิดไว้) — อ่านวันที่จากข้อความช่วงวันที่ เมื่อช่องวันที่ว่าง (RegistrySheetOptions.readDateRangeText) */
  readDateRangeText?: boolean;
}

/** dry-run 1 ชีท (1 สาขา) */
export function dryRunRegistrySheet(sheetName: string, grid: CellValue[][], opts: DryRunOptions): BranchDryRun {
  const target = opts.branch ?? sheetName.trim();
  const br = normalizeBranch(target);
  if (!br.branch || !br.zone) throw new Error(`dryRun: ชื่อชีท "${sheetName}" ไม่ใช่สาขาที่รู้จัก`);
  if (opts.branch !== undefined && (br.fix || br.branch !== opts.branch)) {
    throw new Error(`dryRun: สาขาปลายทาง "${opts.branch}" ต้องสะกดตรง master ทุกตัวอักษร`);
  }
  const parsed = parseRegistrySheet(grid, opts.branch ?? sheetName.trim(), {
    readDateRangeText: opts.readDateRangeText,
  });
  const ref = { area: br.zone, branch: br.branch };

  const rows = parsed.rows;
  const excelOf = (rowIndex: number) => rows[rowIndex - 1]?.excelRow ?? -1;
  const contractRows = rows.filter((r) => {
    const raw = r.raw as Record<string, string>;
    return CONTRACT_LIKE.test((raw["เลขที่สัญญา"] ?? "").replace(/\s+/g, "").toUpperCase());
  });

  // strict: ผู้ขายจากไฟล์เปิดงาน (ชื่ออยู่ในหน่วยความจำเท่านั้น ไม่ออกไปกับผลลัพธ์)
  const strictRows = rows.map((r) => {
    const raw = r.raw as Record<string, string>;
    const found = opts.sellerIndex ? lookupSeller(opts.sellerIndex, raw["เลขที่สัญญา"] ?? "") : null;
    const matched = found?.status === "matched" ? found.seller : null;
    // ตำแหน่งใช้แยก sale_name / am_name (sellerColumns) · ไม่ใช้อนุมาน New/Renew
    return { ...raw, ผู้ขาย: matched?.name ?? "", ตำแหน่ง: matched?.position ?? "" };
  });
  const rawStrict = importContracts(strictRows, {
    allowMissingSeller: true,
  });
  // กันแถวที่สั่งไว้ (ผ่านกฎแต่ต้องตรวจก่อน) ออกจากกลุ่มพร้อมนำเข้า
  const holdSet = new Set((opts.holdRows ?? []).map((h) => h.excelRow));
  const readyExcelRows = new Set(rawStrict.ready.map((r) => excelOf(r.rowIndex)));
  const heldRows = (opts.holdRows ?? []).filter((h) => readyExcelRows.has(h.excelRow));
  const strictReady = rawStrict.ready.filter((r) => !holdSet.has(excelOf(r.rowIndex)));
  const strictResult: ImportResult = {
    ...rawStrict,
    ready: strictReady,
    summary: { ...rawStrict.summary, ready: strictReady.length },
  };

  const lenientRows = rows.map((r) => ({ ...(r.raw as Record<string, string>), ประเภท: LENIENT_TYPE, ทีม: "" }));
  const lenientResult = importContracts(lenientRows, { allowMissingSeller: true });

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

  const strictProblems: RowProblem[] = strictResult.mustFix.map((r) => ({
    excelRow: excelOf(r.rowIndex),
    kinds: r.errors.map(kindOf),
  }));

  const customerTypeValues: Record<string, number> = {};
  for (const r of contractRows) {
    const v = ((r.raw as Record<string, string>)["ประเภท"] ?? "").trim();
    customerTypeValues[v] = (customerTypeValues[v] ?? 0) + 1;
  }

  let sellers: SellerMatchSummary | null = null;
  if (opts.sellerIndex) {
    const s: SellerMatchSummary = {
      matched: 0,
      blank: 0,
      conflict: 0,
      noSellerColumn: 0,
      notFound: 0,
      matchedByPosition: {},
      matchedBySource: {},
      crossSourceConflicts: 0,
      notFoundByContractYear: {},
      saleName: 0,
      amName: 0,
    };
    for (const r of strictResult.ready) {
      if (r.saleName) s.saleName += 1;
      if (r.amName) s.amName += 1;
      if (opts.sellerIndex.crossSourceConflicts.has(r.contractNo)) s.crossSourceConflicts += 1;
      const found = lookupSeller(opts.sellerIndex, r.contractNo);
      s[found.status] += 1;
      if (found.status === "matched") {
        const pos = found.seller.position;
        s.matchedByPosition[pos] = (s.matchedByPosition[pos] ?? 0) + 1;
        const src = found.seller.source ?? "";
        s.matchedBySource[src] = (s.matchedBySource[src] ?? 0) + 1;
      } else if (found.status === "notFound" || found.status === "noSellerColumn") {
        const yy = contractYear(r.contractNo);
        s.notFoundByContractYear[yy] = (s.notFoundByContractYear[yy] ?? 0) + 1;
      }
    }
    sellers = s;
  }

  return {
    sheet: sheetName,
    branch: ref.branch,
    area: ref.area,
    headerRows: parsed.headerRows,
    dataRows: rows.length,
    contractRows: contractRows.length,
    dateFromRangeTextRows: rows.filter((r) => r.dateFromRangeText).map((r) => r.excelRow),
    strict: summarize(strictResult, rows, heldRows.map((h) => h.excelRow)),
    lenient: summarize(lenientResult, rows),
    strictProblems,
    heldRows,
    customerTypeValues,
    sellers,
    snapshots,
    inSheetSummary: readRegistryTierSummary(grid),
    termMonths,
    outliers: { topAnnual, tinyValue, textDates },
    duplicates: { samePhoneDifferentName, sameName },
  };
}
