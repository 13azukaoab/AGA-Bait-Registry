/**
 * นำเข้า dashboard_data.json เดิม → monthly_branch_snapshots (source='legacy') · **ฐานข้อมูลในเครื่องเท่านั้น**
 * (DECISIONS 2.72 ก · ตรรกะอยู่ที่ lib/import/legacySnapshotImport.ts)
 *
 * วิธีรัน (ต้องได้คิวฐานข้อมูลในเครื่องจาก HQ ก่อน — DB local มีตัวเดียว ใช้ร่วมกันทุก worktree):
 *   ตรวจอย่างเดียว (ค่าเริ่มต้น ไม่เขียน):
 *     npx vite-node --config vitest.config.ts scripts/import-legacy-snapshots.ts -- --file "<path>/fixtures/dashboard_data.json"
 *   เขียนจริง:
 *     npx vite-node --config vitest.config.ts scripts/import-legacy-snapshots.ts -- --file "<path>/fixtures/dashboard_data.json" --apply
 *
 *   (`--config vitest.config.ts` กัน vite โหลด PostCSS ของ Tailwind ซึ่งพังนอก Next.js)
 *
 * env ที่ต้องมี (ค่าจาก `npx supabase status` ของเครื่องตัวเอง · ห้าม commit):
 *   NEXT_PUBLIC_SUPABASE_URL   เช่น http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY  service role ของ Supabase local
 *
 * ด่านกันพลาด:
 *   - URL ต้องเป็น localhost / 127.0.0.1 เท่านั้น — ชี้ cloud = หยุดทันที (cloud เจ้าของสั่งทีหลัง)
 *   - ต่อผ่าน PostgREST (service_role) ไม่ต่อด้วย role postgres (CLAUDE.md กฎ Deploy)
 *   - ไม่ import lib/supabase/admin.ts (กฎ M21b) — สร้าง client เฉพาะในสคริปต์นี้ ใช้แค่ตาราง snapshot
 *   - พิมพ์เฉพาะตัวเลขรวม ไม่พิมพ์ key
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { importLegacySnapshots } from "../lib/import/legacySnapshotImport";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const file = arg("--file");
  const apply = process.argv.includes("--apply");
  if (!file) throw new Error("ต้องระบุ --file <path ของ dashboard_data.json>");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY");
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error(`หยุด: ${new URL(url).hostname} ไม่ใช่ฐานข้อมูลในเครื่อง (สคริปต์นี้ห้ามเขียน cloud)`);
  }

  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const res = await importLegacySnapshots(client, data, { dryRun: !apply });

  const months = res.conversion.months;
  console.log(
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
