import type { DashboardRow } from "./types";

/**
 * แปลงแถว snapshot (จาก lib/rules — มี value_annual) เป็นแถว Dashboard **16 ฟิลด์เป๊ะ**
 * โดย **ตัด value_annual ทิ้ง** (เฟส 1 ไม่ส่งเข้า Dashboard · CLAUDE.md กฎ 4)
 * สร้าง object ใหม่โดยระบุคีย์ครบ 16 ตัวตามลำดับ §9.1 — การันตีว่าไม่มีฟิลด์เกินหลุดเข้า Dashboard
 */
export function toDashboardRow(row: DashboardRow): DashboardRow {
  return {
    area: row.area,
    branch: row.branch,
    s1: row.s1,
    s3: row.s3,
    m1: row.m1,
    m3: row.m3,
    l1: row.l1,
    l3: row.l3,
    xl1: row.xl1,
    xl3: row.xl3,
    cust: row.cust,
    vS: row.vS,
    vM: row.vM,
    vL: row.vL,
    vXL: row.vXL,
    value: row.value,
  };
}
