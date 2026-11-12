/**
 * ชนิดข้อมูลของหน้า "เปิดงานเข้าทะเบียนบริการ" (/customers/new)
 *
 * ชื่อฟิลด์ในฐานข้อมูลเป็น snake_case — แปลงเป็น camelCase ที่ `data.ts` ที่เดียว
 */
import type { TermYears, TierRule } from "@/lib/rules";

import type { BranchOption } from "./branchMatch";
import type { ContractFileKind } from "./fileRules";

export type SaleType = "new" | "renew";

export interface TeamOption {
  id: string;
  code: string;
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
  saleName: string;
  startDate: string;
  endDate: string;
  termYears: TermYears;
  valueTotal: number;
  teamIds: string[];
  files: ContractFileRow[];
  /** จำนวนครั้งที่แก้ใน audit_log — มีค่าเฉพาะ host (role อื่นอ่าน audit ไม่ได้) */
  auditCount: number | null;
}

/** แถวที่กำลังกรอก (ยังไม่บันทึก) — ค่าช่องทั้งหมดเป็นข้อความตามที่ผู้ใช้พิมพ์ */
export interface DraftRow {
  key: string;
  contractNo: string;
  customerName: string;
  saleType: SaleType;
  saleName: string;
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
