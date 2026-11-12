/**
 * ชนิดข้อมูลของหน้า "กรอกข้อมูลทำบริการประจำเดือน" (/service · SPEC v1.8 §8.1)
 *
 * Logic summary:
 *   * ฝั่งอ่าน (`data.ts`) แปลง snake_case ของฐานข้อมูลเป็น camelCase ที่เดียว
 *   * `FormState` = สิ่งที่ผู้ใช้กรอกบนจอ (ข้อความดิบ) · `buildPayload.ts` แปลงเป็นข้อมูลส่ง `save_service_visit`
 *   * เลขสถานีในฟอร์มเป็นข้อความ (พิมพ์เอง) — แปลงเป็น station id ตอนสร้าง payload จากสถานีที่โหลดมา
 */
import type { Tier } from "@/lib/rules";

export type StationType = "IG" | "IC" | "AG";
export type VisitType = "routine" | "problem" | "follow_up";
export type TermiteGroup = "subterranean" | "garden";
export type StationStatus =
  | "active"
  | "eliminated"
  | "pending_removal"
  | "removed"
  | "lost"
  | "withdrawn";
export type WorkKind = "cap_replaced" | "lost" | "withdrawn" | "other" | "added";
export type ContractStatus = "active" | "expired_pending_collection" | "closed" | "cancelled";

/** สถานะที่ถือว่า "ยังใช้งาน" (ตรงกับ unique index `stations_in_use_no_key`) */
export const IN_USE_STATUSES: readonly StationStatus[] = ["active", "eliminated", "pending_removal"];
export function isInUse(status: StationStatus): boolean {
  return IN_USE_STATUSES.includes(status);
}

/** ทีมที่เลือกได้ในหน้านี้ = A–O และ Z เท่านั้น (ทีม Sup ฐานข้อมูลปฏิเสธ SV006) */
export interface TeamOption {
  id: string;
  code: string;
}
export interface ZoneOption {
  id: string;
  name: string;
}
export interface BranchOption {
  id: string;
  name: string;
  zoneId: string;
}

/** รายการสัญญาฝั่งซ้าย */
export interface ContractListItem {
  contractId: string;
  contractNo: string;
  customerId: string;
  customerName: string;
  branchId: string;
  status: ContractStatus;
  tier: Tier;
  termYears: 1 | 3;
  /** สัญญา Renew ผูกกับสัญญาเก่า (ใช้เสนอย้ายสถานีตอนตั้งสถานีครั้งแรก) */
  renewedFromContractId: string | null;
  /** null = ยังไม่ระบุจำนวนสถานี */
  stationsInitialized: boolean;
  /** จำนวนกล่อง AG ที่ยังใช้งาน */
  agCount: number;
  /** มีการเข้าบริการในเดือนที่เลือกแล้วหรือไม่ ("กรอกแล้ว") */
  visitCountInMonth: number;
}

export interface StationRow {
  id: string;
  type: StationType;
  no: number | null;
  status: StationStatus;
  pointLabel: string;
}

export interface CheckRow {
  stationId: string;
  checked: boolean;
  termiteGroup: TermiteGroup | null;
  termiteCaste: string | null;
  baitAddedG: number | null;
  baitEatenPct: number | null;
  powderPoints: number | null;
  timberReplaced: boolean;
  followUpNo: number | null;
}

export interface WorkRowDb {
  id: string;
  kind: WorkKind;
  stationType: StationType;
  stationNos: number[];
  detail: string;
}

export interface VisitSummary {
  id: string;
  visitDate: string;
  visitType: VisitType;
  startTime: string;
  endTime: string;
}

/** การเข้าที่โหลดมาแก้ (พร้อมทีม/ผลตรวจ/งานซ่อม) */
export interface LoadedVisit extends VisitSummary {
  teamIds: string[];
  checks: CheckRow[];
  works: WorkRowDb[];
}

/** รอบก่อนของกล่อง AG: เลข F ล่าสุดที่ตรวจจริงก่อนวันที่เข้า (ไว้แสดง "F ถัดไป") */
export interface AgHistory {
  stationId: string;
  /** วันที่ + F ของผลตรวจที่ตรวจจริง (ไม่รวมการเข้าที่กำลังแก้) */
  checks: { visitDate: string; followUpNo: number }[];
}

export interface ContractDetail {
  contractId: string;
  stations: StationRow[];
  stationsTruncated: boolean;
  /** สถานีที่ใช้งานของสัญญาเก่า (เฉพาะสัญญา Renew ที่ยังไม่ตั้งสถานี) */
  oldStations: StationRow[];
  /** การเข้าทั้งหมดในเดือนที่เลือก (เรียงวันที่) */
  visitsInMonth: VisitSummary[];
  /** ทีมของการเข้าครั้งล่าสุดของสัญญา (ไว้เติมค่าเริ่มต้น) */
  lastTeamIds: string[];
  agHistory: AgHistory[];
}

// ------------------------------------------------------------------
// ฟอร์ม
// ------------------------------------------------------------------

export type BaitSelect = "" | "0" | "50" | "100" | "150" | "200" | "other";
export type EatenSelect = "" | "0" | "25" | "50" | "75" | "100";

/** พบปลวก (IG/IC) — 1 แถว = 1 สถานี */
export interface FindingRow {
  key: string;
  type: "IG" | "IC";
  noText: string;
  group: TermiteGroup | "";
  baitSelect: BaitSelect;
  baitCustom: string;
  eaten: EatenSelect;
  powderText: string;
}

/** เปลี่ยนไม้ล่อ — 1 แถวใส่ได้หลายเลข ("3, 5, 8-12") */
export interface TimberRow {
  key: string;
  type: "IG" | "IC";
  noText: string;
}

export interface WorkRow {
  /** uuid · แถวที่โหลดจากฐานข้อมูลใช้ id เดิม (ห้ามเปลี่ยน ไม่งั้นฐานข้อมูลย้อนผลแล้วทำใหม่) */
  id: string;
  kind: WorkKind;
  type: StationType;
  noText: string;
  detail: string;
}

export type AgStatusChoice = "active" | "pending_removal" | "removed";
export type CasteChoice = "" | "none" | string;

export interface AgPointState {
  stationId: string;
  no: number | null;
  /** สถานะเดิมในฐานข้อมูล */
  statusDb: StationStatus;
  statusChoice: AgStatusChoice | "locked";
  label: string;
  labelDb: string;
  skip: boolean;
  baitSelect: BaitSelect;
  baitCustom: string;
  eaten: EatenSelect;
  caste: CasteChoice;
  /** F ที่เก็บไว้แล้วในฐานข้อมูล (แก้การเข้าเดิม) */
  savedFollowUpNo: number | null;
}

export interface SetupState {
  igCount: string;
  icCount: string;
  /** Renew: สถานีเก่าที่ "ไม่" ย้าย (ติ๊กออก) */
  excludedOldIds: string[];
  /** Renew: จำนวนสถานีใหม่ที่เพิ่ม (ระบบตั้งเลขต่อจากเลขสูงสุดที่ย้ายมา) */
  extraIg: string;
  extraIc: string;
}

export interface FormState {
  visitId: string;
  /** true = การเข้านี้มีในฐานข้อมูลแล้ว (แก้ไข) */
  isExisting: boolean;
  teamIds: string[];
  visitDate: string;
  timeIn: string;
  timeOut: string;
  visitType: VisitType;
  normal: boolean;
  findings: FindingRow[];
  timbers: TimberRow[];
  works: WorkRow[];
  ag: AgPointState[];
  /** กล่อง AG ใหม่ (S) — บันทึกเฉพาะเลขกล่อง */
  skipAllAg: boolean;
  setup: SetupState;
}

/** ข้อความ "ยังขาด" ของฟอร์ม + ช่องที่ต้องเลื่อนไปหา */
export interface MissingItem {
  message: string;
  /** id ของช่อง/หมวดใน DOM (data-field) */
  field: string;
}
