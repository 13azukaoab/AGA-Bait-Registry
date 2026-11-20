/**
 * ตัวกรองหน้าทะเบียนลูกค้า/สัญญา — ค่าเริ่มต้น · แปลงไป-กลับกับ URL · ตัดคำค้นหา (pure function)
 *
 * Logic summary:
 *   * URL เก็บได้เฉพาะ id (uuid) / enum — **ไม่มีข้อความค้นหาชื่อลูกค้า/เลขสัญญาใน URL** (PDPA · URL ไปอยู่ใน log/history ได้)
 *     ข้อความค้นหาเป็น state ของหน้าอย่างเดียว · ค่าที่ไม่ผ่านรูปแบบถูกทิ้งเงียบๆ (ไม่ยิงฐานข้อมูลด้วยค่าแปลก)
 *   * ค้นหา: ตัดอักขระที่มีความหมายใน PostgREST/ILIKE ออก (`, ( ) " * % _ \`) แล้วตัดช่องว่างซ้ำ · สั้นกว่า 1 ตัว = ไม่ค้น
 */
import { STATUS_ORDER } from "./registryStatus";
import type { RegistryFilters, RegistryStatus, SizeCode, SortKey, YearsFilter } from "./registryTypes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SIZE_ORDER: readonly SizeCode[] = ["S", "M", "L", "XL"];
export const SORT_KEYS: readonly SortKey[] = ["default", "end_asc", "end_desc", "value_asc", "value_desc"];

/** ความยาวคำค้นสูงสุดที่ส่งเข้า query */
export const MAX_SEARCH_LENGTH = 60;

export function defaultFilters(): RegistryFilters {
  return { zones: [], branches: [], sizes: [], years: "", statuses: [], sort: "default" };
}

function csv(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  return raw ? raw.split(",").filter((x) => x !== "") : [];
}

/** อ่านตัวกรองจาก query string — ค่าผิดรูปแบบถูกทิ้ง */
export function filtersFromParams(params: URLSearchParams): RegistryFilters {
  const years = params.get("yr");
  const sort = params.get("sort");
  return {
    zones: csv(params, "zone").filter((x) => UUID_RE.test(x)),
    branches: csv(params, "br").filter((x) => UUID_RE.test(x)),
    sizes: csv(params, "size").filter((x): x is SizeCode => (SIZE_ORDER as readonly string[]).includes(x)),
    years: years === "1" || years === "3" ? (years as YearsFilter) : "",
    statuses: csv(params, "st").filter((x): x is RegistryStatus => (STATUS_ORDER as readonly string[]).includes(x)),
    sort: sort && (SORT_KEYS as readonly string[]).includes(sort) ? (sort as SortKey) : "default",
  };
}

/** แปลงตัวกรองเป็น query string — ใส่เฉพาะค่าที่ต่างจากค่าเริ่มต้น */
export function filtersToParams(f: RegistryFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.zones.length) p.set("zone", f.zones.join(","));
  if (f.branches.length) p.set("br", f.branches.join(","));
  if (f.sizes.length) p.set("size", f.sizes.join(","));
  if (f.years) p.set("yr", f.years);
  if (f.statuses.length) p.set("st", f.statuses.join(","));
  if (f.sort !== "default") p.set("sort", f.sort);
  return p;
}

/** จำนวนตัวกรองที่ใช้อยู่ (ไม่นับการเรียง · ไม่นับคำค้น) */
export function countActiveFilters(f: RegistryFilters): number {
  return f.zones.length + f.branches.length + f.sizes.length + (f.years ? 1 : 0) + f.statuses.length;
}

/** คำค้นที่ปลอดภัยต่อ query (ว่าง = ไม่ค้น) */
export function sanitizeSearch(raw: string): string {
  return raw
    .replace(/[,()"*%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);
}

/** ตัวกรองที่ฐานข้อมูลทำให้แม่นยำไม่ได้ — ต้องกรองซ้ำฝั่งแอป (Tier · สถานะที่แบ่งด้วยวันที่) */
export function needsPostFilter(f: RegistryFilters): boolean {
  return f.sizes.length > 0 || f.statuses.length > 0;
}

/** คอลัมน์ที่คลิกหัวเพื่อเรียงได้ */
export type SortColumn = "end" | "value";

/** คลิกหัวคอลัมน์: น้อย→มาก → มาก→น้อย → กลับลำดับเดิม (ตรงกับ mockup) · คลิกคอลัมน์อื่น = เริ่มที่ น้อย→มาก */
export function nextSort(current: SortKey, col: SortColumn): SortKey {
  const asc: SortKey = col === "end" ? "end_asc" : "value_asc";
  const desc: SortKey = col === "end" ? "end_desc" : "value_desc";
  if (current === asc) return desc;
  if (current === desc) return "default";
  return asc;
}

/** ทิศการเรียงของคอลัมน์นี้ในลำดับปัจจุบัน (ไว้ใส่ aria-sort) */
export function sortDirection(current: SortKey, col: SortColumn): "ascending" | "descending" | "none" {
  if (current === (col === "end" ? "end_asc" : "value_asc")) return "ascending";
  if (current === (col === "end" ? "end_desc" : "value_desc")) return "descending";
  return "none";
}
