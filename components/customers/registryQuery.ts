/**
 * สร้างเงื่อนไข query ของทะเบียนสัญญาจากตัวกรอง + keyset cursor (pure — ทดสอบด้วย builder จำลอง)
 *
 * Logic summary:
 *   * แบ่งหน้าแบบ keyset (ห้าม offset): เรียงตามคอลัมน์ที่เลือก + `id` เป็นตัวตัดสินเมื่อค่าซ้ำ (ทิศเดียวกัน)
 *       asc  : แถวที่ col > V  หรือ (col = V และ id > ID)
 *       desc : แถวที่ col < V  หรือ (col = V และ id < ID)
 *     `end_date` ว่างได้ → ว่างอยู่ท้ายเสมอทั้งสองทิศ (nulls last) · cursor ของแถวที่ว่างใช้ id อย่างเดียวในกลุ่มว่าง
 *   * เรียงฝั่งฐานข้อมูลได้เฉพาะคอลัมน์ของ contracts: วันสิ้นสุด · มูลค่า · ค่าเริ่มต้น = วันเริ่มใหม่สุดก่อน
 *     (ชื่อลูกค้า/สาขา/Tier เรียงไม่ได้ — ดูหมายเหตุในรายงาน · ไม่เรียงเฉพาะหน้าที่โหลด เพราะจะหลอกว่าเรียงทั้งตาราง)
 *   * เงื่อนไข OR หลายก้อน (ค้นหา / cursor) รวมเป็น `and(or(..),or(..))` ใน `.or()` ตัวเดียว
 *     เพราะ `.or()` ซ้ำหลายครั้งไม่รับประกันว่า PostgREST จะ AND กัน
 *   * ไม่มีข้อความอิสระที่ยังไม่ผ่าน sanitizeSearch ใน query · ที่เหลือเป็น uuid / enum / ตัวเลข / วันที่
 */
import { dbStatusesFor } from "./registryStatus";
import type { BranchRef, Cursor, RegistryFilters, SortKey } from "./registryTypes";

export const PAGE_SIZE = 50;

export interface SortDef {
  column: "start_date" | "end_date" | "value_total";
  ascending: boolean;
  /** คอลัมน์ว่างได้ (ว่างอยู่ท้ายเสมอ) */
  nullable: boolean;
}

export const SORTS: Record<SortKey, SortDef> = {
  default: { column: "start_date", ascending: false, nullable: false },
  end_asc: { column: "end_date", ascending: true, nullable: true },
  end_desc: { column: "end_date", ascending: false, nullable: true },
  value_asc: { column: "value_total", ascending: true, nullable: false },
  value_desc: { column: "value_total", ascending: false, nullable: false },
};

/** ส่วนของ builder ที่ใช้ — ตรงกับ PostgrestFilterBuilder (cast ที่ชั้น registryData) */
export interface FilterLike {
  in(column: string, values: readonly string[]): this;
  eq(column: string, value: string | number): this;
  neq(column: string, value: string | number): this;
  or(expression: string): this;
}

/** เงื่อนไข cursor ของ keyset (สตริงสำหรับ `.or()`) */
export function cursorClause(sort: SortDef, c: Cursor): string {
  const col = sort.column;
  const cmp = sort.ascending ? "gt" : "lt";
  if (c.value === null) return `and(${col}.is.null,id.${cmp}.${c.id})`;
  const parts = [`${col}.${cmp}.${c.value}`, `and(${col}.eq.${c.value},id.${cmp}.${c.id})`];
  if (sort.nullable) parts.push(`${col}.is.null`);
  return parts.join(",");
}

/** ก้อนค้นหา: เลขสัญญา หรือ ชื่อลูกค้า (ILIKE · ใช้ * เป็นตัวแทนอักขระ) — `q` ต้องผ่าน sanitizeSearch แล้ว */
export function searchClause(q: string): string {
  return `contract_no.ilike.*${q}*,customers.name.ilike.*${q}*`;
}

/** รวมก้อน OR หลายก้อนเป็นนิพจน์เดียวสำหรับ `.or()` */
export function combineOrGroups(groups: readonly string[]): string | null {
  if (groups.length === 0) return null;
  if (groups.length === 1) return groups[0] ?? null;
  return `and(${groups.map((g) => `or(${g})`).join(",")})`;
}

/** รายการ branch_id ที่ตัวกรองสาขา/เขตอนุญาต · null = ไม่กรอง */
export function allowedBranchIds(f: Pick<RegistryFilters, "zones" | "branches">, branches: readonly BranchRef[]): string[] | null {
  if (f.zones.length === 0 && f.branches.length === 0) return null;
  const inZone = (b: BranchRef) => f.zones.length === 0 || f.zones.includes(b.zoneId);
  if (f.branches.length > 0) return branches.filter((b) => f.branches.includes(b.id) && inZone(b)).map((b) => b.id);
  return branches.filter(inZone).map((b) => b.id);
}

/**
 * ใส่ตัวกรองทั้งหมดลงบน builder · คืน null เมื่อรู้แน่ว่าผลว่าง (ไม่ต้องยิง query)
 * `search` = คำค้นที่ผ่าน sanitizeSearch แล้ว ("" = ไม่ค้น)
 */
export function applyRegistryFilters<Q extends FilterLike>(
  query: Q,
  f: RegistryFilters,
  branches: readonly BranchRef[],
  search: string,
  cursor: Cursor | null,
): Q | null {
  let qy = query;
  const branchIds = allowedBranchIds(f, branches);
  if (branchIds) {
    if (branchIds.length === 0) return null;
    qy = qy.in("customers.branch_id", branchIds);
  }
  if (f.years === "3") qy = qy.eq("term_months", 36);
  else if (f.years === "1") qy = qy.neq("term_months", 36);

  const statuses = dbStatusesFor(f.statuses);
  if (statuses) qy = qy.in("status", statuses);

  const orGroups: string[] = [];
  if (search) orGroups.push(searchClause(search));
  if (cursor) orGroups.push(cursorClause(SORTS[f.sort], cursor));
  const combined = combineOrGroups(orGroups);
  if (combined) qy = qy.or(combined);
  return qy;
}
