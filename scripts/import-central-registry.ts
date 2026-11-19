/**
 * นำเข้าทะเบียนส่วนกลาง OCT.26 (24 สาขา · 8 ไฟล์) → customers / contracts / contract_teams · **ฐานข้อมูลในเครื่องเท่านั้น**
 * (ตรรกะ: lib/import/registryImportPlan.ts = แผน · lib/import/registryDbImport.ts = เขียน + ตรวจยอด)
 *
 * วิธีรัน (ต้องได้คิวฐานข้อมูลในเครื่องจาก HQ ก่อน — DB local มีตัวเดียว ใช้ร่วมกันทุก worktree):
 *   ตรวจอย่างเดียว (ค่าเริ่มต้น ไม่เขียน):
 *     npx vite-node --config vitest.config.ts scripts/import-central-registry.ts -- --fixtures "<path>/fixtures"
 *   เขียนจริง (แล้วตรวจยอดต่อทันที):
 *     npx vite-node --config vitest.config.ts scripts/import-central-registry.ts -- --fixtures "<path>/fixtures" --apply
 *   ตรวจยอดอย่างเดียว (หลังนำเข้าแล้ว · อ่านอย่างเดียว):
 *     npx vite-node --config vitest.config.ts scripts/import-central-registry.ts -- --fixtures "<path>/fixtures" --verify-only
 *
 * env ที่ต้องมี (ค่าจาก `npx supabase status` ของเครื่องตัวเอง · ห้าม commit):
 *   NEXT_PUBLIC_SUPABASE_URL   เช่น http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY  service role ของ Supabase local
 *
 * ด่านกันพลาด:
 *   - URL ต้องเป็น localhost / 127.0.0.1 เท่านั้น — ชี้ cloud = หยุดทันที (cloud ต้องเจ้าของอนุมัติแยก)
 *   - ต่อผ่าน PostgREST (service_role) ไม่ต่อด้วย role postgres (CLAUDE.md กฎ Deploy) · ไม่ import lib/supabase/admin.ts (M21b)
 *   - เกณฑ์ Tier อ่านจาก tier_rules ใน DB (กฎ 3) · ตัวเลือกนำเข้า = REGISTRY_IMPORT_OPTIONS ตัวเดียวกับ dry-run
 *   - มีลูกค้าในสาขาเป้าหมาย / มีเลขสัญญาในแผนอยู่แล้ว = หยุด (รันซ้ำไม่เกิดแถวซ้ำ)
 *   - พิมพ์เฉพาะตัวเลขรวม/เลขแถว ไม่พิมพ์ชื่อลูกค้า เบอร์ ผู้ขาย หรือ key (PDPA)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadCentralRegistry, loadSellerIndex, hasAllCentralFiles } from "../lib/import/centralRegistryFiles";
import { importRegistryPlan, safeDbError, verifyRegistryImport } from "../lib/import/registryDbImport";
import { REGISTRY_IMPORT_BATCH_OCT26 } from "../lib/import/centralRegistrySheets";
import { planRegistryImport } from "../lib/import/registryImportPlan";
import { TIER_RULE_COLUMNS, toTierRules, type TierRuleRow } from "../lib/tierRules";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MONTH = "2026-10";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readTierRules(client: SupabaseClient) {
  const { data, error } = await client.from("tier_rules").select(TIER_RULE_COLUMNS);
  if (error) throw new Error(`อ่าน tier_rules ไม่สำเร็จ: ${safeDbError(error)}`);
  const rules = toTierRules((data ?? []) as unknown as TierRuleRow[]);
  if (rules.length === 0) throw new Error("tier_rules ว่าง — หยุด");
  return rules;
}

async function main(): Promise<void> {
  const dir = arg("--fixtures") ?? process.env.AGA_FIXTURES_DIR;
  const apply = process.argv.includes("--apply");
  const verifyOnly = process.argv.includes("--verify-only");
  if (!dir) throw new Error("ต้องระบุ --fixtures <โฟลเดอร์ fixtures> (หรือ env AGA_FIXTURES_DIR)");
  if (apply && verifyOnly) throw new Error("ใช้ --apply กับ --verify-only พร้อมกันไม่ได้");
  if (!hasAllCentralFiles(dir)) throw new Error("ไฟล์ทะเบียน OCT.26 ไม่ครบ 8 ไฟล์ในโฟลเดอร์ที่ระบุ");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY");
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error(`หยุด: ${new URL(url).hostname} ไม่ใช่ฐานข้อมูลในเครื่อง (สคริปต์นี้ห้ามเขียน cloud)`);
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const central = loadCentralRegistry(dir);
  const plan = planRegistryImport(
    central.sheets.map((s) => ({ sheet: s.sheet, branch: s.branch, grid: s.grid })),
    { rules: await readTierRules(client), month: MONTH, sellerIndex: loadSellerIndex(dir), importBatch: REGISTRY_IMPORT_BATCH_OCT26 },
  );

  const summary: Record<string, unknown> = {
    month: MONTH,
    skippedSheets: central.skipped.map((s) => `${s.sheet} (${s.reason})`),
    plan: {
      branches: plan.branches.length,
      ...plan.totals,
      saleName: plan.branches.reduce((n, b) => n + b.sellers.saleName, 0),
      amName: plan.branches.reduce((n, b) => n + b.sellers.amName, 0),
      placeholderNames: plan.branches.reduce((n, b) => n + b.placeholderNames, 0),
      sameNameGroups: plan.branches.reduce((n, b) => n + b.sameNameGroups.groups, 0),
      sameNameRows: plan.branches.reduce((n, b) => n + b.sameNameGroups.rows, 0),
      heldRows: plan.branches.filter((b) => b.heldRows.length).map((b) => `${b.branch}: ${b.heldRows.map((h) => h.excelRow).join(", ")}`),
      phones: {
        rowsWithPhones: plan.branches.reduce((n, b) => n + b.phones.rowsWithPhones, 0),
        phones: plan.branches.reduce((n, b) => n + b.phones.phones, 0),
        emptyRows: plan.branches.reduce((n, b) => n + b.phones.emptyRows, 0),
        invalidRows: plan.branches.reduce((n, b) => n + b.phones.invalidRows, 0),
        byBranch: plan.branches.map((b) => `${b.branch}: เบอร์ ${b.phones.phones} · ว่าง ${b.phones.emptyRows} · ผิดรูป ${b.phones.invalidRows}`),
      },
    },
  };

  if (!verifyOnly) {
    const res = await importRegistryPlan(client, plan, { dryRun: !apply });
    summary.mode = res.dryRun ? "dry-run (ไม่เขียน)" : "apply";
    summary.existing = res.existing;
    summary.planned = res.planned;
    summary.written = res.written;
  } else {
    summary.mode = "verify-only (อ่านอย่างเดียว)";
  }

  if (apply || verifyOnly) {
    const v = await verifyRegistryImport(client, plan);
    summary.verify = {
      ok: v.ok,
      totals: v.totals,
      branches: v.branches.map((b) => ({
        branch: b.branch,
        contracts: `${b.dbContracts}/${b.plannedContracts}`,
        expected: `${b.expected.cust} / ${b.expected.value.toFixed(2)}`,
        actual: `${b.actual.cust} / ${b.actual.value.toFixed(2)}`,
        mismatches: b.mismatches,
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!v.ok) process.exit(2);
    return;
  }
  summary.expectedOct = plan.branches.map((b) => ({ branch: b.branch, contracts: b.contracts.length, cust: b.expected.cust, value: b.expected.value.toFixed(2) }));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
