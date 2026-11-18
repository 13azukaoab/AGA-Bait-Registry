/**
 * ตรรกะหน้า "Dashboard Sync" (SPEC §9.2 · จอ 10 · mockup FINAL `docs/mockup/dashboard-sync.html`) — pure function ล้วน
 *
 * Logic summary:
 *   * อ่านประวัติจากตาราง `sync_logs` (host อ่านได้ผ่าน RLS) → แปลงเป็นสถานะที่หน้าจอใช้
 *   * สถานะหลัก (`deriveSyncState`):
 *       not_configured = ยังไม่ได้ตั้ง `DASHBOARD_GITHUB_TOKEN` (เซิร์ฟเวอร์ส่งมาแค่ true/false ว่ามีหรือไม่ — ไม่เคยส่งค่า token)
 *                        หรือรอบล่าสุดล้มเหลวด้วยรหัส `config_missing` → แสดงเป็น "ยังไม่ได้ตั้งค่า" ไม่ใช่ error
 *       running / never_sent / last_failed / last_skipped / last_ok
 *   * **ห้ามแสดงข้อความดิบจาก DB/GitHub** — ใช้ได้แค่ `error_code` แล้วแปลงเป็นข้อความไทยที่เขียนไว้ที่นี่ (`describeSyncError`)
 *     รหัสไม่รู้จัก = ข้อความกลาง · รหัส GitHub รูป `github_<status>` แปลงตามกลุ่ม status
 *   * ปุ่ม "ส่งตอนนี้" มีเฉพาะ host (`canTriggerSync`) — เซิร์ฟเวอร์ตรวจซ้ำที่ POST /api/dashboard/sync และ DB (start_sync_log)
 *   * ผลตอบกลับของ POST ถูกแปลงด้วย `interpretSyncResponse` (ไม่ใช้ `message` ดิบจาก API)
 *   * เวลาแสดงเป็นเวลาไทย (UTC+7 คงที่ ไม่มี DST) รูป dd/mm/yyyy HH:mm
 */

export type SyncSource = "auto" | "manual" | "close" | "resync" | "export";
export type SyncResult = "success" | "skipped" | "failed";

/** 1 แถวของ `sync_logs` (ชื่อ field ฝั่ง app) */
export interface SyncLogRow {
  id: number;
  source: SyncSource;
  /** ชื่อผู้กด (null = ระบบ/cron หรือหาชื่อไม่พบ) */
  triggeredByName: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** null = กำลังส่ง */
  result: SyncResult | null;
  errorCode: string | null;
  monthsSent: string[];
  monthCount: number | null;
  commitSha: string | null;
}

export type SyncState =
  | "not_configured"
  | "running"
  | "never_sent"
  | "last_failed"
  | "last_skipped"
  | "last_ok";

// ---------------------------------------------------------------------------
// สิทธิ์
// ---------------------------------------------------------------------------

/** มีปุ่มสั่งส่งเฉพาะ host (DECISIONS 2.72: recorder เห็นสถานะอย่างเดียว) */
export function canTriggerSync(role: string | null | undefined): boolean {
  return role === "host";
}

// ---------------------------------------------------------------------------
// ป้ายชื่อ
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<SyncSource, string> = {
  auto: "Auto Sync 06:00",
  manual: "ส่งตอนนี้ (กดเอง)",
  close: "ปิดเดือน",
  resync: "คำนวณ snapshot ใหม่",
  export: "Export สำรอง",
};

export function sourceLabel(source: string): string {
  return (SOURCE_LABEL as Record<string, string>)[source] ?? "ไม่ทราบช่องทาง";
}

export type ResultTone = "ok" | "na" | "miss" | "info";

export function resultLabel(result: SyncResult | null): { text: string; tone: ResultTone; icon: "check" | "dash" | "cross" | "clock" } {
  switch (result) {
    case "success":
      return { text: "สำเร็จ", tone: "ok", icon: "check" };
    case "skipped":
      return { text: "ข้าม · ไม่มีการเปลี่ยนแปลง", tone: "na", icon: "dash" };
    case "failed":
      return { text: "ล้มเหลว", tone: "miss", icon: "cross" };
    default:
      return { text: "กำลังส่ง", tone: "info", icon: "clock" };
  }
}

// ---------------------------------------------------------------------------
// error code → ข้อความไทย
// ---------------------------------------------------------------------------

export type ErrorKind = "config" | "transient" | "data" | "auth" | "unknown";

export interface SyncErrorInfo {
  kind: ErrorKind;
  /** สาเหตุ (สั้น) */
  title: string;
  /** วิธีแก้ */
  fix: string;
}

const GENERIC_ERROR: SyncErrorInfo = {
  kind: "unknown",
  title: "ส่งไม่สำเร็จ (ไม่ทราบสาเหตุแน่ชัด)",
  fix: "ลองกด “ส่งตอนนี้” อีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ พร้อมเวลาที่เกิดเหตุ",
};

const ERROR_BY_CODE: Record<string, SyncErrorInfo> = {
  config_missing: {
    kind: "config",
    title: "ยังไม่ได้ตั้งค่าการเชื่อมต่อกับ GitHub",
    fix: "ให้ผู้ดูแลระบบตั้งค่า Environment Variable ที่ Vercel (ห้ามส่ง token ทางแชท/อีเมล) แล้วกด “ส่งตอนนี้”",
  },
  invalid_data: {
    kind: "data",
    title: "ไฟล์ที่สร้างไม่ตรงรูปแบบที่ Dashboard อ่านได้ (ไม่ครบ 43 สาขา หรือฟิลด์ไม่ครบ)",
    fix: "ระบบไม่ส่งข้อมูลที่ผิดรูปแบบ — Dashboard ยังแสดงตัวเลขเดิม · แจ้งผู้ดูแลฐานข้อมูลให้ตรวจข้อมูลสาขา",
  },
  months_dropped: {
    kind: "data",
    title: "ไฟล์ใหม่ขาดบางเดือนที่ Dashboard มีอยู่แล้ว",
    fix: "ระบบไม่ส่งเพราะประวัติบน Dashboard จะหาย · แจ้งผู้ดูแลฐานข้อมูลให้ตรวจข้อมูลย้อนหลัง",
  },
  value_drop: {
    kind: "data",
    title: "มูลค่ารวมของเดือนที่ส่งไปแล้วลดลงผิดปกติ (เกินครึ่ง)",
    fix: "ระบบไม่ส่งเพื่อให้คนตรวจก่อน · ตรวจข้อมูลเดือนนั้น แล้วค่อยกด “ส่งตอนนี้”",
  },
  legacy_missing: {
    kind: "data",
    title: "ไม่พบข้อมูลเดือนก่อนเริ่มใช้ระบบ (legacy)",
    fix: "แจ้งผู้ดูแลฐานข้อมูลให้นำเข้าข้อมูลย้อนหลังก่อน",
  },
  closed_snapshot_missing: {
    kind: "data",
    title: "เดือนที่ปิดแล้วไม่มี snapshot ที่เก็บไว้",
    fix: "ระบบไม่คำนวณเดือนที่ปิดแล้วใหม่เอง · แจ้งผู้ดูแลฐานข้อมูล",
  },
  index_missing: {
    kind: "data",
    title: "ไม่พบไฟล์ index.html บน repo ของ Dashboard",
    fix: "ให้ผู้ดูแลระบบตรวจ repo และ branch ปลายทางว่าถูกต้อง",
  },
  index_marker_missing: {
    kind: "data",
    title: "โครงหน้า index.html ของ Dashboard เปลี่ยนไป ระบบหาจุดวางข้อมูลไม่เจอ",
    fix: "แจ้งผู้ดูแลระบบให้ตรวจ repo ของ Dashboard",
  },
  load_failed: {
    kind: "unknown",
    title: "อ่านข้อมูลจากระบบไม่สำเร็จ",
    fix: "ลองส่งใหม่อีกครั้ง หากเกิดซ้ำให้แจ้งผู้ดูแลฐานข้อมูล",
  },
  timeout: {
    kind: "transient",
    title: "รอบนี้ไม่ได้บันทึกผลภายใน 10 นาที (ระบบหยุดกลางทาง)",
    fix: "ไม่ต้องทำอะไร Auto Sync รอบถัดไปจะลองใหม่ หรือกด “ส่งตอนนี้” ได้เลย",
  },
  busy: {
    kind: "transient",
    title: "มีการส่งอื่นกำลังทำงานอยู่ รอบนี้จึงข้าม",
    fix: "ไม่ต้องทำอะไร",
  },
  unknown: GENERIC_ERROR,
};

/** รหัส GitHub รูป `github_<status>` */
function githubInfo(status: number): SyncErrorInfo {
  if (status === 401) {
    return {
      kind: "auth",
      title: "GitHub ไม่ยอมรับ token (อาจหมดอายุหรือผิด)",
      fix: "ให้ผู้ดูแลระบบสร้าง token ใหม่แล้วอัปเดตที่ Vercel → Environment Variables จากนั้นกด “ส่งตอนนี้”",
    };
  }
  if (status === 403) {
    return {
      kind: "auth",
      title: "token ไม่มีสิทธิ์เขียนไฟล์ใน repo ของ Dashboard (หรือโดนจำกัดการเรียกชั่วคราว)",
      fix: "ให้ผู้ดูแลระบบตรวจสิทธิ์ของ token (ต้องเขียนเนื้อหา repo ได้) แล้วลองใหม่",
    };
  }
  if (status === 404) {
    return {
      kind: "config",
      title: "ไม่พบ repo/branch/ไฟล์ปลายทางบน GitHub",
      fix: "ให้ผู้ดูแลระบบตรวจชื่อ repo และ branch ที่ตั้งไว้ที่ Vercel",
    };
  }
  if (status === 409 || status === 422) {
    return {
      kind: "transient",
      title: "ไฟล์บน GitHub เพิ่งถูกแก้พร้อมกัน ส่งชนกัน",
      fix: "กด “ส่งตอนนี้” อีกครั้ง",
    };
  }
  if (status >= 500 && status <= 599) {
    return {
      kind: "transient",
      title: "GitHub ขัดข้องชั่วคราว",
      fix: "ไม่ต้องแก้อะไร Auto Sync รอบถัดไปจะลองใหม่เอง หรือกด “ส่งตอนนี้” ได้เลย",
    };
  }
  return GENERIC_ERROR;
}

/** แปลง `error_code` เป็นข้อความไทย — ไม่เคยคืนข้อความดิบ */
export function describeSyncError(code: string | null | undefined): SyncErrorInfo {
  if (!code) return GENERIC_ERROR;
  const known = ERROR_BY_CODE[code];
  if (known) return known;
  const gh = /^github_(\d{3})$/.exec(code);
  if (gh) return githubInfo(Number(gh[1]));
  return GENERIC_ERROR;
}

// ---------------------------------------------------------------------------
// สถานะหลัก
// ---------------------------------------------------------------------------

/** แถวที่ "ส่งจริงหรือพยายามส่ง" — ไม่รวม export (ไม่ได้ส่ง Dashboard) เรียงใหม่→เก่า */
export function sendAttempts(logs: readonly SyncLogRow[]): SyncLogRow[] {
  return sortNewestFirst(logs).filter((l) => l.source !== "export");
}

export function sortNewestFirst(logs: readonly SyncLogRow[]): SyncLogRow[] {
  return [...logs].sort((a, b) => {
    const d = Date.parse(b.startedAt) - Date.parse(a.startedAt);
    return d !== 0 ? d : b.id - a.id;
  });
}

export function lastAttempt(logs: readonly SyncLogRow[]): SyncLogRow | null {
  return sendAttempts(logs)[0] ?? null;
}

export function lastSuccess(logs: readonly SyncLogRow[]): SyncLogRow | null {
  return sendAttempts(logs).find((l) => l.result === "success") ?? null;
}

export function deriveSyncState(logs: readonly SyncLogRow[], tokenConfigured: boolean): SyncState {
  if (!tokenConfigured) return "not_configured";
  const last = lastAttempt(logs);
  if (!last) return "never_sent";
  if (last.result === null) return "running";
  if (last.result === "failed" && last.errorCode === "config_missing") return "not_configured";
  if (last.result === "failed") return "last_failed";
  if (last.result === "skipped") return "last_skipped";
  return "last_ok";
}

/** Auto Sync ที่ไม่พลาดติดกันกี่วัน (นับรอบ auto ล่าสุดย้อนไปจนเจอล้มเหลว · ไม่นับรอบกำลังส่ง) */
export function autoStreak(logs: readonly SyncLogRow[]): number {
  let n = 0;
  for (const l of sortNewestFirst(logs)) {
    if (l.source !== "auto" || l.result === null) continue;
    if (l.result === "failed") break;
    n += 1;
  }
  return n;
}

/** ล้มเหลวใน 30 วันล่าสุด + จำนวนที่ยังไม่มีการส่งสำเร็จตามหลัง */
export function failureStats(logs: readonly SyncLogRow[], nowMs: number): { count: number; unresolved: number } {
  const since = nowMs - 30 * 86_400_000;
  const attempts = sendAttempts(logs);
  const fails = attempts.filter((l) => l.result === "failed" && Date.parse(l.startedAt) >= since);
  const unresolved = fails.filter(
    (f) => !attempts.some((x) => x.result === "success" && Date.parse(x.startedAt) > Date.parse(f.startedAt)),
  ).length;
  return { count: fails.length, unresolved };
}

// ---------------------------------------------------------------------------
// เวลา (เวลาไทย UTC+7)
// ---------------------------------------------------------------------------

const BKK_OFFSET_MS = 7 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");

function bkkParts(ms: number) {
  const d = new Date(ms + BKK_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}

/** dd/mm/yyyy HH:mm (เวลาไทย) · ค่าไม่ถูกต้อง = "-" */
export function formatThaiDateTime(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "-";
  const p = bkkParts(ms);
  return `${pad(p.d)}/${pad(p.mo)}/${p.y} ${pad(p.h)}:${pad(p.mi)}`;
}

/** dd/mm (เวลาไทย) */
export function formatThaiDayMonth(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "-";
  const p = bkkParts(ms);
  return `${pad(p.d)}/${pad(p.mo)}`;
}

/** "วันนี้" / "เมื่อวาน" / "N วันที่แล้ว" ตามวันที่ปฏิทินไทย */
export function relativeDay(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const day = (x: number) => Math.floor((x + BKK_OFFSET_MS) / 86_400_000);
  const diff = day(nowMs) - day(ms);
  if (diff <= 0) return "วันนี้";
  if (diff === 1) return "เมื่อวาน";
  return `${diff} วันที่แล้ว`;
}

/** ใช้เวลากี่วินาที (null = ยังไม่จบ/ข้อมูลผิด) */
export function elapsedSeconds(row: Pick<SyncLogRow, "startedAt" | "finishedAt">): number | null {
  if (!row.finishedAt) return null;
  const s = Date.parse(row.startedAt);
  const f = Date.parse(row.finishedAt);
  if (!Number.isFinite(s) || !Number.isFinite(f) || f < s) return null;
  return (f - s) / 1000;
}

/** รอบ Auto Sync ถัดไป = 06:00 เวลาไทยของวันถัดไปที่ยังมาไม่ถึง (cron `0 23 * * *` UTC) */
export function nextAutoSyncLabel(nowMs: number): string {
  const p = bkkParts(nowMs);
  const todayRun = Date.UTC(p.y, p.mo - 1, p.d, 6, 0) - BKK_OFFSET_MS;
  const next = nowMs < todayRun ? todayRun : todayRun + 86_400_000;
  const n = bkkParts(next);
  return `${pad(n.d)}/${pad(n.mo)}/${n.y} ~06:00`;
}

// ---------------------------------------------------------------------------
// ตัวกรอง + รวมแถว "ข้าม" ที่ติดกัน
// ---------------------------------------------------------------------------

export interface HistoryFilter {
  result: "all" | SyncResult;
  source: "all" | SyncSource;
}

export function filterLogs(logs: readonly SyncLogRow[], f: HistoryFilter): SyncLogRow[] {
  return sortNewestFirst(logs).filter(
    (l) => (f.result === "all" || l.result === f.result) && (f.source === "all" || l.source === f.source),
  );
}

export type HistoryItem = { kind: "row"; log: SyncLogRow } | { kind: "group"; logs: SyncLogRow[] };

/** รวมแถว skipped ที่ติดกันตั้งแต่ 2 แถวขึ้นไปเป็นกลุ่มเดียว (เปิด group = ไม่รวม) */
export function groupHistory(rows: readonly SyncLogRow[], group: boolean): HistoryItem[] {
  if (!group) return rows.map((log) => ({ kind: "row", log }));
  const items: HistoryItem[] = [];
  let cur: SyncLogRow[] | null = null;
  for (const log of rows) {
    if (log.result === "skipped") {
      if (!cur) {
        cur = [];
        items.push({ kind: "group", logs: cur });
      }
      cur.push(log);
    } else {
      cur = null;
      items.push({ kind: "row", log });
    }
  }
  return items.map((it) => (it.kind === "group" && it.logs.length < 2 ? { kind: "row", log: it.logs[0]! } : it));
}

// ---------------------------------------------------------------------------
// ผลตอบกลับของ POST /api/dashboard/sync
// ---------------------------------------------------------------------------

export type SyncActionOutcome =
  | { kind: "success"; message: string }
  | { kind: "skipped"; message: string }
  | { kind: "failed"; message: string; errorCode: string | null; notConfigured: boolean }
  | { kind: "busy"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "error"; message: string };

/**
 * แปลงคำตอบของ API เป็นผลที่หน้าจอแสดง — ไม่ใช้ `message` ดิบของ API (กันข้อความภายในรั่ว)
 * `body` ไม่ใช่ object / อ่านไม่ได้ = ข้อความกลาง
 */
export function interpretSyncResponse(status: number, body: unknown): SyncActionOutcome {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const code = typeof b.errorCode === "string" ? b.errorCode : null;
  const result = typeof b.result === "string" ? b.result : null;

  if (status === 401) return { kind: "denied", message: "หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่" };
  if (status === 403) return { kind: "denied", message: "ส่งข้อมูลเข้า Dashboard ได้เฉพาะ OM/PM เท่านั้น" };
  if (status === 409 || code === "busy") {
    return { kind: "busy", message: "มีการส่งข้อมูลกำลังทำงานอยู่ รอสักครู่แล้วลองใหม่" };
  }
  if (status >= 200 && status < 300 && b.ok === true) {
    if (result === "skipped") {
      return { kind: "skipped", message: "ตรวจแล้ว ข้อมูลไม่เปลี่ยน จึงไม่ได้ส่ง (นับว่าสำเร็จ)" };
    }
    return { kind: "success", message: "ส่ง Dashboard สำเร็จ · Netlify จะอัปเดตภายใน ~30 วินาที" };
  }
  if (result === "failed") {
    return {
      kind: "failed",
      message: describeSyncError(code).title,
      errorCode: code,
      notConfigured: code === "config_missing",
    };
  }
  return { kind: "error", message: "ส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หากเกิดซ้ำให้แจ้งผู้ดูแลระบบ" };
}
