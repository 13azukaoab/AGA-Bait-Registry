/**
 * ปิดเดือน / คำนวณ snapshot ใหม่ / แก้ชื่อ-เวลาผู้ปิด (M39 · SPEC §7.7, §9.2 · DECISIONS 2.72, 5.4, 5.8)
 *
 * Logic summary:
 *   - สิทธิ์ (เจ้าของ 18 พ.ย. 2026): ปิดส่วนกลาง = host หรือ recorder ส่วนกลาง · ปิดต่างจังหวัด / คำนวณใหม่ /
 *     ปิดข้ามด้วยเหตุผล / แก้ผู้ปิด = host · route ถามสิทธิ์ที่ DB ด้วย JWT ผู้ใช้ก่อน → server ใช้ service role
 *     (lib/admin/monthCloseAdmin.ts) ในนามผู้กด → RPC ตรวจสิทธิ์ผู้กดซ้ำ + ลง audit ในนามผู้กด
 *   - ผู้เรียกส่งตัวเลขเองไม่ได้: ส่วนกลางคำนวณ 24 สาขาฝั่ง server ด้วย lib/rules (`computeCentralRows` — สูตรเดียวกับ
 *     ตอนส่ง Dashboard) แล้วส่ง jsonb ให้ RPC `close_month_part` / `resync_month_part` เขียน snapshot + แถวปิดใน transaction เดียว
 *   - ต่างจังหวัด: ไม่มีสูตร (แถว manual §6.5 + ค่ายกมา 5.12/5.12a ประกอบตอนส่งใน buildDashboardData)
 *     → RPC ปิด/บันทึกเวลาอย่างเดียว
 *   - ปิด/คำนวณใหม่สำเร็จ = **commit แล้ว** จากนั้นจึงส่ง Dashboard (sync_logs source `close` / `resync`)
 *     ส่งไม่สำเร็จหรือมีรอบอื่นส่งอยู่ (SY001) → เดือนยังปิดอยู่ คืนสถานะการส่งแยก (SPEC §7.7 "ส่งไม่สำเร็จ" กดส่งใหม่ได้)
 *   - error ของ DB (MC001–MC012, 42501) แปลงเป็น HTTP + errorCode สั้น ๆ ด้วย `mapMonthCloseError`
 * ไฟล์นี้ไม่ import Supabase/Next — ports ถูกส่งเข้ามา (เทสได้โดยไม่ต่อฐานข้อมูล/GitHub)
 */
import { DashboardSyncError } from "./errors";
import type { RunOutcome, SyncSource } from "./runSync";
import { computeCentralRows, type CentralRegistry } from "./sources";

export type ClosureScope = "central" | "province";

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** แถวที่ส่งเข้า RPC (ชื่อ key ตรงกับคอลัมน์ monthly_branch_snapshots) */
export interface CentralSnapshotPayloadRow {
  branch_id: string;
  s1: number; s3: number; m1: number; m3: number;
  l1: number; l3: number; xl1: number; xl3: number;
  cust: number;
  vS: number; vM: number; vL: number; vXL: number;
  value: number;
}

/** คำนวณแถวส่วนกลาง 24 สาขาของเดือน แล้วแปลงชื่อสาขาเป็น id (ไม่พบ id = throw load_failed) */
export function centralSnapshotPayload(
  registry: CentralRegistry,
  branchIdByName: ReadonlyMap<string, string>,
  month: string,
): CentralSnapshotPayloadRow[] {
  return computeCentralRows(registry, month).map((r) => {
    const id = branchIdByName.get(r.branch);
    if (!id) throw new DashboardSyncError("load_failed", `ไม่พบ id ของสาขา ${r.branch}`);
    return {
      branch_id: id,
      s1: r.s1, s3: r.s3, m1: r.m1, m3: r.m3, l1: r.l1, l3: r.l3, xl1: r.xl1, xl3: r.xl3,
      cust: r.cust,
      vS: r.vS, vM: r.vM, vL: r.vL, vXL: r.vXL,
      value: r.value,
    };
  });
}

// ---------------------------------------------------------------------------
// error mapping
// ---------------------------------------------------------------------------

export type MonthCloseErrorCode =
  | "invalid_month" // MC001
  | "month_not_ended" // MC002
  | "before_go_live" // MC003
  | "already_closed" // MC004
  | "invalid_rows" // MC005 (บั๊กฝั่ง server — route คำนวณแถวเอง)
  | "branches_not_ready" // MC006 (+ branches, canOverride)
  | "invalid_reason" // MC007
  | "non_computed_rows" // MC008
  | "carried_not_acknowledged" // MC009 (+ branches)
  | "not_closed" // MC010
  | "invalid_closer" // MC011
  | "invalid_closed_at" // MC012
  | "stale_resync" // MC013
  | "override_host_only" // MC014
  | "forbidden" // 42501
  | "load_failed"
  | "unknown";

export interface MappedError {
  status: number;
  errorCode: MonthCloseErrorCode;
  message: string;
  /** สาขาที่ยังบันทึกบริการไม่ครบ (MC006 · มี pending = จำนวนสัญญาค้าง) / ใช้ค่ายกมา (MC009) */
  branches?: { id: string; name: string; pending?: number }[];
  /** MC006: ผู้กดปิดข้ามด้วยเหตุผลได้ไหม (host = true · recorder = false) */
  canOverride?: boolean;
}

const DB_CODES: Record<string, { status: number; errorCode: MonthCloseErrorCode; message: string }> = {
  MC001: { status: 400, errorCode: "invalid_month", message: "เดือนไม่ถูกต้อง (ต้องเป็น YYYY-MM)" },
  MC002: { status: 409, errorCode: "month_not_ended", message: "เดือนนี้ยังไม่จบ (เวลาไทย) ปิดไม่ได้" },
  MC003: { status: 409, errorCode: "before_go_live", message: "เดือนนี้อยู่ก่อนเริ่มใช้ระบบ ไม่ต้องปิด" },
  MC004: { status: 409, errorCode: "already_closed", message: "ส่วนนี้ของเดือนนี้ปิดไปแล้ว — ใช้ \"คำนวณ snapshot ใหม่\" แทน" },
  MC005: { status: 500, errorCode: "invalid_rows", message: "ข้อมูลที่คำนวณได้ไม่ครบหรือไม่ถูกต้อง แจ้งผู้ดูแลระบบ" },
  MC006: { status: 409, errorCode: "branches_not_ready", message: "ยังมีสาขาส่วนกลางที่บันทึกบริการเดือนนี้ไม่ครบ" },
  MC007: { status: 400, errorCode: "invalid_reason", message: "เหตุผลต้องยาว 5–500 ตัวอักษร" },
  MC008: { status: 409, errorCode: "non_computed_rows", message: "เดือนนี้มีตัวเลขส่วนกลางแบบนำเข้า/กรอกมือ ระบบไม่เขียนทับ แจ้งผู้ดูแลระบบ" },
  MC009: { status: 409, errorCode: "carried_not_acknowledged", message: "ยังมีสาขาต่างจังหวัดที่ใช้ค่ายกมา — ต้องติ๊กรับทราบก่อนปิด" },
  MC010: { status: 409, errorCode: "not_closed", message: "ส่วนนี้ของเดือนนี้ยังไม่ปิด" },
  MC011: { status: 400, errorCode: "invalid_closer", message: "ผู้ปิดต้องเป็นผู้ใช้ที่มีสิทธิ์ปิดส่วนนี้" },
  MC012: { status: 400, errorCode: "invalid_closed_at", message: "เวลาปิดต้องอยู่หลังสิ้นเดือนนั้น และไม่เกินเวลาปัจจุบัน" },
  MC013: { status: 409, errorCode: "stale_resync", message: "มีการคำนวณ snapshot ใหม่ของส่วนนี้ระหว่างรอ — กดใหม่อีกครั้ง" },
  MC014: { status: 403, errorCode: "override_host_only", message: "ปิดข้ามด้วยเหตุผลได้เฉพาะ OM/PM (host)" },
  "42501": { status: 403, errorCode: "forbidden", message: "ทำรายการนี้ได้เฉพาะ OM/PM (host)" },
};

function parseDetails(details: unknown): Pick<MappedError, "branches" | "canOverride"> {
  if (typeof details !== "string" || details === "") return {};
  try {
    const parsed = JSON.parse(details) as { branches?: unknown; can_override?: unknown };
    const out: Pick<MappedError, "branches" | "canOverride"> = {};
    if (Array.isArray(parsed.branches)) {
      out.branches = parsed.branches
        .filter((b): b is { id: unknown; name: unknown; pending?: unknown } => typeof b === "object" && b !== null)
        .map((b) => ({
          id: String(b.id),
          name: String(b.name),
          ...(typeof b.pending === "number" ? { pending: b.pending } : {}),
        }));
    }
    if (typeof parsed.can_override === "boolean") out.canOverride = parsed.can_override;
    return out;
  } catch {
    return {};
  }
}

/** แปลง error จาก RPC / การโหลดข้อมูล → HTTP (ข้อความ DB ภายในไม่ส่งถึงหน้าจอ) */
export function mapMonthCloseError(error: unknown): MappedError {
  if (error instanceof DashboardSyncError) {
    return { status: 500, errorCode: "load_failed", message: "อ่านข้อมูลจากระบบไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  const e = (error ?? {}) as { code?: unknown; details?: unknown };
  const known = typeof e.code === "string" ? DB_CODES[e.code] : undefined;
  if (!known) {
    return { status: 500, errorCode: "unknown", message: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  const extra =
    known.errorCode === "branches_not_ready" || known.errorCode === "carried_not_acknowledged"
      ? parseDetails(e.details)
      : {};
  return { ...known, ...extra };
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

export interface ClosePartArgs {
  month: string;
  scope: ClosureScope;
  rows: CentralSnapshotPayloadRow[] | null;
  overrideReason?: string;
  acknowledgeCarried?: boolean;
}

export interface ClosePartResult {
  month: string;
  scope: ClosureScope;
  closedAt: string;
  overridden: boolean;
  /** จำนวนสาขาส่วนกลางที่ยังบันทึกบริการไม่ครบตอนปิด (ปิดข้ามด้วยเหตุผล) */
  unreadyCount: number;
  carriedCount: number;
}

export interface ResyncPartResult {
  month: string;
  scope: ClosureScope;
  changedBranches: number;
}

export interface MonthClosePorts {
  /** คำนวณแถวส่วนกลางของเดือน (อ่านทะเบียน + lib/rules) */
  centralRows(month: string): Promise<CentralSnapshotPayloadRow[]>;
  closePart(args: ClosePartArgs): Promise<ClosePartResult>;
  /** `computedAt` = เวลาที่เริ่มอ่านทะเบียน (กันเขียนทับด้วยตัวเลขเก่า — MC013) */
  resyncPart(args: {
    month: string;
    scope: ClosureScope;
    rows: CentralSnapshotPayloadRow[] | null;
    computedAt: string;
  }): Promise<ResyncPartResult>;
  /** ส่ง Dashboard 1 รอบ (runDashboardSync) — throw ได้ (SY001 / 42501 / อื่น ๆ) */
  sync(source: SyncSource): Promise<RunOutcome>;
}

/** ผลการส่ง Dashboard หลังปิด/คำนวณใหม่ — แยกจากผลการปิด (ปิดสำเร็จแล้วแม้ส่งไม่สำเร็จ) */
export interface SyncSummary {
  result: "success" | "skipped" | "failed" | "busy" | "not_started";
  logId?: number;
  errorCode?: string;
  message: string;
  monthsSent: string[];
}

const INTERNAL_SYNC_CODES = new Set(["load_failed", "unknown"]);

export async function syncAfter(ports: MonthClosePorts, source: SyncSource): Promise<SyncSummary> {
  let outcome: RunOutcome;
  try {
    outcome = await ports.sync(source);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "SY001") {
      return {
        result: "busy",
        errorCode: "busy",
        message: "มีการส่งข้อมูลอื่นกำลังทำงานอยู่ — ระบบจะส่งให้ในรอบอัตโนมัติ 06:00 หรือกด \"ส่งตอนนี้\" ภายหลัง",
        monthsSent: [],
      };
    }
    return {
      result: "not_started",
      errorCode: code === "42501" ? "forbidden" : "start_failed",
      message: "ยังไม่ได้ส่ง Dashboard — กด \"ส่งตอนนี้\" ภายหลัง",
      monthsSent: [],
    };
  }
  if (outcome.status === "busy") {
    return { result: "busy", errorCode: "busy", message: "มีการส่งข้อมูลอื่นกำลังทำงานอยู่", monthsSent: [] };
  }
  const internal = outcome.errorCode !== undefined && INTERNAL_SYNC_CODES.has(outcome.errorCode);
  return {
    result: outcome.result,
    logId: outcome.logId,
    errorCode: outcome.errorCode ?? (outcome.logError ? "log_failed" : undefined),
    message: internal ? "อ่านข้อมูลจากระบบไม่สำเร็จ ดูรายละเอียดในประวัติการส่ง" : outcome.message,
    monthsSent: outcome.monthsSent,
  };
}

export interface CloseMonthInput {
  month: string;
  scope: ClosureScope;
  overrideReason?: string;
  acknowledgeCarried?: boolean;
}

/** ปิด 1 ส่วน แล้วส่ง Dashboard (source `close`) · error ของการปิดถูก throw ต่อให้ route แปลง */
export async function closeMonth(
  ports: MonthClosePorts,
  input: CloseMonthInput,
): Promise<{ closure: ClosePartResult; sync: SyncSummary }> {
  const rows = input.scope === "central" ? await ports.centralRows(input.month) : null;
  const closure = await ports.closePart({ ...input, rows });
  const sync = await syncAfter(ports, "close");
  return { closure, sync };
}

/** คำนวณ snapshot ใหม่ของส่วนที่ปิดแล้ว แล้วส่ง Dashboard (source `resync`) */
export async function resyncMonth(
  ports: MonthClosePorts,
  input: { month: string; scope: ClosureScope },
  now: () => Date = () => new Date(),
): Promise<{ resync: ResyncPartResult; sync: SyncSummary }> {
  const computedAt = now().toISOString();
  const rows = input.scope === "central" ? await ports.centralRows(input.month) : null;
  const resync = await ports.resyncPart({ ...input, rows, computedAt });
  const sync = await syncAfter(ports, "resync");
  return { resync, sync };
}
