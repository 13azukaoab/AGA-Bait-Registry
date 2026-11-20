/**
 * ตรรกะล้วน (pure) ของหน้า /collection — ทดสอบได้โดยไม่ต้องมี DB
 *
 * Logic summary:
 *   * "หมดแล้ว" ใช้กฎเดียวกับ RPC (CL001): status ไม่ใช่ active หรือ วันสิ้นสุดที่ใช้จริง < วันนี้ (ไทย)
 *     วันสิ้นสุดที่ใช้จริง = end_date ถ้ามี ไม่งั้น defaultEndDateForTerm (lib/rules)
 *   * ช่วงวันที่ในฟอร์ม = ตรง CL005: ไม่เกินวันนี้ · ไม่ก่อนวันถัดจากวันสิ้นสุด
 *     (หรือวันยกเลิก/ปิดสัญญาถ้าเร็วกว่า) · ไม่ก่อนวันเริ่มสัญญา
 *   * สิทธิ์ปุ่ม: host ทุกแถว · recorder เฉพาะสาขาที่อยู่ใน divisionScope (ตรง contract_in_scope) · admin/viewer ไม่มีปุ่ม
 *   * ตัวหาร IG บนจอ = igTotal − moved (IG ที่ย้ายไปสัญญา Renew ไม่นับเป็นค้าง/ไม่เก็บ — DECISIONS 2.50)
 */
import { defaultEndDateForTerm } from "@/lib/rules/term";
import type { UserRole } from "@/lib/db/types";

import type { CollectionRow, ContractStatus, LastAction, MonthFilter, StatusFilter } from "./collectionTypes";

/** วันสิ้นสุดที่ใช้จริง (ตรง contract_effective_end_date ที่ DB) */
export function effectiveEndDate(startDate: string, endDate: string | null, termMonths: number): string {
  return endDate ?? defaultEndDateForTerm(startDate, termMonths);
}

/** สัญญา "หมดแล้ว" ตามกฎเดียวกับ CL001 */
export function isContractEnded(status: ContractStatus, effectiveEnd: string, today: string): boolean {
  // สัญญาพัก (paused · M29) ยังไม่จบ — ห้ามขึ้นรายการรอเก็บ (DB กันด้วย CP010)
  if (status === "paused") return false;
  return status !== "active" || effectiveEnd < today;
}

/**
 * ซ่อนสัญญาที่มีเรื่องตกบริการรอชดเชย (mockup: "ยังไม่ขึ้นรายการเก็บสถานี") — pure
 * pendingMissed: contractId → เดือนที่ตกบริการเก่าสุด ('YYYY-MM' หรือ 'YYYY-MM-DD')
 */
export function splitHeld<T extends { contractId: string; customerName: string }>(
  rows: readonly T[],
  pendingMissed: ReadonlyMap<string, string>,
): { visible: T[]; held: { contractId: string; customerName: string; missedMonth: string }[] } {
  const visible: T[] = [];
  const held: { contractId: string; customerName: string; missedMonth: string }[] = [];
  for (const r of rows) {
    const missed = pendingMissed.get(r.contractId);
    if (missed === undefined) visible.push(r);
    else held.push({ contractId: r.contractId, customerName: r.customerName, missedMonth: missed.slice(0, 7) });
  }
  return { visible, held };
}

/**
 * ใครกด "ปิดสัญญา" ได้ (DECISIONS 2.99 · เจ้าของเลือก): host ทุกแถว · recorder เฉพาะสาขาในขอบเขต · admin/viewer ไม่ได้
 * (server ตรวจขอบเขตซ้ำ) — แก้ที่จุดเดียวนี้
 */
export function canCloseContract(role: UserRole, divisionScope: readonly string[], row: Pick<CollectionRow, "division">): boolean {
  if (role === "host") return true;
  if (role === "recorder") return divisionScope.includes(row.division);
  return false;
}

/** แถวนี้ปิดสัญญาได้หรือไม่ (ยังไม่ปิด/ยกเลิก/พัก) */
export function isClosable(status: ContractStatus): boolean {
  return status === "active" || status === "expired_pending_collection";
}

/** ข้อความอธิบายเมื่อปิดสัญญาแถวนี้ไม่ได้เพราะสัญญายังไม่หมดอายุ (null = ปิดได้) · server ตรวจซ้ำ */
export function closeBlockReason(row: Pick<CollectionRow, "endDate" | "status">, today: string): string | null {
  // หมดอายุ = expired_pending_collection หรือ active ที่วันสิ้นสุด < วันนี้ (นิยามเดียวกับ BE M44)
  return row.status === "active" && row.endDate >= today ? "สัญญายังไม่หมดอายุ ปิดไม่ได้ — ถ้าต้องการเลิกก่อนกำหนดให้ใช้ “ยกเลิกสัญญา”" : null;
}

function addDays(date: string, days: number): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

const bangkokDate = (ts: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

/** วันที่เร็วสุดที่เลือกได้ (ตรง CL005) */
export function minActionDate(row: Pick<CollectionRow, "startDate" | "endDate" | "closedAt" | "cancelledAt">): string {
  let from = addDays(row.endDate, 1);
  if (row.cancelledAt) from = from < bangkokDate(row.cancelledAt) ? from : bangkokDate(row.cancelledAt);
  if (row.closedAt) from = from < bangkokDate(row.closedAt) ? from : bangkokDate(row.closedAt);
  return from > row.startDate ? from : row.startDate;
}

/** จำนวนที่ต้องจัดการทั้งหมดบนจอ = IG ที่ไม่ได้ย้ายไปสัญญาใหม่ */
export function igBase(row: Pick<CollectionRow, "igTotal" | "moved">): number {
  return Math.max(0, row.igTotal - row.moved);
}

/** ผู้ใช้บทบาทนี้กดบันทึก "เก็บแล้ว/ไม่เก็บ" แถวนี้ได้หรือไม่ (DB ตรวจซ้ำ · admin ดูอย่างเดียว) */
export function canRecordRow(role: UserRole, divisionScope: readonly string[], row: Pick<CollectionRow, "division">): boolean {
  if (role === "host") return true;
  if (role === "recorder") return divisionScope.includes(row.division);
  return false;
}

/** เดือนที่จัดการครบ: remaining = 0 → เดือนของวันล่าสุดที่เก็บ/ไม่เก็บ · ยังค้าง/ไม่มีประวัติ = null */
export function finishMonthOf(remaining: number, last: Pick<LastAction, "date"> | null): string | null {
  if (remaining > 0 || !last) return null;
  return last.date.slice(0, 7);
}

/** เลือกการเก็บ/ไม่เก็บล่าสุดจากแถวรายเดือนของ view (ข้าม moved_to_renewal) */
export function pickLastAction(
  groups: readonly { kind: string; team_id: string | null; last_on: string | null; reasons: string[] | null }[],
): LastAction | null {
  let best: LastAction | null = null;
  for (const g of groups) {
    if ((g.kind !== "collected" && g.kind !== "not_collected") || !g.last_on) continue;
    const date = g.last_on.slice(0, 10);
    const kind = g.kind;
    // วันเดียวกันมีทั้งเก็บและไม่เก็บ: ให้ "ไม่เก็บ" ชนะ (มีเหตุผลต้องโชว์)
    if (!best || date > best.date || (date === best.date && kind === "not_collected" && best.kind === "collected")) {
      best = { date, kind, teamId: g.team_id, reasons: kind === "not_collected" ? [...(g.reasons ?? [])] : [] };
    }
  }
  return best;
}

export function statusMatches(row: CollectionRow, filter: StatusFilter, currentMonth: string): boolean {
  switch (filter) {
    case "all":
      return true;
    case "wait":
      return row.remaining > 0;
    case "done":
      return row.remaining === 0 && row.notCollected === 0;
    case "skip":
      return row.notCollected > 0;
    case "open":
    default:
      // ค้าง + ยังไม่ปิดสัญญา + ปิดเรื่องเดือนนี้ (mockup)
      return row.remaining > 0 || row.status !== "closed" || row.finishMonth === currentMonth;
  }
}

export function monthMatches(row: Pick<CollectionRow, "endDate">, filter: MonthFilter): boolean {
  const m = row.endDate.slice(0, 7);
  if (filter.kind === "all") return true;
  if (filter.kind === "month") return m === filter.month;
  let { from, to } = filter;
  if (from && to && from > to) [from, to] = [to, from];
  return (!from || m >= from) && (!to || m <= to);
}

const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function filterRows(
  rows: readonly CollectionRow[],
  opts: { month: MonthFilter; status: StatusFilter; query: string; currentMonth: string },
): CollectionRow[] {
  const q = norm(opts.query);
  return rows.filter(
    (r) =>
      monthMatches(r, opts.month) &&
      statusMatches(r, opts.status, opts.currentMonth) &&
      (!q || norm(r.customerName).includes(q) || norm(r.contractNo).includes(q)),
  );
}

export interface CollectionStats {
  /** ลูกค้า: เก็บครบเดือนนี้ / ลูกค้าไม่ให้เก็บ (ปิดเรื่องเดือนนี้) / ยังต้องเข้าเก็บ (ค้างทั้งหมด) */
  customersDone: number;
  customersSkip: number;
  customersWait: number;
  /** สถานี IG: เก็บแล้วเดือนนี้ / ไม่เก็บเดือนนี้ / ยังไม่ได้เก็บ (ค้างทั้งหมด) */
  stationsCollectedMonth: number;
  stationsSkippedMonth: number;
  stationsRemaining: number;
}

/** การ์ดสรุป "ค้างทั้งหมด + ทำเดือนนี้" (mockup แบบ A) — นับจากทุกแถว ไม่ขึ้นกับตัวกรอง */
export function computeStats(rows: readonly CollectionRow[], currentMonth: string): CollectionStats {
  const s: CollectionStats = {
    customersDone: 0,
    customersSkip: 0,
    customersWait: 0,
    stationsCollectedMonth: 0,
    stationsSkippedMonth: 0,
    stationsRemaining: 0,
  };
  for (const r of rows) {
    if (r.remaining > 0) s.customersWait++;
    else if (r.finishMonth === currentMonth) {
      if (r.notCollected > 0) s.customersSkip++;
      else s.customersDone++;
    }
    s.stationsCollectedMonth += r.collectedThisMonth;
    s.stationsSkippedMonth += r.notCollectedThisMonth;
    s.stationsRemaining += r.remaining;
  }
  return s;
}

/** เดือนที่หมดสัญญา (สำหรับตัวเลือกกรอง) เรียงใหม่→เก่า ไม่ซ้ำ */
export function endMonths(rows: readonly Pick<CollectionRow, "endDate">[]): string[] {
  return [...new Set(rows.map((r) => r.endDate.slice(0, 7)))].sort().reverse();
}

/** ใช้ผลที่ RPC ตอบกลับอัปเดตแถวในหน้าทันที (ก่อน refresh จริง) */
export function applyActionResult(
  row: CollectionRow,
  action: { kind: "collected" | "not_collected"; count: number; remaining: number; date: string; teamId: string; reason: string | null },
  currentMonth: string,
): CollectionRow {
  const inMonth = action.date.slice(0, 7) === currentMonth;
  const last: LastAction = {
    date: action.date,
    kind: action.kind,
    teamId: action.teamId,
    reasons: action.kind === "not_collected" && action.reason ? [action.reason] : [],
  };
  // ไม่ย้อนวันล่าสุดถ้าบันทึกวันที่เก่ากว่าของเดิม
  const keepOld = row.last && row.last.date > last.date ? row.last : last;
  return {
    ...row,
    collected: row.collected + (action.kind === "collected" ? action.count : 0),
    notCollected: row.notCollected + (action.kind === "not_collected" ? action.count : 0),
    remaining: action.remaining,
    last: keepOld,
    finishMonth: finishMonthOf(action.remaining, keepOld),
    collectedThisMonth: row.collectedThisMonth + (inMonth && action.kind === "collected" ? action.count : 0),
    notCollectedThisMonth: row.notCollectedThisMonth + (inMonth && action.kind === "not_collected" ? action.count : 0),
  };
}
