/**
 * กฎ "แก้หลังปิดเดือน" ของหน้าประวัติ (SPEC §8.2 · §7.7) — ต้องตรงกับ RPC list_post_close_edits ทุกข้อ
 *
 * Logic summary:
 *   * แถว audit ถือว่า "แก้หลังปิด" เมื่อ:
 *       1. มี month_key และ branch_id (ไม่มีสาขา = ระบุส่วนไม่ได้ → ไม่ติดป้าย)
 *       2. ตารางไม่ใช่ month_closures / month_closure_overrides (เป็นการปิด/แก้ผู้ปิด ไม่ใช่การแก้ข้อมูล)
 *       3. มีการปิดของ (month_key, ส่วนของสาขา = branches.division) และ
 *          changed_at **มากกว่าเคร่ง** greatest(closed_at, last_resync_at)
 *          (แถว audit ของรอบปิด/คำนวณใหม่เองมีเวลาเท่ากับ closed_at จึงไม่นับ)
 *   * เทียบเวลาที่ระดับไมโครวินาที (ค่าดิบจาก PostgREST) — ผ่าน Date จะตัดเหลือมิลลิวินาทีแล้วเทียบเท่ากันผิด
 */
import { CLOSURE_TABLES } from "./historyLabels";
import type { AuditRow, BranchRef, ClosureRef } from "./historyTypes";

/** ISO timestamp (อาจมีเศษวินาทีถึง 6 หลัก) → ไมโครวินาทีนับจาก epoch · อ่านไม่ได้ = NaN */
export function tsToMicros(ts: string): number {
  const m = /\.(\d+)/.exec(ts);
  const frac = m ? m[1].padEnd(6, "0").slice(0, 6) : "000000";
  const trimmed = m ? ts.replace(/\.\d+/, `.${frac.slice(0, 3)}`) : ts;
  const ms = Date.parse(trimmed);
  return ms * 1000 + Number(frac.slice(3));
}

/** เวลาที่การปิดมีผล = ค่ามากสุดของ closed_at / last_resync_at · ไม่มี = null (ยังไม่ปิด) */
export function closureSince(c: ClosureRef): string | null {
  const times = [c.closedAt, c.lastResyncAt].filter((x): x is string => !!x);
  if (times.length === 0) return null;
  return times.reduce((a, b) => (tsToMicros(b) > tsToMicros(a) ? b : a));
}

export function isPostCloseEdit(
  row: Pick<AuditRow, "tableName" | "monthKey" | "branchId" | "changedAt">,
  branches: readonly BranchRef[],
  closures: readonly ClosureRef[],
): boolean {
  if (!row.monthKey || !row.branchId) return false;
  if (CLOSURE_TABLES.includes(row.tableName)) return false;
  const branch = branches.find((b) => b.id === row.branchId);
  if (!branch) return false;
  const closure = closures.find((c) => c.monthKey === row.monthKey && c.scope === branch.division);
  if (!closure) return false;
  const since = closureSince(closure);
  if (!since) return false;
  return tsToMicros(row.changedAt) > tsToMicros(since);
}
