/**
 * ตัวช่วยร่วมของสคริปต์นำเข้า/ถอย: อ่าน env + flag ปลายทาง · สร้าง client service_role · ถามยืนยันในเทอร์มินัล · log นอก repo
 * (ตรรกะด่านทั้งหมดอยู่ที่ lib/import/cloudGuard.ts ซึ่งมีเทส — ไฟล์นี้แค่ต่อ process.env / stdin / fs เข้าไป)
 *
 * ห้าม import lib/supabase/admin.ts (กฎ M21b) · ต่อผ่าน PostgREST ด้วย service_role เท่านั้น (ห้าม role postgres)
 */
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  ENV_CLOUD_PROJECT_REF,
  ENV_LOG_DIR,
  makeRedactor,
  readFlag,
  resolveImportTarget,
  resolveLogFile,
  writeRunLog,
  type ImportTarget,
} from "../lib/import/cloudGuard";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

export interface ScriptContext {
  target: ImportTarget;
  client: SupabaseClient;
  apply: boolean;
  /** ข้อความที่ผ่านตัวลบค่าลับ (URL/key/ref) */
  redact: (text: string) => string;
  /** เขียน log (ถ้ามีโฟลเดอร์) — เรียกครั้งเดียวตอนจบ */
  finishLog: (entry: Record<string, unknown>) => void;
  ask: (prompt: string) => Promise<string | null>;
  isTTY: boolean;
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function flag(name: string): string | undefined {
  return readFlag(process.argv, name);
}

/** ถามหนึ่งบรรทัด · ปิด input/EOF = null */
async function askLine(prompt: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const closed = new Promise<null>((res) => rl.once("close", () => res(null)));
    return await Promise.race([rl.question(prompt), closed]);
  } finally {
    rl.close();
  }
}

/** อ่าน env + flag → ปลายทาง + client + log (ดูด่านใน lib/import/cloudGuard.ts) */
export function setupScript(script: string): ScriptContext {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY");

  const target = resolveImportTarget({
    target: flag("--target"),
    projectRef: flag("--project-ref"),
    url,
    envRef: process.env[ENV_CLOUD_PROJECT_REF],
  });
  const redact = makeRedactor([url, key, target.kind === "cloud" ? target.ref : undefined]);
  const startedAt = new Date();
  const logFile = resolveLogFile({
    target,
    repoRoot: REPO_ROOT,
    script,
    logDir: flag("--log-dir"),
    envLogDir: process.env[ENV_LOG_DIR],
    now: startedAt,
  });
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const apply = hasFlag("--apply");

  return {
    target,
    client,
    apply,
    redact,
    ask: askLine,
    isTTY: process.stdin.isTTY === true,
    finishLog: (entry) => {
      if (!logFile) return;
      writeRunLog(
        logFile,
        { script, target: target.kind, apply, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), ...entry },
        redact,
      );
      console.error(`บันทึกผลที่: ${logFile}`);
    },
  };
}

/** ตัวลบค่าลับจาก env ปัจจุบัน (ใช้ตอน error ก่อน setupScript เสร็จ) */
function envRedactor(): (t: string) => string {
  return makeRedactor([
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env[ENV_CLOUD_PROJECT_REF],
  ]);
}

/** ข้อความ error ที่ปลอดภัยสำหรับพิมพ์/เก็บ log (ลบ URL/key/ref ออก) */
export function errorText(e: unknown, redact: (t: string) => string = envRedactor()): string {
  return redact(e instanceof Error ? e.message : String(e));
}
