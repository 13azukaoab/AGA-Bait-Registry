/**
 * ถอยการนำเข้า (แผนนำเข้า cloud หัวข้อ 3 ข้อ 6 + หัวข้อ 5) — แทนการให้คนพิมพ์ SQL ลบเองตอนตกใจ
 * (ตรรกะ + ด่านหยุด: lib/import/importRollback.ts · ด่าน cloud: lib/import/cloudGuard.ts)
 *
 * 2 แบบ (เลือกอย่างใดอย่างหนึ่ง):
 *   --batch registry-OCT26   ถอยทะเบียน: ลบสัญญาของ import_batch นั้น (ทีมหายตาม) → ลูกค้าของสัญญาเหล่านั้น (เบอร์หายตาม)
 *                            หยุดถ้ามี visits / สัญญาในแอปบนลูกค้านำเข้า / สัญญาต่ออายุที่อ้างสัญญานำเข้า
 *   --legacy                 ถอย legacy: ลบ monthly_branch_snapshots source='legacy' เดือน 2025-01 … 2026-09
 *
 * วิธีรัน — ฐานข้อมูลในเครื่อง (ต้องได้คิว DB local จาก HQ ก่อน):
 *   ตรวจอย่างเดียว (ค่าเริ่มต้น ไม่ลบ):
 *     npx vite-node --config vitest.config.ts scripts/rollback-registry-import.ts -- --batch registry-OCT26
 *   ลบจริง:
 *     npx vite-node --config vitest.config.ts scripts/rollback-registry-import.ts -- --batch registry-OCT26 --apply
 *
 * วิธีรัน — cloud (**เฉพาะเมื่อเจ้าของตัดสินให้ถอย** · รันใน PowerShell / Windows Terminal):
 *   เพิ่ม `--target cloud --project-ref <ref> --log-dir "<โฟลเดอร์นอก repo>"`
 *   --apply บน cloud: dry-run ในตัวก่อน แสดงตัวเลข แล้วต้องพิมพ์ `ลบ <จำนวน>` ตรงตัว
 *   (ทะเบียน = จำนวนสัญญา เช่น `ลบ 2369` · legacy = จำนวนแถว เช่น `ลบ 903`) · ไม่ตรง/ไม่พิมพ์ = ไม่ลบ · ไม่มี flag ข้าม
 *   ซ้อมพิมพ์คำยืนยันกับ DB ในเครื่อง: ใส่ `--apply --confirm` (localhost จะถามแบบเดียวกับ cloud)
 *
 * env: NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · (cloud) AGA_CLOUD_PROJECT_REF · AGA_IMPORT_LOG_DIR หรือ --log-dir
 * ต่อผ่าน PostgREST ด้วย service_role เท่านั้น (ห้าม role postgres) · พิมพ์/บันทึกเฉพาะตัวเลข (+ id ลูกค้าที่ค้างถ้าลบไม่ครบ)
 * ⚠ contract_files: แถวหายตามสัญญา แต่ไฟล์ใน Storage ไม่หาย (dry-run บอกจำนวน · หลังนำเข้าใหม่ๆ ต้องเป็น 0)
 */
import { runGuarded, type GuardedRunResult } from "../lib/import/cloudGuard";
import {
  RollbackIncompleteError,
  applyLegacyRollback,
  applyRegistryRollback,
  assertImportBatch,
  describeBlockers,
  planLegacyRollback,
  planRegistryRollback,
  type LegacyRollbackPlan,
  type RegistryRollbackPlan,
} from "../lib/import/importRollback";
import { errorText, flag, hasFlag, setupScript, type ScriptContext } from "./_cloudCli";

function describeRegistry(p: RegistryRollbackPlan): string {
  return (
    `[dry-run] batch ${p.batch}: จะลบ สัญญา ${p.contracts} · ลูกค้า ${p.customers}` +
    ` · หายตาม: ทีม ${p.cascades.contractTeams} · เบอร์ ${p.cascades.customerPhones} · สถานี ${p.cascades.stations}` +
    ` · ไฟล์สัญญา ${p.cascades.contractFiles} · ตกบริการ(ผลแก้) ${p.cascades.missedServiceResolutions}` +
    ` · ตกบริการ(โน้ต) ${p.cascades.missedServiceNotes} · ย้ายสถานี ${p.cascades.stationTransfers}` +
    `\nด่านหยุด: ${describeBlockers(p.blockers)}${p.blocked ? " → ⛔ ลบไม่ได้ ใช้ทางกู้จากสำรอง (แผน 5.3)" : " → ผ่าน"}`
  );
}

function describeLegacy(p: LegacyRollbackPlan): string {
  return `[dry-run] legacy 2025-01 … 2026-09: จะลบ ${p.legacyRows} แถว · ${p.months} เดือน · แถว source อื่นในช่วง (ไม่ลบ) ${p.otherSourceRows}`;
}

function rollbackRegistry(ctx: ScriptContext, batch: string) {
  return runGuarded({
    target: ctx.target,
    apply: ctx.apply,
    action: "rollback",
    dryRun: () => planRegistryRollback(ctx.client, batch),
    confirmCount: (p) => (p.blocked ? 0 : p.contracts), // blocked = ไม่ถาม ไม่ลบ
    describe: describeRegistry,
    // cloud: ล็อกจำนวนที่คนพิมพ์ยืนยัน · local --apply: จำนวน ณ ตอนนี้ (ด่าน blocked ยังทำงานใน apply)
    write: async (dry) => applyRegistryRollback(ctx.client, batch, (dry ?? (await planRegistryRollback(ctx.client, batch))).contracts),
    ask: ctx.ask,
    isTTY: ctx.isTTY,
    forceConfirm: ctx.forceConfirm,
    print: (t) => console.log(t),
  });
}

function rollbackLegacy(ctx: ScriptContext) {
  return runGuarded({
    target: ctx.target,
    apply: ctx.apply,
    action: "rollback",
    dryRun: () => planLegacyRollback(ctx.client),
    confirmCount: (p) => p.legacyRows,
    describe: describeLegacy,
    write: async (dry) => applyLegacyRollback(ctx.client, (dry ?? (await planLegacyRollback(ctx.client))).legacyRows),
    ask: ctx.ask,
    isTTY: ctx.isTTY,
    forceConfirm: ctx.forceConfirm,
    print: (t) => console.log(t),
  });
}

async function main(): Promise<void> {
  const legacy = hasFlag("--legacy");
  const batchArg = flag("--batch");
  if (legacy === (batchArg !== undefined)) throw new Error("ต้องเลือกอย่างใดอย่างหนึ่ง: --batch <รหัสชุดนำเข้า> หรือ --legacy");
  const batch = legacy ? undefined : assertImportBatch(batchArg);

  const ctx = setupScript(legacy ? "rollback-legacy" : "rollback-registry");
  const log: Record<string, unknown> = { status: "error", kind: legacy ? "legacy" : "registry", batch: batch ?? null };
  try {
    const out: GuardedRunResult<unknown, unknown> = batch ? await rollbackRegistry(ctx, batch) : await rollbackLegacy(ctx);
    log.status = out.status;
    if (out.status === "aborted") {
      Object.assign(log, { reason: out.reason, dryRun: out.dry });
      console.log(out.reason);
      process.exitCode = 3;
      return;
    }
    if (out.status === "dry-run") {
      log.dryRun = out.dry;
      console.log(batch ? describeRegistry(out.dry as RegistryRollbackPlan) : describeLegacy(out.dry as LegacyRollbackPlan));
      if (batch && (out.dry as RegistryRollbackPlan).blocked) process.exitCode = 2;
      return;
    }
    Object.assign(log, { dryRun: out.dry ?? null, result: out.result });
    console.log(JSON.stringify({ mode: "apply", ...(out.result as object) }, null, 2));
  } catch (e) {
    log.error = errorText(e, ctx.redact);
    if (e instanceof RollbackIncompleteError) {
      Object.assign(log, {
        deletedContracts: e.deletedContracts,
        deletedCustomers: e.deletedCustomers,
        orphanCustomerIds: e.orphanCustomerIds, // uuid เท่านั้น (ไม่ใช่ข้อมูลส่วนบุคคล) ไว้ลบต่อ
      });
    }
    throw e;
  } finally {
    ctx.finishLog(log);
  }
}

main().catch((e: unknown) => {
  console.error(errorText(e));
  process.exit(1);
});
