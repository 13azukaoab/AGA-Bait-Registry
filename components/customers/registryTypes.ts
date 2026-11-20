/**
 * ชนิดข้อมูลของหน้า "ทะเบียนลูกค้า/สัญญา" (/customers) — SPEC §8 จอ 3 · mockup FINAL `#registry`
 *
 * ค่าวันที่เป็น 'YYYY-MM-DD' (ค.ศ.) · ทุกชนิดเป็น camelCase ที่แปลงจากแถวฐานข้อมูลแล้ว (registryData.ts)
 */
import type { Tier } from "@/lib/rules";

/** ค่าจริงของ contracts.status ในฐานข้อมูล (รวม 'paused' ที่เพิ่มตามหลัง M32) */
export type DbContractStatus = "active" | "expired_pending_collection" | "closed" | "cancelled" | "paused";

/**
 * สถานะที่แสดงในทะเบียน — mockup มี 4 แบบ (active · near_end · pending_collection · ended)
 * ฐานข้อมูลจริงมีสถานะสัญญาเพิ่ม (พักสัญญา · ยกเลิก) จึงมีป้ายเพิ่ม 2 แบบ (แจ้งหมวด 1 ในรายงาน)
 */
export type RegistryStatus = "active" | "near_end" | "pending_collection" | "ended" | "paused" | "cancelled";

export type SizeCode = Tier;
/** ปีสัญญา: "" = ทุกแบบ · "1" = 12 เดือนและ Custom (กลุ่มสี 1 ปี) · "3" = 36 เดือน */
export type YearsFilter = "" | "1" | "3";

/** ลำดับการเรียง — เรียงฝั่งฐานข้อมูลเท่านั้น (keyset) จึงมีเฉพาะคอลัมน์ที่อยู่ในตาราง contracts */
export type SortKey = "default" | "end_asc" | "end_desc" | "value_asc" | "value_desc";

/**
 * ตัวกรองทั้งหมด — เก็บเฉพาะ id / enum (ใส่ URL ได้) · ข้อความค้นหาแยกเก็บใน state ของหน้า ไม่อยู่ในนี้ (PDPA)
 */
export interface RegistryFilters {
  zones: string[];
  branches: string[];
  sizes: SizeCode[];
  years: YearsFilter;
  statuses: RegistryStatus[];
  sort: SortKey;
}

export interface BranchRef {
  id: string;
  name: string;
  zoneId: string;
  zoneName: string;
  zoneOrder: number;
}

/** ตำแหน่งต่อไปของ keyset (ค่าดิบของคอลัมน์ที่เรียง + id) */
export interface Cursor {
  /** ค่าดิบของคอลัมน์เรียงของแถวสุดท้าย · null = คอลัมน์นั้นว่าง (เฉพาะ end_date) */
  value: string | null;
  id: string;
}

export interface RegistryRow {
  contractId: string;
  customerId: string;
  customerName: string;
  customerTypeLabel: string | null;
  contractNo: string;
  startDate: string;
  /** วันจบที่ใช้จริง (end_date · ว่างให้คำนวณจากวันเริ่ม + ระยะสัญญา) */
  endDate: string;
  termMonths: number;
  valueTotal: number;
  /** มูลค่าจัด Tier ต่อปี (annualValueForTerm) */
  annualValue: number;
  /** null = คำนวณ Tier ไม่ได้ (ไม่มีเกณฑ์ของเดือนเริ่มสัญญา) */
  tier: Tier | null;
  branchId: string;
  branchName: string;
  zoneName: string;
  /** null = อ่านจำนวนสถานีไม่ได้ */
  stationCount: number | null;
  dbStatus: DbContractStatus;
  status: RegistryStatus;
  /** ตำแหน่งของแถวนี้ใน keyset (ใช้เป็น cursor หน้าถัดไป) */
  cursor: Cursor;
}
