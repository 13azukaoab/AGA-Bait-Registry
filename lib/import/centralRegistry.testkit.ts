/**
 * ตัวช่วยเทสไฟล์จริงของทะเบียนส่วนกลาง (ใช้ร่วมกันใน zone1Registry / centralRegistry .dryrun.test.ts) — Node เท่านั้น
 *
 * - อ่านทะเบียนทั้ง 8 ไฟล์ตาม CENTRAL_REGISTRY_FILES_OCT26 (ชีทไม่อยู่ในตาราง = throw · ลพบุรี = ข้าม)
 * - หาเลขสัญญาซ้ำข้ามสาขาจากทั้ง 24 สาขา → holdRows ต่อสาขา (ง1) — เขต 1 ต้องใช้ผลนี้ด้วย เพราะคู่ซ้ำข้ามไฟล์
 * - ไฟล์จริงมีข้อมูลลูกค้า (PDPA) — ห้าม log ค่าในเซลล์
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CENTRAL_REGISTRY_FILES_OCT26, REGISTRY_IMPORT_OPTIONS, resolveRegistrySheet, type RegistryFileSpec } from "./centralRegistrySheets";
import { findCrossBranchDuplicates } from "./crossBranchDuplicates";
import type { HoldRow } from "./registryDryRun";
import { parseRegistrySheet, type CellValue, type RegistrySheetResult } from "./registrySheet";
import { readXlsx } from "./xlsx/readXlsx";

export interface CentralSheet {
  spec: RegistryFileSpec;
  sheet: string;
  branch: string;
  grid: CellValue[][];
  parsed: RegistrySheetResult;
}

export interface CentralRegistry {
  sheets: CentralSheet[];
  skipped: { file: string; sheet: string; reason: string }[];
  holds: Map<string, HoldRow[]>;
}

export function hasAllCentralFiles(dir: string): boolean {
  return CENTRAL_REGISTRY_FILES_OCT26.every((f) => existsSync(join(dir, f.file)));
}

export function loadCentralRegistry(dir: string): CentralRegistry {
  const sheets: CentralSheet[] = [];
  const skipped: CentralRegistry["skipped"] = [];
  for (const spec of CENTRAL_REGISTRY_FILES_OCT26) {
    for (const s of readXlsx(join(dir, spec.file))) {
      const target = resolveRegistrySheet(spec, s.name);
      if (target.kind === "skip") {
        skipped.push({ file: spec.file, sheet: s.name, reason: target.reason });
        continue;
      }
      const parsed = parseRegistrySheet(s.rows, target.branch, { readDateRangeText: REGISTRY_IMPORT_OPTIONS.readDateRangeText });
      sheets.push({ spec, sheet: s.name, branch: target.branch, grid: s.rows, parsed });
    }
  }
  const holds = findCrossBranchDuplicates(sheets.map((s) => ({ branch: s.branch, rows: s.parsed.rows })));
  return { sheets, skipped, holds };
}
