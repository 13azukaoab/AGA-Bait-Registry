/**
 * ตัวเรียก API ปิดเดือนจากหน้าเว็บ (browser fetch · same-origin ผ่านด่าน Origin ของ route อยู่แล้ว)
 *
 * Logic summary:
 *   * ส่งเฉพาะ {month, scope, confirmKey, overrideReason?, acknowledgeCarried?} — ไม่มีตัวเลขใดๆ (server คำนวณเอง)
 *   * แปลงคำตอบเป็นผลแบบ union: ok · not_ready (host ปิดข้ามได้ถ้า canOverride) · carried (ต้องติ๊กรับทราบ) · error(code)
 *   * ไม่คืนข้อความดิบจาก server — หน้าจอแปลงจาก code ด้วย describeError
 *   * fetch ถูกส่งเข้ามาได้ (เทสโดยไม่ต่อเครือข่าย)
 */
import type { Scope, SyncResult } from "./monthsLogic";

export interface BranchRef {
  id: string;
  name: string;
  pending?: number;
}

export interface CloseOk {
  kind: "ok";
  closure: { month: string; scope: Scope; closedAt: string; overridden: boolean; unreadyCount: number; carriedCount: number };
  sync: { result: SyncResult; errorCode?: string; monthsSent: string[] };
}
export interface ResyncOk {
  kind: "ok";
  resync: { month: string; scope: Scope; changedBranches: number };
  sync: { result: SyncResult; errorCode?: string; monthsSent: string[] };
}
export interface NotReady {
  kind: "not_ready";
  branches: BranchRef[];
  canOverride: boolean;
}
export interface Carried {
  kind: "carried";
  branches: BranchRef[];
}
export interface ApiError {
  kind: "error";
  code: string;
}

export type CloseOutcome = CloseOk | NotReady | Carried | ApiError;
export type ResyncOutcome = ResyncOk | ApiError;

export interface CloseRequest {
  month: string;
  scope: Scope;
  confirmKey: string;
  overrideReason?: string;
  acknowledgeCarried?: boolean;
}

type FetchFn = typeof fetch;

function toBranches(v: unknown): BranchRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
    .map((b) => ({
      id: String(b.id ?? ""),
      name: String(b.name ?? ""),
      ...(typeof b.pending === "number" ? { pending: b.pending } : {}),
    }));
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function syncOf(v: unknown): CloseOk["sync"] {
  const s = asRecord(v);
  return {
    result: (typeof s.result === "string" ? s.result : "not_started") as SyncResult,
    ...(typeof s.errorCode === "string" ? { errorCode: s.errorCode } : {}),
    monthsSent: Array.isArray(s.monthsSent) ? s.monthsSent.map(String) : [],
  };
}

/** แปลงคำตอบ POST /api/months/close */
export function parseCloseResponse(status: number, body: unknown): CloseOutcome {
  const b = asRecord(body);
  if (status === 200 && b.ok === true) {
    const c = asRecord(b.closure);
    return {
      kind: "ok",
      closure: {
        month: String(c.month ?? ""),
        scope: c.scope === "province" ? "province" : "central",
        closedAt: String(c.closedAt ?? ""),
        overridden: c.overridden === true,
        unreadyCount: typeof c.unreadyCount === "number" ? c.unreadyCount : 0,
        carriedCount: typeof c.carriedCount === "number" ? c.carriedCount : 0,
      },
      sync: syncOf(b.sync),
    };
  }
  const code = typeof b.errorCode === "string" ? b.errorCode : "unknown";
  if (code === "branches_not_ready") return { kind: "not_ready", branches: toBranches(b.branches), canOverride: b.canOverride === true };
  if (code === "carried_not_acknowledged") return { kind: "carried", branches: toBranches(b.branches) };
  return { kind: "error", code };
}

/** แปลงคำตอบ POST /api/months/resync */
export function parseResyncResponse(status: number, body: unknown): ResyncOutcome {
  const b = asRecord(body);
  if (status === 200 && b.ok === true) {
    const r = asRecord(b.resync);
    return {
      kind: "ok",
      resync: {
        month: String(r.month ?? ""),
        scope: r.scope === "province" ? "province" : "central",
        changedBranches: typeof r.changedBranches === "number" ? r.changedBranches : 0,
      },
      sync: syncOf(b.sync),
    };
  }
  return { kind: "error", code: typeof b.errorCode === "string" ? b.errorCode : "unknown" };
}

async function post(fetchFn: FetchFn, url: string, payload: object): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}

export async function postClose(req: CloseRequest, fetchFn: FetchFn = fetch): Promise<CloseOutcome> {
  const payload: Record<string, unknown> = { month: req.month, scope: req.scope, confirmKey: req.confirmKey };
  if (req.overrideReason !== undefined) payload.overrideReason = req.overrideReason;
  if (req.acknowledgeCarried) payload.acknowledgeCarried = true;
  const r = await post(fetchFn, "/api/months/close", payload);
  return r ? parseCloseResponse(r.status, r.body) : { kind: "error", code: "network" };
}

export async function postResync(req: { month: string; scope: Scope }, fetchFn: FetchFn = fetch): Promise<ResyncOutcome> {
  const r = await post(fetchFn, "/api/months/resync", { month: req.month, scope: req.scope });
  return r ? parseResyncResponse(r.status, r.body) : { kind: "error", code: "network" };
}
