/**
 * อ่านไฟล์ทะเบียนส่วนกลาง OCT.26 ทั้ง 8 ไฟล์ (24 สาขา) จากโฟลเดอร์ fixtures — Node เท่านั้น
 * ใช้ร่วมกัน: เทสไฟล์จริง (centralRegistry.testkit.ts) และสคริปต์นำเข้าจริง (scripts/import-central-registry.ts)
 *
 * Logic summary:
 *   - อ่านตาม CENTRAL_REGISTRY_FILES_OCT26 (ชีทไม่อยู่ในตาราง = throw · ลพบุรี = ข้าม)
 *   - หาเลขสัญญาซ้ำข้ามสาขาจากทั้ง 24 สาขา → holdRows ต่อสาขา (ง1) — เขต 1 ต้องใช้ผลนี้ด้วย เพราะคู่ซ้ำข้ามไฟล์
 *   - รายการตัดสัญญา (2.103 · CONTRACT_EXCLUSIONS_OCT26) แจกให้แต่ละชีทใน excludeRows · รายการที่ไม่ตรงไฟล์/ชีท = throw
 *     ผู้เรียกต้องส่ง excludeRows ต่อให้ planRegistryImport / dryRunRegistrySheet เอง
 *   - ไฟล์จริงมีข้อมูลลูกค้า (PDPA) — ห้าม log ค่าในเซลล์
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CENTRAL_REGISTRY_FILES_OCT26, REGISTRY_IMPORT_OPTIONS, resolveRegistrySheet, type RegistryFileSpec } from "./centralRegistrySheets";
import {
  applyContractNoCorrections,
  assignContractExclusions,
  unusedCorrections,
  type ContractNoCorrection,
} from "./centralRegistryCorrections";
import { findCrossBranchDuplicates } from "./crossBranchDuplicates";
import type { ExcludeRow, HoldRow } from "./registryDryRun";
import { parseRegistrySheet, type CellValue, type RegistrySheetResult } from "./registrySheet";
import { buildSellerIndex, mergeSellerIndexes, type SellerIndex } from "./sellerLookup";
import { readXlsx } from "./xlsx/readXlsx";

export interface CentralSheet {
  spec: RegistryFileSpec;
  sheet: string;
  branch: string;
  grid: CellValue[][];
  parsed: RegistrySheetResult;
  /** แถวที่ต้องตัดออก (2.103) · ไม่มี = undefined */
  excludeRows?: ExcludeRow[];
}

export interface CentralRegistry {
  sheets: CentralSheet[];
  skipped: { file: string; sheet: string; reason: string }[];
  holds: Map<string, HoldRow[]>;
}

/** ไฟล์เปิดงาน (ใช้จับคู่ผู้ขาย) — ลำดับ 2569 ก่อน 2568 (เลขซ้ำต่างคนใช้ 2569 · DECISIONS 2.73) */
export const JOB_OPENING_FILES = [
  { label: "2569", file: "รายชื่อลูกค้าเปิดงาน ปี2569.xlsx" },
  { label: "2568", file: "รายชื่อลูกค้าเปิดงาน ปี2568.xlsx" },
] as const;

export function hasAllCentralFiles(dir: string): boolean {
  return CENTRAL_REGISTRY_FILES_OCT26.every((f) => existsSync(join(dir, f.file)));
}

export function loadCentralRegistry(dir: string): CentralRegistry {
  const sheets: CentralSheet[] = [];
  const skipped: CentralRegistry["skipped"] = [];
  const applied: ContractNoCorrection[] = [];
  for (const spec of CENTRAL_REGISTRY_FILES_OCT26) {
    for (const s of readXlsx(join(dir, spec.file))) {
      const target = resolveRegistrySheet(spec, s.name);
      if (target.kind === "skip") {
        skipped.push({ file: spec.file, sheet: s.name, reason: target.reason });
        continue;
      }
      // แก้เลขสัญญาตามตารางที่ระบุเอง (2.80) ก่อนทุกขั้น → dry-run / หาเลขซ้ำ / นำเข้าจริง เห็นเลขเดียวกัน
      const fixed = applyContractNoCorrections(spec.file, s.name, s.rows);
      applied.push(...fixed.applied);
      const parsed = parseRegistrySheet(fixed.grid, target.branch, { readDateRangeText: REGISTRY_IMPORT_OPTIONS.readDateRangeText });
      sheets.push({ spec, sheet: s.name, branch: target.branch, grid: fixed.grid, parsed });
    }
  }
  const unused = unusedCorrections(applied);
  if (unused.length > 0) {
    throw new Error(`ตารางแก้เลขสัญญา: ไม่พบไฟล์/ชีทของรายการ ${unused.map((c) => `${c.sheet} แถว ${c.excelRow}`).join(", ")} — หยุด`);
  }
  const exclusions = assignContractExclusions(sheets.map((s) => ({ file: s.spec.file, sheet: s.sheet, branch: s.branch })));
  for (const s of sheets) {
    const ex = exclusions.get(s.branch);
    if (ex) s.excludeRows = ex;
  }
  const holds = findCrossBranchDuplicates(sheets.map((s) => ({ branch: s.branch, rows: s.parsed.rows })));
  return { sheets, skipped, holds };
}

/**
 * ดัชนีผู้ขายจากไฟล์เปิดงานทั้ง 2 ปี (ชุดเดียวกับที่ dry-run ใช้) · ไฟล์ใดไม่มี = throw
 * (ตัวเลขผู้ขายในรายงาน dry-run คิดจากทั้ง 2 ไฟล์ — ขาดไฟล์ใดตัวเลขจะไม่ตรง)
 */
export function loadSellerIndex(dir: string): SellerIndex {
  const missing = JOB_OPENING_FILES.filter((f) => !existsSync(join(dir, f.file))).map((f) => f.file);
  if (missing.length > 0) throw new Error(`ไม่พบไฟล์เปิดงาน: ${missing.join(", ")}`);
  return mergeSellerIndexes(
    JOB_OPENING_FILES.map((f) => ({ label: f.label, index: buildSellerIndex(readXlsx(join(dir, f.file))) })),
  );
}
