/**
 * ชั้นอ่านข้อมูลหน้า "Dashboard Sync" (ฝั่ง server จาก page.tsx)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้จริง (host) — RLS ตาราง `sync_logs` อนุญาตเฉพาะ host อ่าน · ไม่ใช้ service role
 *   * เลือกเฉพาะคอลัมน์ที่หน้าจอใช้ — **ไม่ดึง `error_message`** (ข้อความดิบ) มาที่ client เลย แสดงแค่ `error_code` แล้วแปลงเป็นไทย
 *   * ชื่อผู้กดมาจาก `profiles.display_name` (host อ่านได้) · ไม่พบ = null (หน้าจอแสดง "ผู้ดูแลระบบ")
 *   * `isTokenConfigured()` คืนแค่ true/false ว่ามี `DASHBOARD_GITHUB_TOKEN` หรือไม่ — **ไม่ส่งค่า token ไปไหนทั้งสิ้น**
 *   * อ่านพลาด = `data: null` (หน้าแจ้งข้อผิดพลาด ไม่แสดงเหมือนยังไม่เคยส่ง)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SyncLogRow, SyncResult, SyncSource } from "./syncLogic";

/** จำนวนรอบล่าสุดที่โหลด (เกินนี้ยังอยู่ในฐานข้อมูล ไม่ถูกลบ) */
export const SYNC_LOG_LIMIT = 300;

type SyncLogDb = {
  id: number;
  source: string;
  triggered_by: string | null;
  started_at: string;
  finished_at: string | null;
  result: string | null;
  error_code: string | null;
  months_sent: string[] | null;
  month_count: number | null;
  commit_sha: string | null;
};

const SOURCES: readonly string[] = ["auto", "manual", "close", "resync", "export"];
const RESULTS: readonly string[] = ["success", "skipped", "failed"];

/** มี token ใน env หรือไม่ (ฝั่ง server เท่านั้น · ไม่คืนค่า token) */
export function isTokenConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DASHBOARD_GITHUB_TOKEN?.trim());
}

/** ปลายทางที่แสดงในหน้า (ไม่ใช่ความลับ — ค่าตั้งต้นตาม SPEC §9.2) */
export function destinationFromEnv(env: Record<string, string | undefined> = process.env): { repo: string; branch: string } {
  const repo = env.DASHBOARD_GITHUB_REPO?.trim();
  const branch = env.DASHBOARD_GITHUB_BRANCH?.trim();
  return {
    repo: repo && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo) ? repo : "13azukaoab/AGA-Bait-Dashboard",
    branch: branch && /^[A-Za-z0-9._/-]+$/.test(branch) ? branch : "main",
  };
}

export function toSyncLogRow(row: SyncLogDb, names: ReadonlyMap<string, string>): SyncLogRow | null {
  if (!SOURCES.includes(row.source)) return null;
  const result = row.result === null ? null : RESULTS.includes(row.result) ? (row.result as SyncResult) : undefined;
  if (result === undefined) return null;
  return {
    id: row.id,
    source: row.source as SyncSource,
    triggeredByName: row.triggered_by ? (names.get(row.triggered_by) ?? null) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result,
    errorCode: row.error_code,
    monthsSent: row.months_sent ?? [],
    monthCount: row.month_count,
    commitSha: row.commit_sha,
  };
}

export async function loadSyncLogs(supabase: SupabaseClient): Promise<{ data: SyncLogRow[] | null }> {
  const { data, error } = await supabase
    .from("sync_logs")
    .select("id, source, triggered_by, started_at, finished_at, result, error_code, months_sent, month_count, commit_sha")
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(SYNC_LOG_LIMIT);
  if (error || !data) return { data: null };

  const rows = data as SyncLogDb[];
  const ids = [...new Set(rows.map((r) => r.triggered_by).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    // ชื่อไม่สำคัญพอจะทำให้หน้าล้ม — อ่านพลาดก็แสดงเป็น "ผู้ดูแลระบบ"
    const { data: profiles } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids);
    for (const p of (profiles ?? []) as { user_id: string; display_name: string | null }[]) {
      if (p.display_name) names.set(p.user_id, p.display_name);
    }
  }
  return { data: rows.map((r) => toSyncLogRow(r, names)).filter((r): r is SyncLogRow => r !== null) };
}
