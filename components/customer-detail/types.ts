/**
 * ชนิดข้อมูลของหน้า "รายละเอียดลูกค้า" (/customers/[id]) — SPEC §8 หน้า 4
 *
 * ทุกชนิดเป็น camelCase ที่แปลงจากแถวฐานข้อมูลแล้ว (data.ts) · ไม่มีฟิลด์ที่ viewer เห็นได้ (viewer เข้าหน้านี้ไม่ได้ — PDPA)
 * ค่าวันที่เป็น 'YYYY-MM-DD' · เดือนเป็น 'YYYY-MM'
 */
import type { UserRole } from "@/lib/db/types";

export type ContractStatus = "active" | "expired_pending_collection" | "closed" | "cancelled";
export type StationType = "IG" | "IC" | "AG";
/** `eliminated` เป็นค่าเก่าใน enum (ไม่ใช้แล้ว) — อ่านได้ ไม่ให้หน้าพัง */
export type StationStatus = "active" | "pending_removal" | "removed" | "lost" | "withdrawn" | "eliminated";
export type VisitType = "routine" | "problem" | "follow_up";

export interface CustomerInfo {
  id: string;
  name: string;
  address: string | null;
  /** ช่องเบอร์เดิม (customers.phone) — แสดงเป็นทางสำรองเมื่อ customer_phones ว่าง (รอ M19c) */
  legacyPhone: string | null;
  contactName: string | null;
  note: string | null;
  customerTypeLabel: string | null;
  branchId: string;
  branchName: string;
  zoneId: string;
  zoneName: string;
  /** แก้ข้อมูลติดต่อล่าสุด (ระบบประทับ) */
  contactUpdatedAt: string | null;
  contactUpdatedByName: string | null;
  contactCrossTeam: boolean;
}

export interface PhoneRow {
  id: string;
  phone: string;
  label: string | null;
  sortOrder: number;
}

export interface ContractRow {
  id: string;
  no: string;
  startDate: string;
  /** end_date จากฐานข้อมูล (ว่างได้) */
  endDate: string | null;
  termMonths: number;
  valueTotal: number;
  saleType: "new" | "renew" | null;
  status: ContractStatus;
  closedAt: string | null;
  cancelledAt: string | null;
  renewedFromId: string | null;
  stationsInitializedAt: string | null;
  teamCodes: string[];
  /** ป้าย Tier ของสัญญา (เกณฑ์ของเดือนเริ่มสัญญา — lib/rules) */
  tier: "S" | "M" | "L" | "XL";
}

export interface StationRow {
  id: string;
  contractId: string;
  type: StationType;
  no: number | null;
  /** รหัสที่แสดง เช่น IG-17 */
  code: string;
  pointLabel: string | null;
  installedAt: string | null;
  status: StationStatus;
  removedAt: string | null;
  collectedAt: string | null;
  notCollectedOn: string | null;
  notCollectedReason: string | null;
  /** ย้ายมาจากสัญญาเลขที่นี้ (Renew · station_transfers) */
  movedFromContractNo: string | null;
}

export interface VisitRow {
  id: string;
  contractId: string;
  date: string;
  type: VisitType;
  teamCodes: string[];
  startTime: string | null;
  endTime: string | null;
  durationMin: number | null;
  internalInspection: boolean | null;
  signedByProxy: boolean | null;
  timberPcs: number | null;
  baitIgIcG: number | null;
  baitAgG: number | null;
  powderPoints: number | null;
  firstInstall: boolean | null;
  note: string | null;
  createdByName: string | null;
  makeupForMonth: string | null;
}

export interface CheckRow {
  visitId: string;
  stationId: string;
  followUpNo: number | null;
  caste: string | null;
  termiteGroup: "subterranean" | "garden" | null;
  baitAddedG: number | null;
  note: string | null;
  checked: boolean;
}

export interface FileRow {
  id: string;
  contractId: string;
  kind: "contract_pdf" | "site_plan";
  version: number;
  isCurrent: boolean;
  storagePath: string;
  fileName: string;
  sizeBytes: number;
  reason: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
}

/** ผลตัดสิน 1 เดือนที่ตก (missed_service_resolutions) */
export interface ResolutionRow {
  contractId: string;
  missedMonth: string;
  kind: "makeup" | "waived";
  reason: string | null;
  evidencePath: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

/** เปลี่ยนไม้รายเดือนต่อสัญญา (v_contract_monthly_timber) */
export interface TimberMonth {
  contractId: string;
  month: string;
  igNos: number[];
  icNos: number[];
}

export interface AuditEntry {
  id: string;
  tableName: string;
  action: "insert" | "update" | "delete";
  at: string;
  byName: string | null;
  contractId: string | null;
  monthKey: string | null;
  /** ชื่อช่องที่เปลี่ยน (ไม่เก็บค่า — กันข้อมูลส่วนบุคคลรั่ว) */
  changedFields: string[];
}

export interface CustomerDetailData {
  customer: CustomerInfo;
  phones: PhoneRow[];
  contracts: ContractRow[];
  stations: StationRow[];
  visits: VisitRow[];
  checks: CheckRow[];
  files: FileRow[];
  resolutions: ResolutionRow[];
  timber: TimberMonth[];
  /** null = role นี้อ่านไม่ได้ (ไม่ใช่ host) */
  audit: AuditEntry[] | null;
  today: string;
  currentMonth: string;
  /** เพดานชดเชย (เดือน) จากฐานข้อมูล missed_makeup_deadline_months() */
  makeupDeadlineMonths: number;
  /** ทีมของผู้ใช้ที่ login (หัวหน้างาน) */
  myTeamCode: string | null;
  /** true = ข้อมูลบางส่วนถูกตัดตามเพดานแถว (ต้องแจ้งผู้ใช้) */
  truncated: boolean;
  /** เดือนที่ปิดแล้ว (ส่วนกลาง · month_closures) 'YYYY-MM' — แสดงป้าย "ปิดเดือนแล้ว" ไม่ล็อกข้อมูล */
  closedMonths: string[];
  role: UserRole;
}
