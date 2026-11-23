/**
 * นำเข้า "แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้" ที่แอดมินกรอกแล้ว เป็นรอบ (DECISIONS 2.104 · โหมด append)
 * (ตรรกะ: lib/import/manualRowsForm.ts = อ่าน/ตรวจ/แผน · lib/import/registryDbImport.ts = เขียน (mode append) + ตรวจรอบ
 *  · lib/import/cloudGuard.ts = ด่าน cloud · วิธีกรอก + ขั้นตอนรอบ: docs/แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้.md)
 *
 * วิธีรัน — ฐานข้อมูลในเครื่อง (ต้องได้คิว DB local จาก HQ ก่อน):
 *   ตรวจอย่างเดียว (ค่าเริ่มต้น ไม่เขียน):
 *     npx vite-node --config vitest.config.ts scripts/import-manual-rows.ts -- --fixtures "<path>/fixtures" \
 *       --form "<path>/fixtures/แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้-OCT26.xlsx" --batch registry-OCT26-fix1
 *   เขียนจริง (แล้วตรวจรอบนี้ต่อทันที): เพิ่ม --apply
 *   ตรวจรอบที่เขียนแล้วอย่างเดียว (อ่านอย่างเดียว · ใช้แบบฟอร์มฉบับเดียวกับตอนเขียน): เพิ่ม --verify-only
 *
 * วิธีรัน — cloud (**เฉพาะวันที่เจ้าของสั่ง**): เพิ่ม `--target cloud --project-ref <ref> --log-dir "<โฟลเดอร์นอก repo>"`
 *   --apply บน cloud: dry-run ในตัวก่อน แล้วต้องพิมพ์ `นำเข้า <จำนวนสัญญา>` ตรงตัว · ไม่มี flag ข้ามการยืนยัน
 *
 * ตัวเลือก: --month YYYY-MM (ค่าเริ่มต้น 2026-10 เหมือนรอบแรก · ใช้คิดสถานะสัญญาและยอดที่คาด)
 *
 * env (ตั้งในเทอร์มินัลตอนรันเท่านั้น · ห้าม commit): NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
 *   · (cloud) AGA_CLOUD_PROJECT_REF · AGA_IMPORT_LOG_DIR หรือ --log-dir
 *
 * ด่านกันพลาด:
 *   - --batch บังคับ รูป registry-OCT26-fix<เลข> · ห้าม registry-OCT26 (รอบแรก) · batch ที่มีสัญญาแล้ว = หยุด (1 รอบ = 1 batch)
 *   - รับเฉพาะ 121 แถวในรายการกรอกมือ (คำนวณจากไฟล์ทะเบียนใน --fixtures) และเฉพาะแถว แก้แล้ว = ใช่
 *   - เลขสัญญาที่มีใน DB แล้ว = ข้ามและรายงาน (ไม่เขียนทับ) · ไม่ใช้ด่าน "สาขามีลูกค้าแล้ว" ของการนำเข้าเต็ม
 *   - ต่อผ่าน PostgREST ด้วย service_role เท่านั้น (ห้าม role postgres) · เกณฑ์ Tier อ่านจาก tier_rules
 *   - พิมพ์/บันทึกเฉพาะ จำนวน · สาขา · เลขแถว · เลขสัญญา · เหตุผล (ตัดค่าจริงแล้ว) — ไม่มีชื่อ เบอร์ ที่อยู่ ผู้ขาย
 *   - ถอยรอบ: scripts/rollback-registry-import.ts --batch registry-OCT26-fixN
 */
import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasAllCentralFiles, loadCentralRegistry } from "../lib/import/centralRegistryFiles";
import { REGISTRY_IMPORT_BATCH_OCT26 } from "../lib/import/centralRegistrySheets";
import { runGuarded } from "../lib/import/cloudGuard";
import {
  assertFixBatch,
  buildManualFormRows,
  manualRowKey,
  parseCsv,
  planManualRows,
  readManualRowsForm,
  type FormReadResult,
} from "../lib/import/manualRowsForm";
import {
  findExistingContracts,
  importRegistryPlan,
  safeDbError,
  verifyBatchImport,
  type ExistingContract,
  type RegistryDbImportResult,
} from "../lib/import/registryDbImport";
import type { CellValue } from "../lib/import/registrySheet";
import { readXlsx } from "../lib/import/xlsx/readXlsx";
import { TIER_RULE_COLUMNS, toTierRules, type TierRuleRow } from "../lib/tierRules";
import { errorText, flag, hasFlag, setupScript } from "./_cloudCli";

const FORM_SHEET = "แบบฟอร์ม";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function readTierRules(client: SupabaseClient) {
  const { data, error } = await client.from("tier_rules").select(TIER_RULE_COLUMNS);
  if (error) throw new Error(`อ่าน tier_rules ไม่สำเร็จ: ${safeDbError(error)}`);
  const rules = toTierRules((data ?? []) as unknown as TierRuleRow[]);
  if (rules.length === 0) throw new Error("tier_rules ว่าง — หยุด");
  return rules;
}

/** อ่านไฟล์แบบฟอร์ม (.xlsx = ชีท "แบบฟอร์ม" · .csv = ทางสำรอง) */
function readFormGrid(path: string): CellValue[][] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".csv")) return parseCsv(readFileSync(path, "utf8"));
  if (!lower.endsWith(".xlsx")) throw new Error("--form ต้องเป็นไฟล์ .xlsx (หรือ .csv)");
  const sheet = readXlsx(path).find((s) => s.name === FORM_SHEET);
  if (!sheet) throw new Error(`ไม่พบชีท "${FORM_SHEET}" ในไฟล์แบบฟอร์ม (ห้ามเปลี่ยนชื่อชีท)`);
  return sheet.rows;
}

/** ตัวระบุ 121 แถวกรอกมือ จากไฟล์ทะเบียน (ไม่ต้องใช้ไฟล์เปิดงาน) */
function knownManualRows(dir: string): Set<string> {
  const central = loadCentralRegistry(dir);
  const rows = buildManualFormRows(
    central.sheets.map((s) => ({
      file: s.spec.file,
      sheet: s.sheet,
      branch: s.branch,
      grid: s.grid,
      parsed: s.parsed,
      holdRows: central.holds.get(s.branch),
      excludeRows: s.excludeRows,
    })),
  );
  return new Set(rows.map((r) => manualRowKey(r.branch, Number(r.excelRow))));
}

function existingLabel(e: ExistingContract | undefined): string {
  if (!e) return "ไม่ทราบ";
  const where = e.importBatch === null ? "เปิดในแอป" : e.importBatch === REGISTRY_IMPORT_BATCH_OCT26 ? "นำเข้ารอบแรก" : `นำเข้ารอบ ${e.importBatch}`;
  return `${where} · สาขา ${e.branch ?? "?"}`;
}

/** รายงานผลอ่านแบบฟอร์ม (ไม่มีข้อมูลลูกค้า) */
function formReport(read: FormReadResult): Record<string, unknown> {
  const warningKinds: Record<string, number> = {};
  for (const a of read.accepted) for (const w of a.warnings) warningKinds[w] = (warningKinds[w] ?? 0) + 1;
  return {
    counts: read.counts,
    invalid: read.invalid.map((p) => `แบบฟอร์มแถว ${p.formRow} · ${p.branch || "?"} แถว ${p.excelRow || "?"}: ${p.reasons.join(" · ")}`),
    warnings: warningKinds,
    warningRows: read.accepted
      .filter((a) => a.warnings.length)
      .map((a) => `แบบฟอร์มแถว ${a.formRow} · ${a.branch} แถว ${a.excelRow}: ${a.warnings.join(" · ")}`),
  };
}

function importSummary(res: RegistryDbImportResult): Record<string, unknown> {
  return { mode: res.dryRun ? "dry-run (ไม่เขียน)" : "apply", existing: res.existing, planned: res.planned, written: res.written };
}

async function main(): Promise<void> {
  const dir = flag("--fixtures") ?? process.env.AGA_FIXTURES_DIR;
  const formPath = flag("--form");
  const batch = assertFixBatch(flag("--batch"));
  const month = flag("--month") ?? "2026-10";
  const verifyOnly = hasFlag("--verify-only");
  if (!dir) throw new Error("ต้องระบุ --fixtures <โฟลเดอร์ fixtures> (หรือ env AGA_FIXTURES_DIR)");
  if (!formPath) throw new Error("ต้องระบุ --form <ไฟล์แบบฟอร์มที่กรอกแล้ว>");
  if (!MONTH_RE.test(month)) throw new Error("--month ต้องเป็น YYYY-MM");
  if (hasFlag("--apply") && verifyOnly) throw new Error("ใช้ --apply กับ --verify-only พร้อมกันไม่ได้");
  if (!hasAllCentralFiles(dir)) throw new Error("ไฟล์ทะเบียน OCT.26 ไม่ครบ 8 ไฟล์ในโฟลเดอร์ที่ระบุ");

  const ctx = setupScript("import-manual-rows");
  const log: Record<string, unknown> = { status: "error", batch, month, verifyOnly };
  try {
    const read = readManualRowsForm(readFormGrid(formPath), { knownRows: knownManualRows(dir) });
    const report: Record<string, unknown> = { batch, month, form: formReport(read) };
    log.form = report.form;
    const rules = await readTierRules(ctx.client);

    if (verifyOnly) {
      // ตรวจรอบที่เขียนแล้ว: แผน = แถวที่ผ่าน ที่เป็นของ batch นี้ใน DB
      const existing = await findExistingContracts(ctx.client, read.accepted.map((a) => a.cleaned.contractNo));
      const notThisBatch = new Set([...existing.values()].filter((e) => e.importBatch !== batch).map((e) => e.contractNo));
      const mine = read.accepted.filter((a) => existing.get(a.cleaned.contractNo)?.importBatch === batch);
      const { plan } = planManualRows(mine, { rules, month, importBatch: batch, skipContractNos: notThisBatch });
      const v = await verifyBatchImport(ctx.client, plan);
      report.verify = v;
      log.status = v.ok ? "verify-only" : "verify-only · ไม่ผ่าน";
      log.verify = v;
      console.log(JSON.stringify(report, null, 2));
      if (!v.ok) process.exitCode = 2;
      return;
    }

    const existing = await findExistingContracts(ctx.client, read.accepted.map((a) => a.cleaned.contractNo));
    const { plan, skippedExisting } = planManualRows(read.accepted, {
      rules,
      month,
      importBatch: batch,
      skipContractNos: new Set(existing.keys()),
    });
    report.skippedExisting = skippedExisting.map(
      (s) => `แบบฟอร์มแถว ${s.formRow} · ${s.branch} แถว ${s.excelRow} · ${s.contractNo}: มีในระบบแล้ว (${existingLabel(existing.get(s.contractNo))})`,
    );
    report.plan = {
      contracts: plan.totals.contracts,
      withAddress: plan.totals.withAddress,
      byBranch: plan.branches.map(
        (b) => `${b.branch}: สัญญา ${b.contracts.length} · ยอดเพิ่ม ${plan.month} cust ${b.expected.cust} / ${b.expected.value.toFixed(2)}`,
      ),
      // แถวที่รอบนี้จะนำเข้า (หลัง --apply = แถวที่ "ปิดแล้ว" ห้ามแก้ในแบบฟอร์มอีก · ไม่มีข้อมูลลูกค้า)
      rows: plan.branches.flatMap((b) => b.contracts.map((c) => `${b.branch} แถว ${c.excelRow} · ${c.contractNo}`)),
    };
    log.skippedExisting = report.skippedExisting;
    log.plan = report.plan;

    if (plan.totals.contracts === 0) {
      log.status = "nothing-to-import";
      console.log(JSON.stringify(report, null, 2));
      console.log("ไม่มีแถวที่จะนำเข้าในรอบนี้ (ไม่มีแถว แก้แล้ว = ใช่ ที่ผ่าน หรือมีในระบบหมดแล้ว)");
      return;
    }

    const out = await runGuarded({
      target: ctx.target,
      apply: ctx.apply,
      action: "import",
      dryRun: () => importRegistryPlan(ctx.client, plan, { dryRun: true, mode: "append" }),
      confirmCount: (d) => d.planned.contracts,
      describe: (d) =>
        `[dry-run · append · batch ${batch}] สาขา ${plan.branches.length} · จะเขียน ลูกค้า ${d.planned.customers}` +
        ` · เบอร์ ${d.planned.customerPhones} · สัญญา ${d.planned.contracts} · ทีม ${d.planned.contractTeams}` +
        ` · มีที่อยู่ ${plan.totals.withAddress} · ข้ามเพราะมีแล้ว ${skippedExisting.length} · แถวไม่ผ่าน ${read.counts.invalid}` +
        ` · ยอดเพิ่ม ${plan.month}: cust ${plan.branches.reduce((n, b) => n + b.expected.cust, 0)}` +
        ` / ${plan.branches.reduce((n, b) => n + b.expected.value, 0).toFixed(2)}`,
      write: () => importRegistryPlan(ctx.client, plan, { mode: "append" }),
      ask: ctx.ask,
      isTTY: ctx.isTTY,
      forceConfirm: ctx.forceConfirm,
      print: (t) => console.log(t),
    });
    if (out.status === "aborted") {
      Object.assign(log, { status: "aborted", reason: out.reason, dryRun: importSummary(out.dry) });
      console.log(out.reason);
      process.exitCode = 3;
      return;
    }
    const res = out.status === "applied" ? out.result : out.dry;
    report.result = importSummary(res);
    log.status = out.status;
    log.result = report.result;
    if (out.status === "applied") {
      const v = await verifyBatchImport(ctx.client, plan);
      report.verify = v;
      log.verify = v;
      if (!v.ok) {
        log.status = "applied · verify ไม่ผ่าน";
        process.exitCode = 2;
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    log.error = errorText(e, ctx.redact);
    throw e;
  } finally {
    ctx.finishLog(log);
  }
}

main().catch((e: unknown) => {
  console.error(errorText(e));
  process.exit(1);
});
