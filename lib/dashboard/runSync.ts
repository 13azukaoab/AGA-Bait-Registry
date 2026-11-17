/**
 * คุม 1 รอบการส่งข้อมูลเข้า Dashboard + บันทึก `sync_logs` (M27 · SPEC §9.2)
 * ใช้ร่วมกันทั้ง Vercel Cron (`auto`) และปุ่ม "ส่งตอนนี้" ของ host (`manual`)
 *
 * ลำดับ (ทุกช่องทางเหมือนกัน — ตรวจสิทธิ์ทำที่ route ก่อนเรียกฟังก์ชันนี้):
 *   1. `startLog(source)` — DB กันส่งซ้อน: manual ชน = throw (SY001) · auto ชน = DB บันทึก skipped/busy แล้วคืน null
 *   2. `loadData()` — อ่านฐานข้อมูล + ประกอบไฟล์ (เดือนที่ปิดแล้วใช้ snapshot เดิม · ไม่คำนวณใหม่)
 *   3. `push(data)` — ส่งขึ้น GitHub (ข้อมูลเหมือนเดิม = ข้าม)
 *   4. `finishLog(...)` — **ทำเสมอ** (finally) แม้ขั้น 2–3 พัง เพื่อให้ประวัติครบทุกรอบ
 * ข้อความ error ที่บันทึกถูกตัดสั้น ≤ 500 ตัว · ไม่มี token (sync.ts ไม่ใส่ token ลงข้อความ)
 */
import { DashboardSyncError } from "./errors";
import type { SyncLogRecord } from "./sync";
import type { DashboardData } from "./types";

export type SyncSource = "auto" | "manual";
export type SyncLogResult = "success" | "skipped" | "failed";

export interface FinishLogInput {
  result: SyncLogResult;
  errorCode?: string;
  errorMessage?: string;
  monthsSent: string[];
  monthCount?: number;
  commitSha?: string;
}

export interface DashboardSyncPorts {
  /** คืน id ของรอบ · `null` = cron ชนรอบอื่น (DB บันทึกแถว skipped/busy ให้แล้ว) */
  startLog(source: SyncSource): Promise<number | null>;
  finishLog(id: number, input: FinishLogInput): Promise<void>;
  loadData(): Promise<DashboardData>;
  push(data: DashboardData): Promise<SyncLogRecord>;
}

export type RunOutcome =
  | { status: "busy" }
  | {
      status: "done";
      logId: number;
      result: SyncLogResult;
      errorCode?: string;
      message: string;
      monthsSent: string[];
      monthCount?: number;
      commitSha?: string;
      /** บันทึกผลลง sync_logs ไม่สำเร็จ (รอบนี้ยังส่ง/ไม่ส่งตามผลด้านบน) */
      logError?: string;
    };

const RESULT_OF: Record<SyncLogRecord["result"], SyncLogResult> = {
  ok: "success",
  skip: "skipped",
  fail: "failed",
};

const MAX_MESSAGE = 500;

function short(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

/** throw จาก startLog (เช่น SY001 / 42501) ส่งต่อให้ route แปลงเป็น HTTP status */
export async function runDashboardSync(
  source: SyncSource,
  ports: DashboardSyncPorts,
): Promise<RunOutcome> {
  const logId = await ports.startLog(source);
  if (logId === null) return { status: "busy" };

  let finish: FinishLogInput;
  let message: string;
  try {
    const data = await ports.loadData();
    const record = await ports.push(data);
    finish = {
      result: RESULT_OF[record.result],
      errorCode: record.errorCode,
      errorMessage: short(record.error),
      monthsSent: record.result === "ok" ? record.changedMonths : [],
      monthCount: record.months,
      commitSha: record.commitSha,
    };
    message = record.result === "fail" ? (short(record.error) ?? record.message) : record.message;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    finish = {
      result: "failed",
      errorCode: error instanceof DashboardSyncError ? error.code : "load_failed",
      errorMessage: short(text),
      monthsSent: [],
    };
    message = short(text) ?? "ส่งไม่สำเร็จ";
  }

  let logError: string | undefined;
  try {
    await ports.finishLog(logId, finish);
  } catch (error) {
    logError = error instanceof Error ? error.message : String(error);
  }

  return {
    status: "done",
    logId,
    result: finish.result,
    errorCode: finish.errorCode,
    message,
    monthsSent: finish.monthsSent,
    monthCount: finish.monthCount,
    commitSha: finish.commitSha,
    ...(logError ? { logError } : {}),
  };
}
