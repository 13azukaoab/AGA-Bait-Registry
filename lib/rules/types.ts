export type Tier = "S" | "M" | "L" | "XL";
export type TermYears = 1 | 3;

/**
 * เกณฑ์ Tier: ใช้ขอบล่าง (minAnnual) เรียงจากน้อยไปมาก เลือก tier ที่ minAnnual <= annual สูงสุด
 * M20 (DECISIONS 2.31): `effectiveMonth` = เดือนที่ชุดเกณฑ์นี้เริ่มใช้ (`tier_rules.effective_month`
 * รับได้ทั้ง 'YYYY-MM' และ 'YYYY-MM-01') · ไม่ระบุ = ชุดเดียวแบบเดิม ใช้ได้ทุกเดือน
 */
export interface TierRule {
  tier: Tier;
  minAnnual: number;
  effectiveMonth?: string;
}

export type VisitType = "routine" | "problem" | "follow_up";

export interface Contract {
  id: string;
  startDate: string; // 'YYYY-MM-DD'
  termYears: TermYears;
  valueTotal: number; // มูลค่าสัญญาเต็ม
  cancelledAt?: string; // 'YYYY-MM-DD' | undefined
  /** M18: วันที่ตั้งสถานีในระบบ (contracts.stations_initialized_at) — ใช้เป็นจุดเริ่มนับตกบริการ */
  stationsInitializedAt?: string; // 'YYYY-MM-DD' หรือ timestamptz (monthOf แปลงเป็นเวลาไทยให้)
  /** M18 / 2.47: สัญญานี้ต่อมาจากสัญญาไหน (contracts.renewed_from_contract_id) */
  renewedFromContractId?: string;
  /** M28 / 2.51: ลูกค้าของสัญญา (contracts.customer_id) — ใช้ตรวจ "มีสัญญา New ที่ใหม่กว่า" (isSuperseded) */
  customerId?: string;
  /** M28 / 2.51: วันสิ้นสุด 'YYYY-MM-DD' (contracts.end_date · ว่าง = วันเริ่ม + N ปี − 1 วัน) */
  endDate?: string;
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
 * สถานะที่หน้าจอแสดง 4 แบบ (DECISIONS 2.45 + 2.47)
 * pending = รอตัดสิน · made_up = ชดเชยแล้ว (มีการเข้าชดเชยที่ผูกไว้) · waived = ไม่ชดเชย
 * · void_renewed = โมฆะ (ต่อสัญญาแล้ว — DECISIONS 2.47 · คำนวณเอง ไม่ต้องกด)
 */
export type MissedResolutionStatus = "pending" | "made_up" | "waived" | "void_renewed";

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
