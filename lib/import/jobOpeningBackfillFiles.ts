/**
 * อ่านไฟล์จริงสำหรับงานเติมวันที่จากไฟล์เปิดงาน — Node เท่านั้น (ใช้ร่วมกัน: สคริปต์ backfill + เทสไฟล์จริง)
 *
 * Logic summary:
 *   - ไฟล์เปิดงาน: ค่าเริ่ม = ปี 2569 อย่างเดียว · includeYear2568 = เพิ่มปี 2568 (ส่งปีล่าสุดก่อน)
 *   - ทะเบียน: loadCentralRegistry + planRegistryImport ตัวเดียวกับตัวนำเข้าจริง (scripts/import-central-registry.ts)
 *     → ชุดสัญญาเท่ากับที่นำเข้า cloud (ไฟล์เดียวกัน · โค้ดเดียวกัน) · ไม่เท่า REGISTRY_CONTRACTS_OCT26 = หยุด
 *     เกณฑ์ Tier ใช้แค่คิดยอดที่คาด (expected) ไม่มีผลกับว่าแถวไหนเข้าแผน → ใช้ชุดเกณฑ์สำหรับเทส (lib/rules/__fixtures__)
 *   - ไฟล์จริงมีข้อมูลลูกค้า (PDPA) — ห้าม log ค่าในเซลล์
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { JOB_OPENING_FILES, loadCentralRegistry } from "./centralRegistryFiles";
import { REGISTRY_IMPORT_BATCH_OCT26, registryTargetBranches } from "./centralRegistrySheets";
import { registryNotImportedFromPlan, targetsFromPlan, type BackfillTarget, type NotFoundContext, type RegistryContractCell } from "./jobOpeningBackfill";
import { buildJobOpeningIndex, type JobOpeningIndex } from "./jobOpeningServiceDates";
import { planRegistryImport, type RegistryImportPlan } from "./registryImportPlan";
import { readXlsx } from "./xlsx/readXlsx";

/** จำนวนสัญญาของ batch registry-OCT26 บน cloud (ตรวจโดย HQ · DECISIONS 2.80 / 2.104) */
export const REGISTRY_CONTRACTS_OCT26 = 2369;

export function loadJobOpeningIndex(dir: string, opts: { includeYear2568?: boolean } = {}): JobOpeningIndex {
  const files = JOB_OPENING_FILES.filter((f) => f.label === "2569" || opts.includeYear2568);
  const missing = files.filter((f) => !existsSync(join(dir, f.file))).map((f) => f.file);
  if (missing.length > 0) throw new Error(`ไม่พบไฟล์เปิดงาน: ${missing.join(", ")}`);
  return buildJobOpeningIndex(files.map((f) => ({ label: f.label, sheets: readXlsx(join(dir, f.file)) })));
}

export interface RegistryBackfillContext {
  plan: RegistryImportPlan;
  /** เป้าหมายจากแผน (3 ช่องว่าง) — ใช้ในโหมดไม่ต่อ DB */
  targets: BackfillTarget[];
  notFound: NotFoundContext;
}

export function loadRegistryBackfillContext(dir: string): RegistryBackfillContext {
  const central = loadCentralRegistry(dir);
  const plan = planRegistryImport(
    central.sheets.map((s) => ({ sheet: s.sheet, branch: s.branch, grid: s.grid, excludeRows: s.excludeRows })),
    { rules: TIER_RULES, month: "2026-10", importBatch: REGISTRY_IMPORT_BATCH_OCT26 },
  );
  if (plan.totals.contracts !== REGISTRY_CONTRACTS_OCT26) {
    throw new Error(
      `แผนนำเข้าทะเบียนได้ ${plan.totals.contracts} สัญญา ไม่เท่า ${REGISTRY_CONTRACTS_OCT26} ที่อยู่บน cloud — ไฟล์ทะเบียน/โค้ดเปลี่ยน? หยุด`,
    );
  }
  const cells = new Map<string, RegistryContractCell[]>(
    central.sheets.map((s) => [
      s.branch,
      s.parsed.rows.map((r) => ({ excelRow: r.excelRow, rawContractNo: (r.raw as Record<string, string>)["เลขที่สัญญา"] ?? "" })),
    ]),
  );
  return {
    plan,
    targets: targetsFromPlan(plan),
    notFound: { centralBranches: new Set(registryTargetBranches()), registryNotImported: registryNotImportedFromPlan(plan, cells) },
  };
}
