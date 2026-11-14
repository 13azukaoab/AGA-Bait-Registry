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
  /** M18: วันที่ตั้งสถานีในระบบ (contracts.stations_initialized_at) — ใช้เป็นจุดเริ่มนับตกบริการ */
  stationsInitializedAt?: string; // 'YYYY-MM-DD' ตามเวลา Asia/Bangkok (ตัวแปลงต้องแปลง timestamptz เป็นวันที่ไทยก่อน)
}

export interface Visit {
  contractId: string;
  visitDate: string; // 'YYYY-MM-DD'
  visitType: VisitType;
  /** M18: การเข้านี้เป็น "ชดเชยของเดือน" 'YYYY-MM' (ไม่นับเป็น routine ของเดือนตัวเอง) */
  makeupForMonth?: string;
}

/** M18 (DECISIONS 2.41): การตัดสินต่อ 1 เดือนที่ตกบริการ · ไม่มีแถว = รอตัดสิน */
export type MissedResolutionKind = "makeup" | "waived";

export interface MissedServiceResolution {
  contractId: string;
  missedMonth: string; // 'YYYY-MM'
  kind: MissedResolutionKind;
  makeupMonth?: string; // 'YYYY-MM' เมื่อ kind = makeup (= เดือนของการเข้าชดเชย ระบบตั้งให้)
}

/**
 * สถานะที่หน้าจอแสดง 3 แบบ (DECISIONS 2.45 — ไม่เลือกเดือนชดเชยล่วงหน้า)
 * pending = รอตัดสิน · made_up = ชดเชยแล้ว (มีการเข้าชดเชยที่ผูกไว้) · waived = ไม่ชดเชย
 */
export type MissedResolutionStatus = "pending" | "made_up" | "waived";

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
