import { BRANCHES, BRANCH_COUNT, BRANCH_NAMES } from "./branches";
import type { DashboardData } from "./types";

/** 16 ฟิลด์ที่ dashboard_data.json ต้องมีต่อแถว (SPEC §9.1) — ห้ามมีฟิลด์เกิน (เช่น value_annual) */
const REQUIRED_FIELDS = [
  "area", "branch",
  "s1", "s3", "m1", "m3", "l1", "l3", "xl1", "xl3",
  "cust", "vS", "vM", "vL", "vXL", "value",
] as const;

/**
 * ตรวจไฟล์ dashboard_data.json ว่าถูกต้องตาม SPEC §9.1 ก่อนส่งขึ้น Dashboard (guard)
 * โยน Error ถ้าพบปัญหา — ให้เรียกก่อน commit ไฟล์ขึ้น repo Dashboard (§9.2)
 *
 * ตรวจ: ทุกเดือนครบ 43 สาขา, ชื่อสาขาสะกดตรง, ไม่มีสาขาซ้ำ, ทุกแถวมี 16 ฟิลด์เป๊ะ (ไม่ขาดไม่เกิน)
 */
export function assertValidDashboardData(data: DashboardData): void {
  for (const [month, rows] of Object.entries(data)) {
    if (rows.length !== BRANCH_COUNT) {
      throw new Error(
        `dashboard: เดือน ${month} มี ${rows.length} สาขา (ต้องครบ ${BRANCH_COUNT})`,
      );
    }

    const seen = new Set<string>();
    for (const row of rows) {
      if (!BRANCH_NAMES.has(row.branch)) {
        throw new Error(
          `dashboard: เดือน ${month} มีสาขา "${row.branch}" ที่ไม่รู้จัก — ตรวจการสะกด`,
        );
      }
      if (seen.has(row.branch)) {
        throw new Error(`dashboard: เดือน ${month} มีสาขา "${row.branch}" ซ้ำ`);
      }
      seen.add(row.branch);

      const keys = Object.keys(row);
      if (keys.length !== REQUIRED_FIELDS.length) {
        throw new Error(
          `dashboard: เดือน ${month} สาขา "${row.branch}" มี ${keys.length} ฟิลด์ (ต้อง ${REQUIRED_FIELDS.length}) — ห้ามมีฟิลด์เกิน เช่น value_annual`,
        );
      }
      for (const f of REQUIRED_FIELDS) {
        if (!(f in row)) {
          throw new Error(
            `dashboard: เดือน ${month} สาขา "${row.branch}" ขาดฟิลด์ "${f}"`,
          );
        }
      }
    }

    // ครบ 43 ชื่อไม่ซ้ำ + เท่ากับจำนวนมาตรฐาน = ครบทุกสาขาพอดี
    if (seen.size !== BRANCHES.length) {
      throw new Error(
        `dashboard: เดือน ${month} มีสาขาไม่ครบ (${seen.size}/${BRANCHES.length})`,
      );
    }
  }
}
