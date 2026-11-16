/**
 * ชนิดข้อมูลของหน้า "เปิดงานเข้าทะเบียนบริการ" (/customers/new)
 *
 * ชื่อฟิลด์ในฐานข้อมูลเป็น snake_case — แปลงเป็น camelCase ที่ `data.ts` ที่เดียว
 */
import type { TermYears, TierRule } from "@/lib/rules";
import type { TeamKind } from "@/lib/service/teamKind";

import type { BranchOption } from "./branchMatch";
import type { ContractFileKind } from "./fileRules";

export type SaleType = "new" | "renew";

/** สถานะสัญญา (enum contract_status) — `closed` = สัญญาปิดแล้ว ไฟล์แนบถูกล็อก */
export type ContractStatus = "active" | "expired_pending_collection" | "closed" | "cancelled";

/** ตำแหน่งของผู้ขาย — ตัวบอกว่าเก็บชื่อลง `sale_name` (Sale) หรือ `am_name` (AM) */
export type SellerRole = "sale" | "am";

/** สัญญาเก่าที่ Renew ผูกไว้ (ลูกค้าเดิม) — สัญญาใหม่ใช้ customer_id เดียวกัน ไม่สร้างลูกค้าใหม่ */
export interface RenewalLink {
  contractId: string;
  contractNo: string;
  customerId: string;
  customerName: string;
  branchId: string;
  /**
   * วันที่ของสัญญาเก่า (M28) — ใช้ตรวจกฎช่องว่าง 2 เดือนฝั่งหน้าจอ · ไม่มี = ตรวจไม่ได้ (DB ตรวจซ้ำเสมอ: AG010)
   * แถวที่บันทึกแล้ว (โหมดแก้) สร้างลิงก์จาก `SavedContract.renewedFrom` ซึ่งไม่มีวันที่ จึงไม่ใส่
   */
  oldDates?: { startDate: string; endDate?: string; termYears: TermYears };
}

export interface TeamOption {
  id: string;
  code: string;
  /** ประเภททีมจาก teams.kind (M22) — ห้ามเดาจากรหัสทีม */
  kind: TeamKind;
  /** ทีมเปิดใช้งานอยู่ไหม (teams.is_active — M33) · ปิดแล้วเลือกให้งานใหม่ไม่ได้ (TM004) */
  isActive: boolean;
}

export interface CustomerTypeOption {
  code: string;
  label: string;
  groupLabel: string;
}

/** ข้อมูลอ้างอิง (master) ที่ทุกแถวใช้ร่วมกัน — อ่านจากฐานข้อมูลฝั่ง server ครั้งเดียวต่อหน้า */
export interface MasterData {
  branches: BranchOption[];
  zones: { id: string; name: string }[];
  teams: TeamOption[];
  customerTypes: CustomerTypeOption[];
  /** เกณฑ์ Tier จากตาราง tier_rules (ห้าม hardcode) */
  tierRules: TierRule[];
  /** M28: นโยบาย Renew ที่ไม่ผูกสัญญาเก่า (อ่านจาก DB ตอนโหลดหน้า) */
  renewPolicy: RenewPolicy;
}

/**
 * M28 รอบ 2: Renew ที่ไม่ผูกสัญญาเก่าเปิดได้เฉพาะช่วงแรกหลังเปิดระบบ
 * `unlinkedOpen` มาจาก RPC `unlinked_renew_open()` (ตัดสินด้วยนาฬิกาของ DB) · อ่านไม่ได้ = false (DB ตัดสินซ้ำตอนบันทึก: AG013)
 * `unlinkedUntil` = วันแรกที่ "ไม่ได้แล้ว" ('YYYY-MM-DD') ใช้แสดงข้อความอย่างเดียว
 */
export interface RenewPolicy {
  unlinkedOpen: boolean;
  unlinkedUntil: string | null;
}

/** แถวไฟล์แนบ (ตาราง contract_files) */
export interface ContractFileRow {
  id: string;
  kind: ContractFileKind;
  version: number;
  isCurrent: boolean;
  storagePath: string;
  fileName: string;
  sizeBytes: number;
  wasCompressed: boolean;
  reason: string | null;
  uploadedAt: string;
}

/** สัญญาที่บันทึกในฐานข้อมูลแล้ว (แสดงในตาราง) */
export interface SavedContract {
  contractId: string;
  customerId: string;
  contractNo: string;
  customerName: string;
  customerTypeCode: string | null;
  branchId: string;
  saleType: SaleType;
  status: ContractStatus;
  /** ชื่อผู้ขาย (sale_name หรือ am_name ตามตำแหน่ง) */
  sellerName: string;
  sellerRole: SellerRole;
  isUrgent: boolean;
  /** contractNo = null เมื่ออ่านเลขที่สัญญาเก่าไม่ได้ (query ล้ม/ไม่มีสิทธิ์ดู) — แสดง "โหลดไม่ได้" */
  renewedFrom: { contractId: string; contractNo: string | null } | null;
  /** M28: เหตุผลของ Renew ที่ไม่ผูกสัญญาเก่า (null = ไม่ใช่กรณีนั้น หรือแถวเก่าที่ไม่มีเหตุผล) */
  renewUnlinkedReason: string | null;
  mailReceivedDate: string;
  /** วันที่นัดบริการครั้งแรก — ว่าง = "รอนัดบริการ" */
  firstServiceDate: string;
  /** 'HH:MM' หรือว่าง */
  firstServiceTime: string;
  note: string;
  startDate: string;
  endDate: string;
  termYears: TermYears;
  valueTotal: number;
  teamIds: string[];
  /** เวลาแก้ล่าสุด (`contracts.updated_at` ตามที่ DB คืน) — ส่งกลับเป็น `p_expected_updated_at` ตอนแก้ (M12) */
  updatedAt: string;
  files: ContractFileRow[];
  /** จำนวนครั้งที่แก้ใน audit_log — มีค่าเฉพาะ host (role อื่นอ่าน audit ไม่ได้) */
  auditCount: number | null;
  /** host แต่นับ audit ไม่ได้ (query ล้ม) — แสดง "โหลดไม่ได้" แทนตัวเลข */
  auditCountFailed: boolean;
}

/** แถวที่กำลังกรอก (ยังไม่บันทึก) — ค่าช่องทั้งหมดเป็นข้อความตามที่ผู้ใช้พิมพ์ */
export interface DraftRow {
  key: string;
  contractNo: string;
  customerName: string;
  saleType: SaleType;
  sellerRole: SellerRole;
  saleName: string;
  isUrgent: boolean;
  /** Renew: ลูกค้าเดิม/สัญญาเก่าที่เลือก (null = ยังไม่ผูก) */
  renewal: RenewalLink | null;
  /** M28: เหตุผลที่ Renew ไม่ผูกสัญญาเก่า (ใช้เฉพาะ Renew ที่ไม่ผูก · ว่างได้เมื่อเป็น New/ผูกแล้ว) */
  renewUnlinkedReason: string;
  mailReceivedDate: string;
  firstServiceDate: string;
  firstServiceTime: string;
  note: string;
  branchText: string;
  customerTypeCode: string;
  teamIds: string[];
  startDate: string;
  endDate: string;
  /** ผู้ใช้แก้วันสิ้นสุดเองแล้ว — เลิกเติมอัตโนมัติ */
  endTouched: boolean;
  value1y: string;
  value3y: string;
  /** ไฟล์ PDF สัญญาที่เลือกไว้ รออัปโหลดหลังบันทึกแถว */
  pendingPdf: PendingFile | null;
  /** ผลบันทึกรอบล่าสุดของแถวนี้ (error ภาษาไทย) */
  saveError: string | null;
}

/** ไฟล์ที่ตรวจ/บีบแล้ว พร้อมอัปโหลด */
export interface PendingFile {
  file: File;
  wasCompressed: boolean;
}

export interface ContractFilterState {
  zoneId: string;
  branchId: string;
  status: "" | "ok" | "miss" | "nofile" | "warn";
  search: string;
}
