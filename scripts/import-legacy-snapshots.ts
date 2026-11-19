/**
 * นำเข้า dashboard_data.json เดิม → monthly_branch_snapshots (source='legacy')
 * (DECISIONS 2.72 ก · ตรรกะอยู่ที่ lib/import/legacySnapshotImport.ts · ด่าน cloud อยู่ที่ lib/import/cloudGuard.ts)
 *
 * วิธีรัน — ฐานข้อมูลในเครื่อง (ต้องได้คิว DB local จาก HQ ก่อน — มีตัวเดียว ใช้ร่วมกันทุก worktree):
 *   ตรวจอย่างเดียว (ค่าเริ่มต้น ไม่เขียน):
 *     npx vite-node --config vitest.config.ts scripts/import-legacy-snapshots.ts -- --file "<path>/fixtures/dashboard_data.json"
 *   เขียนจริง:
 *     npx vite-node --config vitest.config.ts scripts/import-legacy-snapshots.ts -- --file "<path>/fixtures/dashboard_data.json" --apply
 *
 * วิธีรัน — cloud (**เฉพาะวันที่เจ้าของสั่ง** · แผน docs/แผนนำเข้า-cloud-23พย2569.md · รันใน PowerShell / Windows Terminal):
 *   ... -- --target cloud --project-ref <ref> --log-dir "<โฟลเดอร์นอก repo>" --file "<path>/dashboard_data.json"           (dry-run)
 *   ... -- --target cloud --project-ref <ref> --log-dir "<โฟลเดอร์นอก repo>" --file "<path>/dashboard_data.json" --apply   (เขียน)
 *   --apply บน cloud: สคริปต์ dry-run ในตัวก่อน แสดงตัวเลข แล้วต้องพิมพ์ `นำเข้า <จำนวนแถว>` ตรงตัว (เช่น `นำเข้า 903`)
 *   ไม่ตรง/ไม่พิมพ์ = ไม่เขียน · ไม่มี flag ข้ามการยืนยัน
 *
 *   (`--config vitest.config.ts` กัน vite โหลด PostCSS ของ Tailwind ซึ่งพังนอก Next.js)
 *
 * env ที่ต้องมี (ตั้งในเทอร์มินัลตอนรันเท่านั้น · ห้าม commit · ห้ามวางในแชท):
 *   NEXT_PUBLIC_SUPABASE_URL   local เช่น http://127.0.0.1:54321 · cloud = https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  service role ของปลายทาง
 *   AGA_CLOUD_PROJECT_REF      (cloud) ref เดียวกับ --project-ref และ subdomain ของ URL
 *   AGA_IMPORT_LOG_DIR         (ทางเลือกแทน --log-dir) โฟลเดอร์ log นอก repo · cloud บังคับมี
 *
 * ด่านกันพลาด:
 *   - ไม่ใส่ --target = localhost / 127.0.0.1 เท่านั้น (เหมือนเดิม) · --target cloud = ตรวจ ref 3 ที่ + ยืนยันพิมพ์
 *   - ต่อผ่าน PostgREST (service_role) ไม่ต่อด้วย role postgres (CLAUDE.md กฎ Deploy)
 *   - ไม่ import lib/supabase/admin.ts (กฎ M21b) — สร้าง client เฉพาะในสคริปต์ ใช้แค่ตาราง snapshot
 *   - พิมพ์/บันทึกเฉพาะตัวเลขรวม ไม่พิมพ์ key/URL (log ผ่านตัวลบค่าลับ)
 */
import { readFileSync } from "node:fs";

import { runGuarded } from "../lib/import/cloudGuard";
import { importLegacySnapshots, type LegacyImportResult } from "../lib/import/legacySnapshotImport";
import { errorText, flag, setupScript } from "./_cloudCli";

function summarize(res: LegacyImportResult): Record<string, unknown> {
  const months = res.conversion.months;
  return {
    mode: res.dryRun ? "dry-run (ไม่เขียน)" : "apply",
    goLiveMonth: res.goLiveMonth,
    months: `${months[0]} … ${months[months.length - 1]} (${months.length})`,
    skippedKeys: res.conversion.skippedKeys,
    rows: res.conversion.rows.length,
    existingLegacyBefore: res.existingLegacyBefore,
    written: res.written,
    areaDifferences: res.conversion.areaDifferences.length,
    totalCust: res.totals.reduce((s, t) => s + t.cust, 0),
    totalValue: res.totals.reduce((s, t) => s + t.valueCents, 0) / 100,
    totals: res.totals.map((t) => ({ ...t, value: t.valueCents / 100 })),
  };
}

async function main(): Promise<void> {
  const file = flag("--file");
  if (!file) throw new Error("ต้องระบุ --file <path ของ dashboard_data.json>");
  const ctx = setupScript("import-legacy-snapshots");
  const log: Record<string, unknown> = { status: "error" };
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    const out = await runGuarded({
      target: ctx.target,
      apply: ctx.apply,
      action: "import",
      dryRun: () => importLegacySnapshots(ctx.client, data, { dryRun: true }),
      confirmCount: (d) => d.conversion.rows.length,
      describe: (d) =>
        `[cloud dry-run] จะเขียน snapshot legacy ${d.conversion.rows.length} แถว · ${d.conversion.months.length} เดือน` +
        ` · legacy เดิม ${d.existingLegacyBefore} แถว · cust รวม ${d.totals.reduce((s, t) => s + t.cust, 0)}` +
        ` · มูลค่ารวม ${(d.totals.reduce((s, t) => s + t.valueCents, 0) / 100).toFixed(2)}`,
      write: () => importLegacySnapshots(ctx.client, data),
      ask: ctx.ask,
      isTTY: ctx.isTTY,
      print: (t) => console.log(t),
    });

    if (out.status === "aborted") {
      Object.assign(log, { status: "aborted", reason: out.reason, dryRun: summarize(out.dry) });
      console.log(out.reason);
      process.exitCode = 3;
      return;
    }
    const res = out.status === "applied" ? out.result : out.dry;
    const summary = summarize(res);
    Object.assign(log, { status: out.status, result: summary });
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
