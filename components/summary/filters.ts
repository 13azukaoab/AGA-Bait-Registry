/**
 * filters — ค่าเริ่มต้นและการเทียบ "ตัวกรองต่างจากค่าเริ่มต้นไหม" ของหน้า /summary
 *
 * Logic summary:
 *   * `defaultFilters(months)` เป็นจุดเดียวที่กำหนดค่าเริ่มต้น (ใช้ทั้งตอนโหลดหน้า และตอนกด "ล้างตัวกรอง")
 *   * `isDefaultFilters` ใช้ตัดสินว่าจะแสดงปุ่ม "ล้างตัวกรอง" หรือไม่ — ต่างจากค่าเริ่มต้นข้อใดข้อหนึ่งก็แสดง
 *   * `months` ต้องเรียงจากใหม่ไปเก่า (เดือนเริ่มต้น = เดือนล่าสุด = ตัวแรก)
 */
import type { Division, RankSort, Tier } from "./calc";

export interface SummaryFilters {
  month: string;
  division: Division | "all";
  zone: string;
  branch: string;
  tiers: ReadonlySet<Tier>;
  sortBy: RankSort;
}

export function defaultFilters(months: readonly string[]): SummaryFilters {
  return {
    month: months[0] ?? "",
    division: "all",
    zone: "all",
    branch: "all",
    tiers: new Set<Tier>(),
    sortBy: "value",
  };
}

export function isDefaultFilters(current: SummaryFilters, months: readonly string[]): boolean {
  const d = defaultFilters(months);
  return (
    current.month === d.month &&
    current.division === d.division &&
    current.zone === d.zone &&
    current.branch === d.branch &&
    current.tiers.size === 0 &&
    current.sortBy === d.sortBy
  );
}
