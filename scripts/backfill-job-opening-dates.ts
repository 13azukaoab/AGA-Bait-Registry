/**
 * เติม contracts.mail_received_date / first_service_date / first_service_time ให้สัญญานำเข้าทะเบียน (batch registry-OCT26)
 * จากไฟล์เปิดงาน "รายชื่อลูกค้าเปิดงาน ปี2569.xlsx" — เติมเฉพาะช่องที่ว่าง ไม่ทับค่าที่มี
 * (ตรรกะ: lib/import/jobOpeningServiceDates.ts = อ่านไฟล์ · jobOpeningBackfill.ts = แผน · jobOpeningBackfillDb.ts = อ่าน/เขียน DB)
 *
 * โหมด (รันใน PowerShell / Windows Terminal · ทุกโหมดต้องมี --fixtures):
 *   1) ไฟล์อย่างเดียว (ค่าเริ่ม · ไม่ต่อ DB ไม่ต้องตั้ง env):
 *        npx vite-node --config vitest.config.ts scripts/backfill-job-opening-dates.ts -- --fixtures "<path>/fixtures"
 *      → จับคู่กับแผนนำเข้าทะเบียน 2,369 สัญญา (สร้างจากไฟล์ทะเบียนด้วยโค้ดตัวนำเข้า) · ถือว่า 3 ช่องว่างทั้งหมด
 *   2) --db  dry-run อ่าน DB จริง (อ่านอย่างเดียว · select เท่านั้น · ไม่ถามยืนยัน):
 *        ... -- --fixtures "<path>/fixtures" --db                                    (DB ในเครื่อง · ต้องได้คิว DB จาก HQ)
 *        ... -- --fixtures "<path>/fixtures" --db --target cloud --project-ref <ref> --log-dir "<นอก repo>"   (HQ เป็นคนรัน)
 *      → จับคู่กับสัญญาบน DB จริง · ช่องที่มีค่าแล้วไม่นับ · สัญญาที่ไม่มีใน DB / batch อื่น / ปิด-ยกเลิก นับแยก
 *   3) --apply  เขียนจริง (เติมเฉพาะช่องว่าง · PATCH ทีละสัญญาผ่าน PostgREST service_role):
 *        ... -- --fixtures "<path>/fixtures" --apply --log-dir "<นอก repo>"          (local · ใส่ --confirm เพื่อซ้อมพิมพ์ยืนยัน)
 *        ... -- --fixtures "<path>/fixtures" --apply --target cloud --project-ref <ref> --log-dir "<นอก repo>"
 *      cloud: dry-run ในตัว → แสดงตัวเลข → ต้องพิมพ์ `นำเข้า <จำนวนสัญญาที่จะแก้>` ตรงตัว · ไม่ตรง = ไม่เขียน
 *      ทุกสัญญาที่เขียนสำเร็จต่อท้าย run log (`backfill-job-opening-dates-runlog-<เวลา>.jsonl` ในโฟลเดอร์ log) ทันที
 *   4) --rollback <run log>  ถอยกลับ (ตั้งเป็น NULL เฉพาะช่องที่รอบนั้นเติม และค่ายังเท่าเดิม):
 *        ... -- --fixtures "<path>/fixtures" --rollback "<run log>.jsonl"            (ไม่ใส่ --apply = นับอย่างเดียว)
 *        ... -- --fixtures "<path>/fixtures" --rollback "<run log>.jsonl" --apply [--target cloud ...]   (พิมพ์ `ลบ <n>`)
 *
 * ค่าเริ่มต้น = ผลตัดสินเจ้าของ DECISIONS 2.120 (28 พ.ย. 2026 · ไม่ต้องใส่ flag):
 *   ② ไฟล์ 2569 อย่างเดียว · ③ ไม่เติมสัญญาที่ "ผิดชัด" (Mail หลังวันบริการ / วันที่เลยวันนี้) แต่รายงานเลขสัญญา+เหตุผล
 *   ④ ไม่แตะสัญญาปิด/ยกเลิก · ⑤ ค่าซ้ำต่างกัน/อ่านไม่ได้ = ปล่อยว่าง · ⑥ วันบริการหลายวัน = วันแรก (ตัวอ่านไฟล์)
 *   (① /sales นับสัญญานำเข้าตามวันเริ่มเสมอ — แก้ที่ components/sales-dashboard/salesData.ts ไม่ใช่สคริปต์นี้)
 *
 * ตัวเลือก (เปลี่ยนจากค่าที่เจ้าของตัดสิน — ใช้เมื่อเจ้าของสั่งใหม่เท่านั้น):
 *   --include-2568            อ่านไฟล์เปิดงานปี 2568 ด้วย
 *   --batches <a,b>           import_batch ที่ยอมให้เติม (ค่าเริ่ม registry-OCT26 · เช่น เพิ่ม registry-OCT26-fix1)
 *   --include-closed          เติมสัญญาที่ปิด/ยกเลิกด้วย (ค่าเริ่ม = ไม่แตะ นับแยก)
 *   --skip-warned             ไม่เติมสัญญาที่มีคำเตือนทุกชนิด (รวม บริการก่อนวันเริ่ม / หลังวันสิ้นสุด)
 *   --fill-clearly-wrong      เติมสัญญาที่ผิดชัดด้วย (ยกเลิกข้อ ③)
 *
 * env (เฉพาะ --db / --apply / --rollback --apply · ตั้งในเทอร์มินัลตอนรันเท่านั้น · ห้าม commit · ห้ามวางในแชท):
 *   NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · AGA_CLOUD_PROJECT_REF (cloud) · AGA_IMPORT_LOG_DIR (แทน --log-dir)
 *
 * ด่านกันพลาด:
 *   - ปลายทาง/ยืนยัน/log ใช้ lib/import/cloudGuard.ts ตัวเดียวกับตัวนำเข้า (ref ตรง 3 ที่ · พิมพ์ยืนยัน · log นอก repo)
 *   - ต่อผ่าน PostgREST ด้วย service_role เท่านั้น (ห้าม role postgres · ไม่ import lib/supabase/admin.ts)
 *   - ไม่ปิด/ข้ามด่านใดใน DB (trigger ล็อกตรวจเฉพาะ authenticated · audit_log ลงทุกแถว · ดู jobOpeningBackfillDb.ts)
 *   - พิมพ์/บันทึกเฉพาะตัวเลข/เลขสัญญา/ชื่อชีท/เลขแถว — ไม่มีชื่อลูกค้า เบอร์ ที่อยู่ ผู้ขาย หรือ key/URL (PDPA)
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveLogFile, runGuarded } from "../lib/import/cloudGuard";
import { REGISTRY_IMPORT_BATCH_OCT26 } from "../lib/import/centralRegistrySheets";
import {
  CLEARLY_WRONG_WARNINGS,
  DEFAULT_SKIP_STATUSES,
  planJobOpeningBackfill,
  summarizeBackfill,
  type BackfillOptions,
  type BackfillPlan,
} from "../lib/import/jobOpeningBackfill";
import { applyBackfill, parseRunLog, readDbTargets, rollbackBackfill, type RunLogEntry } from "../lib/import/jobOpeningBackfillDb";
import { loadJobOpeningIndex, loadRegistryBackfillContext } from "../lib/import/jobOpeningBackfillFiles";
import { errorText, flag, hasFlag, setupScript } from "./_cloudCli";

const SCRIPT = "backfill-job-opening-dates";
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function describePlan(p: BackfillPlan): string {
  const c = p.counts;
  return (
    `[dry-run] สัญญาที่จะแก้ ${c.contractsToUpdate} · วันรับ Mail ${c.fills.mail} · วันบริการ ${c.fills.service} · เวลา ${c.fills.time}` +
    ` · มีค่าอยู่แล้ว (ตรง/ต่าง) Mail ${c.alreadySame.mail}/${c.alreadyDifferent.mail} วันบริการ ${c.alreadySame.service}/${c.alreadyDifferent.service}` +
    ` · batch อื่น ${Object.values(c.otherBatch).reduce((a, b) => a + b, 0)} · ปิด/ยกเลิก ${Object.values(c.skippedStatus).reduce((a, b) => a + b, 0)}` +
    ` · ไม่เจอใน DB ${p.jobsWithoutTarget.length} · Renew จะขึ้นล่าช้า ${p.salesImpact.lateRenewals}`
  );
}

/** run log (JSON Lines) นอก repo — เปิดตอนเขียนแถวแรก (wx = ไม่ทับไฟล์เดิม) */
function runLogWriter(target: Parameters<typeof resolveLogFile>[0]["target"], now: Date): { file: string; write: (e: RunLogEntry) => void } {
  const file = resolveLogFile({ target, repoRoot: REPO_ROOT, script: `${SCRIPT}-runlog`, logDir: flag("--log-dir"), envLogDir: process.env.AGA_IMPORT_LOG_DIR, now });
  if (!file) throw new Error("หยุด: --apply ต้องมีโฟลเดอร์ log นอก repo (--log-dir หรือ env AGA_IMPORT_LOG_DIR) — ใช้ถอยกลับ");
  const jsonl = file.replace(/\.json$/, ".jsonl");
  let opened = false;
  return {
    file: jsonl,
    write: (e) => {
      const line = `${JSON.stringify(e)}\n`;
      if (!opened) {
        writeFileSync(jsonl, line, { encoding: "utf8", flag: "wx" });
        opened = true;
      } else appendFileSync(jsonl, line, "utf8");
    },
  };
}

async function main(): Promise<void> {
  const dir = flag("--fixtures") ?? process.env.AGA_FIXTURES_DIR;
  if (!dir) throw new Error("ต้องระบุ --fixtures <โฟลเดอร์ fixtures> (หรือ env AGA_FIXTURES_DIR)");
  const rollbackFile = flag("--rollback");
  const useDb = hasFlag("--db") || hasFlag("--apply") || rollbackFile !== undefined;

  // ---- ถอยกลับ ----
  if (rollbackFile !== undefined) {
    const entries = parseRunLog(readFileSync(rollbackFile, "utf8"));
    const ctx = setupScript(`${SCRIPT}-rollback`);
    const log: Record<string, unknown> = { status: "error", mode: "rollback", entries: entries.length };
    try {
      const out = await runGuarded({
        target: ctx.target,
        apply: ctx.apply,
        action: "rollback",
        dryRun: async () => entries,
        confirmCount: (e) => e.length,
        describe: (e) => `[rollback dry-run] จะตั้งกลับเป็นว่าง ${e.length} สัญญา (เฉพาะช่องที่รอบนั้นเติม และค่ายังไม่ถูกแก้ต่อ)`,
        write: () => rollbackBackfill(ctx.client, entries),
        ask: ctx.ask,
        isTTY: ctx.isTTY,
        forceConfirm: ctx.forceConfirm,
        print: (t) => console.log(t),
      });
      if (out.status === "applied") Object.assign(log, { status: "applied", reverted: out.result.reverted, skipped: out.result.skipped });
      else Object.assign(log, { status: out.status, ...(out.status === "aborted" ? { reason: out.reason } : {}) });
      console.log(JSON.stringify(log, null, 2));
      if (out.status === "aborted") process.exitCode = 3;
    } catch (e) {
      log.error = errorText(e, ctx.redact);
      throw e;
    } finally {
      ctx.finishLog(log);
    }
    return;
  }

  // ---- แผน (ทุกโหมด) ----
  const index = loadJobOpeningIndex(dir, { includeYear2568: hasFlag("--include-2568") });
  const registry = loadRegistryBackfillContext(dir);
  const opts: BackfillOptions = {
    fillBatches: (flag("--batches") ?? REGISTRY_IMPORT_BATCH_OCT26).split(",").map((s) => s.trim()).filter(Boolean),
    skipStatuses: hasFlag("--include-closed") ? [] : DEFAULT_SKIP_STATUSES,
    skipWarned: hasFlag("--skip-warned"),
    skipWarnings: hasFlag("--fill-clearly-wrong") ? [] : CLEARLY_WRONG_WARNINGS,
    // วันนี้ตามเวลาไทย (UTC+7) — วันที่ในไฟล์ที่เลยวันนี้ = เตือน
    asOf: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10),
  };

  if (!useDb) {
    const plan = planJobOpeningBackfill(index, registry.targets, opts);
    const summary = summarizeBackfill(index, plan, registry.notFound);
    // ทางเลือกให้เจ้าของ: ถ้ารวมไฟล์ปี 2568 ด้วย จะเติมเพิ่มได้เท่าไร
    let with2568: unknown = "รวมอยู่แล้ว (--include-2568)";
    if (!hasFlag("--include-2568")) {
      const both = planJobOpeningBackfill(loadJobOpeningIndex(dir, { includeYear2568: true }), registry.targets, opts);
      with2568 = {
        contractsToUpdate: both.counts.contractsToUpdate,
        extraContracts: both.counts.contractsToUpdate - plan.counts.contractsToUpdate,
        fills: both.counts.fills,
        extraByStartMonth: Object.fromEntries(
          Object.entries(both.fillsByStartMonth)
            .map(([m, f]) => [m, f.mail - (plan.fillsByStartMonth[m]?.mail ?? 0)] as const)
            .filter(([, n]) => n !== 0),
        ),
        lateRenewals: both.salesImpact.lateRenewals,
      };
    }
    console.log(
      JSON.stringify(
        {
          mode: "file-only (ไม่ต่อ DB · ถือว่า 3 ช่องของ 2,369 สัญญาว่าง)",
          registryPlanContracts: registry.plan.totals.contracts,
          options: opts,
          summary,
          warningsContractNos: plan.warnings,
          skippedWarnedContracts: plan.skippedWarnedContracts,
          with2568,
        },
        null,
        2,
      ),
    );
    return;
  }

  // ---- โหมด DB ----
  const ctx = setupScript(SCRIPT);
  const log: Record<string, unknown> = { status: "error", mode: ctx.apply ? "apply" : "db dry-run", options: opts };
  try {
    const targets = await readDbTargets(ctx.client, { contractNos: [...index.entries.keys()], batches: opts.fillBatches });
    const plan = planJobOpeningBackfill(index, targets, opts);
    const summary = summarizeBackfill(index, plan, registry.notFound);
    log.summary = summary;
    log.warningsContractNos = plan.warnings;
    log.skippedWarnedContracts = plan.skippedWarnedContracts;
    log.differentContractNos = plan.differentContractNos;

    let runLog: ReturnType<typeof runLogWriter> | null = null;
    const out = await runGuarded({
      target: ctx.target,
      apply: ctx.apply,
      action: "import",
      dryRun: async () => plan,
      confirmCount: (p) => p.counts.contractsToUpdate,
      describe: describePlan,
      write: () => {
        runLog = runLogWriter(ctx.target, new Date());
        console.log(`run log (ใช้ถอยกลับ): ${runLog.file}`);
        return applyBackfill(ctx.client, plan.updates, {
          onWritten: runLog.write,
          onProgress: (done, total) => console.log(`เขียนแล้ว ${done}/${total}`),
        });
      },
      ask: ctx.ask,
      isTTY: ctx.isTTY,
      forceConfirm: ctx.forceConfirm,
      print: (t) => console.log(t),
    });
    if (out.status === "aborted") {
      Object.assign(log, { status: "aborted", reason: out.reason });
      console.log(out.reason);
      process.exitCode = 3;
      return;
    }
    log.status = out.status;
    if (out.status === "applied") {
      log.result = out.result;
      log.runLog = runLog ? (runLog as { file: string }).file : null;
    }
    console.log(JSON.stringify({ mode: log.mode, summary, result: log.result ?? null }, null, 2));
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
