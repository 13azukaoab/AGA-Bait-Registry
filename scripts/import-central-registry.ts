/**
 * นำเข้าทะเบียนส่วนกลาง OCT.26 (24 สาขา · 8 ไฟล์) → customers / customer_phones / contracts / contract_teams
 * (ตรรกะ: lib/import/registryImportPlan.ts = แผน · lib/import/registryDbImport.ts = เขียน + ตรวจยอด · lib/import/cloudGuard.ts = ด่าน cloud)
 *
 * วิธีรัน — ฐานข้อมูลในเครื่อง (ต้องได้คิว DB local จาก HQ ก่อน — มีตัวเดียว ใช้ร่วมกันทุก worktree):
 *   ตรวจอย่างเดียว (ค่าเริ่มต้น ไม่เขียน):
 *     npx vite-node --config vitest.config.ts scripts/import-central-registry.ts -- --fixtures "<path>/fixtures"
 *   เขียนจริง (แล้วตรวจยอดต่อทันที):
 *     npx vite-node --config vitest.config.ts scripts/import-central-registry.ts -- --fixtures "<path>/fixtures" --apply
 *   ตรวจยอดอย่างเดียว (หลังนำเข้าแล้ว · อ่านอย่างเดียว):
 *     npx vite-node --config vitest.config.ts scripts/import-central-registry.ts -- --fixtures "<path>/fixtures" --verify-only
 *
 * วิธีรัน — cloud (**เฉพาะวันที่เจ้าของสั่ง** · แผน docs/แผนนำเข้า-cloud-23พย2569.md · รันใน PowerShell / Windows Terminal):
 *   เพิ่ม `--target cloud --project-ref <ref> --log-dir "<โฟลเดอร์นอก repo>"` ต่อท้ายคำสั่งข้างบน (dry-run / --apply / --verify-only)
 *   --apply บน cloud: dry-run ในตัวก่อน แสดงตัวเลข แล้วต้องพิมพ์ `นำเข้า <จำนวนสัญญา>` ตรงตัว (เช่น `นำเข้า 2369`)
 *   ไม่ตรง/ไม่พิมพ์ = ไม่เขียน · ไม่มี flag ข้ามการยืนยัน
 *   ซ้อมพิมพ์คำยืนยันกับ DB ในเครื่อง: ใส่ `--apply --confirm` (localhost จะถามแบบเดียวกับ cloud)
 *
 * env ที่ต้องมี (ตั้งในเทอร์มินัลตอนรันเท่านั้น · ห้าม commit · ห้ามวางในแชท):
 *   NEXT_PUBLIC_SUPABASE_URL   local เช่น http://127.0.0.1:54321 · cloud = https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  service role ของปลายทาง
 *   AGA_CLOUD_PROJECT_REF      (cloud) ref เดียวกับ --project-ref และ subdomain ของ URL
 *   AGA_IMPORT_LOG_DIR         (ทางเลือกแทน --log-dir) โฟลเดอร์ log นอก repo · cloud บังคับมี
 *
 * ด่านกันพลาด:
 *   - ไม่ใส่ --target = localhost / 127.0.0.1 เท่านั้น (เหมือนเดิม) · --target cloud = ตรวจ ref 3 ที่ + ยืนยันพิมพ์
 *   - ต่อผ่าน PostgREST (service_role) ไม่ต่อด้วย role postgres (CLAUDE.md กฎ Deploy) · ไม่ import lib/supabase/admin.ts (M21b)
 *   - เกณฑ์ Tier อ่านจาก tier_rules ใน DB (กฎ 3) · ตัวเลือกนำเข้า = REGISTRY_IMPORT_OPTIONS ตัวเดียวกับ dry-run
 *   - มีลูกค้าในสาขาเป้าหมาย / มีเลขสัญญาในแผนอยู่แล้ว = หยุด (รันซ้ำไม่เกิดแถวซ้ำ)
 *   - พิมพ์/บันทึกเฉพาะตัวเลขรวม/เลขแถว/เลขสัญญาที่ตัด/ชื่อสาขา ไม่พิมพ์ชื่อลูกค้า เบอร์ ที่อยู่ ผู้ขาย หรือ key/URL (PDPA · log ผ่านตัวลบค่าลับ)
 *   - ที่อยู่ (2.102) → customers.address · รายการตัดสัญญา (2.103) = CONTRACT_EXCLUSIONS_OCT26 ใน lib/import/centralRegistryCorrections.ts
 *   - ถอยกลับ: scripts/rollback-registry-import.ts --batch registry-OCT26
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadCentralRegistry, loadSellerIndex, hasAllCentralFiles } from "../lib/import/centralRegistryFiles";
import { runGuarded } from "../lib/import/cloudGuard";
import { importRegistryPlan, safeDbError, verifyRegistryImport, type RegistryDbImportResult } from "../lib/import/registryDbImport";
import { REGISTRY_IMPORT_BATCH_OCT26 } from "../lib/import/centralRegistrySheets";
import { planRegistryImport, type RegistryImportPlan } from "../lib/import/registryImportPlan";
import { TIER_RULE_COLUMNS, toTierRules, type TierRuleRow } from "../lib/tierRules";
import { errorText, flag, hasFlag, setupScript } from "./_cloudCli";

const MONTH = "2026-10";

async function readTierRules(client: SupabaseClient) {
  const { data, error } = await client.from("tier_rules").select(TIER_RULE_COLUMNS);
  if (error) throw new Error(`อ่าน tier_rules ไม่สำเร็จ: ${safeDbError(error)}`);
  const rules = toTierRules((data ?? []) as unknown as TierRuleRow[]);
  if (rules.length === 0) throw new Error("tier_rules ว่าง — หยุด");
  return rules;
}

function planSummary(plan: RegistryImportPlan, skipped: string[]): Record<string, unknown> {
  return {
    month: MONTH,
    skippedSheets: skipped,
    plan: {
      branches: plan.branches.length,
      ...plan.totals,
      saleName: plan.branches.reduce((n, b) => n + b.sellers.saleName, 0),
      amName: plan.branches.reduce((n, b) => n + b.sellers.amName, 0),
      placeholderNames: plan.branches.reduce((n, b) => n + b.placeholderNames, 0),
      sameNameGroups: plan.branches.reduce((n, b) => n + b.sameNameGroups.groups, 0),
      sameNameRows: plan.branches.reduce((n, b) => n + b.sameNameGroups.rows, 0),
      heldRows: plan.branches.filter((b) => b.heldRows.length).map((b) => `${b.branch}: ${b.heldRows.map((h) => h.excelRow).join(", ")}`),
      // 2.103: เลขแถว + เลขสัญญาที่ตัดออก (เลขสัญญาไม่ใช่ข้อมูลส่วนบุคคล)
      excludedRows: plan.branches
        .filter((b) => b.excludedRows.length)
        .map((b) => `${b.branch}: ${b.excludedRows.map((x) => `แถว ${x.excelRow} ${x.contractNo}`).join(", ")}`),
      // 2.102: จำนวนเท่านั้น
      addresses: {
        withAddress: plan.totals.withAddress,
        emptyRows: plan.branches.reduce((n, b) => n + b.addresses.emptyRows, 0),
        numericRows: plan.branches.reduce((n, b) => n + b.addresses.numericRows, 0),
        nonTextRows: plan.branches.reduce((n, b) => n + b.addresses.nonTextRows, 0),
        sheetsWithoutAddressColumn: plan.branches.filter((b) => !b.addresses.hasAddressColumn).map((b) => b.branch),
        headerVariants: plan.branches
          .filter((b) => b.addressHeaderVariants.length)
          .map((b) => `${b.branch}: ${b.addressHeaderVariants.join(" | ")}`),
        byBranch: plan.branches.map((b) => `${b.branch}: มีที่อยู่ ${b.addresses.withAddress} / ${b.contracts.length}`),
      },
      phones: {
        rowsWithPhones: plan.branches.reduce((n, b) => n + b.phones.rowsWithPhones, 0),
        phones: plan.branches.reduce((n, b) => n + b.phones.phones, 0),
        emptyRows: plan.branches.reduce((n, b) => n + b.phones.emptyRows, 0),
        invalidRows: plan.branches.reduce((n, b) => n + b.phones.invalidRows, 0),
        byBranch: plan.branches.map((b) => `${b.branch}: เบอร์ ${b.phones.phones} · ว่าง ${b.phones.emptyRows} · ผิดรูป ${b.phones.invalidRows}`),
      },
    },
  };
}

function importSummary(res: RegistryDbImportResult): Record<string, unknown> {
  return {
    mode: res.dryRun ? "dry-run (ไม่เขียน)" : "apply",
    existing: res.existing,
    planned: res.planned,
    written: res.written,
  };
}

async function main(): Promise<void> {
  const dir = flag("--fixtures") ?? process.env.AGA_FIXTURES_DIR;
  const verifyOnly = hasFlag("--verify-only");
  if (!dir) throw new Error("ต้องระบุ --fixtures <โฟลเดอร์ fixtures> (หรือ env AGA_FIXTURES_DIR)");
  if (hasFlag("--apply") && verifyOnly) throw new Error("ใช้ --apply กับ --verify-only พร้อมกันไม่ได้");
  if (!hasAllCentralFiles(dir)) throw new Error("ไฟล์ทะเบียน OCT.26 ไม่ครบ 8 ไฟล์ในโฟลเดอร์ที่ระบุ");

  const ctx = setupScript("import-central-registry");
  const log: Record<string, unknown> = { status: "error", verifyOnly };
  try {
    const central = loadCentralRegistry(dir);
    const plan = planRegistryImport(
      central.sheets.map((s) => ({ sheet: s.sheet, branch: s.branch, grid: s.grid, excludeRows: s.excludeRows })),
      { rules: await readTierRules(ctx.client), month: MONTH, sellerIndex: loadSellerIndex(dir), importBatch: REGISTRY_IMPORT_BATCH_OCT26 },
    );
    const summary = planSummary(plan, central.skipped.map((s) => `${s.sheet} (${s.reason})`));
    log.plan = summary.plan;

    let applied = false;
    if (!verifyOnly) {
      const out = await runGuarded({
        target: ctx.target,
        apply: ctx.apply,
        action: "import",
        dryRun: () => importRegistryPlan(ctx.client, plan, { dryRun: true }),
        confirmCount: (d) => d.planned.contracts,
        describe: (d) =>
          `[cloud dry-run] สาขา ${plan.branches.length} · จะเขียน ลูกค้า ${d.planned.customers} · เบอร์ ${d.planned.customerPhones}` +
          ` · สัญญา ${d.planned.contracts} · ทีม ${d.planned.contractTeams} · มีที่อยู่ ${plan.totals.withAddress}` +
          ` · ตัดออก ${plan.totals.excluded}` +
          ` · ข้อมูลเดิม: ลูกค้า ${d.existing.customersInBranches} / เลขสัญญา ${d.existing.contractNos}` +
          ` · ยอดคาด ${plan.month}: cust ${plan.branches.reduce((n, b) => n + b.expected.cust, 0)}` +
          ` / ${plan.branches.reduce((n, b) => n + b.expected.value, 0).toFixed(2)}`,
        write: () => importRegistryPlan(ctx.client, plan),
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
      applied = out.status === "applied";
      const res = out.status === "applied" ? out.result : out.dry;
      Object.assign(summary, importSummary(res));
      log.status = out.status;
      log.result = importSummary(res);
    } else {
      summary.mode = "verify-only (อ่านอย่างเดียว)";
      log.status = "verify-only";
    }

    if (applied || verifyOnly) {
      const v = await verifyRegistryImport(ctx.client, plan);
      summary.verify = {
        ok: v.ok,
        totals: v.totals,
        branches: v.branches.map((b) => ({
          branch: b.branch,
          contracts: `${b.dbContracts}/${b.plannedContracts}`,
          expected: `${b.expected.cust} / ${b.expected.value.toFixed(2)}`,
          actual: `${b.actual.cust} / ${b.actual.value.toFixed(2)}`,
          addresses: `${b.addresses.actual}/${b.addresses.expected}`,
          mismatches: b.mismatches,
        })),
      };
      log.verify = summary.verify;
      console.log(JSON.stringify(summary, null, 2));
      if (!v.ok) {
        log.status = `${String(log.status)} · verify ไม่ผ่าน`;
        process.exitCode = 2;
      }
      return;
    }
    summary.expectedOct = plan.branches.map((b) => ({
      branch: b.branch,
      contracts: b.contracts.length,
      withAddress: b.addresses.withAddress,
      cust: b.expected.cust,
      value: b.expected.value.toFixed(2),
    }));
    log.expectedOct = summary.expectedOct;
    console.log(JSON.stringify(summary, null, 2));
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
