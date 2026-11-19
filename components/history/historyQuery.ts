/**
 * สร้างเงื่อนไข query ของ audit_log จากตัวกรอง + keyset cursor (pure — ทดสอบด้วย builder จำลอง)
 *
 * Logic summary:
 *   * เรียง `changed_at DESC, id DESC` · แบ่งหน้าแบบ keyset (ห้าม offset): หน้าถัดไป = แถวที่
 *       changed_at < T  หรือ  (changed_at = T และ id < ID)
 *     T คือ string ดิบจากฐานข้อมูล (ไมโครวินาที) ใส่เครื่องหมายคำพูดเพราะมี ":" และ "+"
 *   * ดึง PAGE_SIZE + 1 แถว เพื่อรู้ว่ามีหน้าต่อไปหรือไม่ (แถวเกินไม่แสดง)
 *   * ช่วงวันที่: วันไทย [from 00:00, to+1 00:00) แปลงเป็น UTC (ไทย = UTC+7 ไม่มี DST)
 *   * เงื่อนไข OR หลายก้อน (ประเภท "อื่นๆ" / แก้หลังปิด / cursor) รวมเป็น `and(or(..),or(..))` ใน `.or()` ตัวเดียว
 *     เพราะ `.or()` ซ้ำหลายครั้งไม่รับประกันว่า PostgREST จะ AND กัน
 *   * สาขา: เลือกเขต → แปลงเป็นรายการ branch_id · เลือกทั้งเขตและสาขา = สาขานั้นต้องอยู่ในเขตที่เลือกด้วย
 *   * ไม่มีข้อความอิสระใน query เลย — ค่าที่ส่งเป็น uuid / enum / วันที่ / เดือนเท่านั้น
 */
import { addDays } from "./historyFilters";
import { closureSince } from "./historyClosure";
import { CLOSURE_TABLES, knownTables, tablesOfKinds } from "./historyLabels";
import type { BranchRef, ClosureRef, HistoryFilters } from "./historyTypes";

export const PAGE_SIZE = 50;

export interface Cursor {
  /** changed_at ดิบของแถวสุดท้ายในหน้าก่อน */
  changedAt: string;
  id: string;
}

/** ส่วนของ builder ที่ใช้ — ตรงกับ PostgrestFilterBuilder (cast ที่ชั้น historyData) */
export interface FilterLike {
  in(column: string, values: readonly string[]): this;
  gte(column: string, value: string): this;
  lt(column: string, value: string): this;
  eq(column: string, value: string): this;
  or(expression: string): this;
  not(column: string, operator: string, value: string): this;
}

/** วันไทย → ช่วงเวลา UTC [gte, lt) */
export function bangkokRangeUtc(from: string, to: string): { gte: string; lt: string } {
  return {
    gte: new Date(`${from}T00:00:00+07:00`).toISOString(),
    lt: new Date(`${addDays(to, 1)}T00:00:00+07:00`).toISOString(),
  };
}

/** เดือน YYYY-MM → ช่วงวันที่ [start, endExclusive) ของ visit_date */
export function monthDateRange(ym: string): { start: string; endExclusive: string } {
  const [y = 0, m = 1] = ym.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start: `${ym}-01`, endExclusive: `${next}-01` };
}

const q = (v: string) => `"${v}"`;

export function cursorClause(c: Cursor): string {
  return `changed_at.lt.${q(c.changedAt)},and(changed_at.eq.${q(c.changedAt)},id.lt.${c.id})`;
}

/** รายการ branch_id ที่ตัวกรองสาขา/เขตอนุญาต · null = ไม่กรอง */
export function allowedBranchIds(f: Pick<HistoryFilters, "zones" | "branches">, branches: readonly BranchRef[]): string[] | null {
  if (f.zones.length === 0 && f.branches.length === 0) return null;
  const inZone = (b: BranchRef) => f.zones.length === 0 || f.zones.includes(b.zoneId);
  if (f.branches.length > 0) return branches.filter((b) => f.branches.includes(b.id) && inZone(b)).map((b) => b.id);
  return branches.filter(inZone).map((b) => b.id);
}

/** เงื่อนไข "แก้หลังปิด" ฝั่งฐานข้อมูล · null = ไม่มีส่วนไหนปิดเลย (ผลย่อมว่าง) */
export function postCloseClause(closures: readonly ClosureRef[], branches: readonly BranchRef[]): string | null {
  const parts: string[] = [];
  for (const c of closures) {
    const since = closureSince(c);
    if (!since) continue;
    const ids = branches.filter((b) => b.division === c.scope).map((b) => b.id);
    if (ids.length === 0) continue;
    parts.push(`and(month_key.eq.${c.monthKey},branch_id.in.(${ids.join(",")}),changed_at.gt.${q(since)})`);
  }
  return parts.length ? parts.join(",") : null;
}

/** รวมก้อน OR หลายก้อนเป็นนิพจน์เดียวสำหรับ `.or()` */
export function combineOrGroups(groups: readonly string[]): string | null {
  if (groups.length === 0) return null;
  if (groups.length === 1) return groups[0] ?? null;
  return `and(${groups.map((g) => `or(${g})`).join(",")})`;
}

export interface QueryContext {
  branches: readonly BranchRef[];
  closures: readonly ClosureRef[];
}

/** ใส่ตัวกรองทั้งหมดลงบน builder · คืน null เมื่อรู้แน่ว่าผลว่าง (ไม่ต้องยิง query) */
export function applyAuditFilters<Q extends FilterLike>(
  query: Q,
  f: HistoryFilters,
  ctx: QueryContext,
  cursor: Cursor | null,
): Q | null {
  let qy = query;
  const range = bangkokRangeUtc(f.from, f.to);
  qy = qy.gte("changed_at", range.gte).lt("changed_at", range.lt);

  if (f.people.length) qy = qy.in("changed_by", f.people);
  const branchIds = allowedBranchIds(f, ctx.branches);
  if (branchIds) {
    if (branchIds.length === 0) return null;
    qy = qy.in("branch_id", branchIds);
  }
  if (f.contractId) qy = qy.eq("contract_id", f.contractId);
  if (f.months.length) qy = qy.in("month_key", f.months);
  if (f.actions.length) qy = qy.in("action", f.actions);

  const orGroups: string[] = [];
  if (f.kinds.length) {
    const wantOther = f.kinds.includes("other");
    const tables = tablesOfKinds(f.kinds);
    const known = `(${knownTables().join(",")})`;
    if (wantOther && tables.length) orGroups.push(`table_name.in.(${tables.join(",")}),table_name.not.in.${known}`);
    else if (wantOther) qy = qy.not("table_name", "in", known);
    else if (tables.length) qy = qy.in("table_name", tables);
    else return null;
  }
  if (f.postCloseOnly) {
    const clause = postCloseClause(ctx.closures, ctx.branches);
    if (!clause) return null;
    qy = qy.not("table_name", "in", `(${CLOSURE_TABLES.join(",")})`);
    orGroups.push(clause);
  }
  if (cursor) orGroups.push(cursorClause(cursor));

  const combined = combineOrGroups(orGroups);
  if (combined) qy = qy.or(combined);
  return qy;
}
