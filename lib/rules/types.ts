export type Tier = "S" | "M" | "L" | "XL";
export type TermYears = 1 | 3;

/** เกณฑ์ Tier: ใช้ขอบล่าง (minAnnual) เรียงจากน้อยไปมาก เลือก tier ที่ minAnnual <= annual สูงสุด */
export interface TierRule {
  tier: Tier;
  minAnnual: number;
}

export type VisitType = "routine" | "problem" | "follow_up";

export interface Contract {
  id: string;
  startDate: string; // 'YYYY-MM-DD'
  termYears: TermYears;
  valueTotal: number; // มูลค่าสัญญาเต็ม
  cancelledAt?: string; // 'YYYY-MM-DD' | undefined
}

export interface Visit {
  contractId: string;
  visitDate: string; // 'YYYY-MM-DD'
  visitType: VisitType;
}

export interface BranchRef {
  area: string; // เช่น 'เขต 1'
  branch: string; // ชื่อสาขา (สะกดตรงกับ Dashboard)
}

/** แถว 16 ฟิลด์ตาม SPEC §9.1 + value_annual (ไม่ส่ง Dashboard เฟส 1) */
export interface SnapshotRow {
  area: string;
  branch: string;
  s1: number;
  s3: number;
  m1: number;
  m3: number;
  l1: number;
  l3: number;
  xl1: number;
  xl3: number;
  cust: number;
  vS: number;
  vM: number;
  vL: number;
  vXL: number;
  value: number;
  value_annual: number;
}
