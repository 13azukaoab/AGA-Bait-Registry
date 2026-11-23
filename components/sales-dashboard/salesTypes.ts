/**
 * ชนิดข้อมูลของหน้า "Dashboard งานขาย (New/Renew)" (DECISIONS 2.91 ข้อ 2+4)
 *
 * Logic summary:
 *   * 1 แถว = 1 สัญญา · ประเภท New/Renew มาจาก contracts.sale_type
 *   * เดือนของยอด = เดือนของ `salesDate` = วันที่รับ Mail (contracts.mail_received_date) · สัญญานำเข้าที่ไม่มี Mail
 *     ใช้วันเริ่มสัญญาแทน (`dateSource = "start"` · DECISIONS 2.101) · สัญญาไม่ใช่นำเข้าที่ไม่มีวันที่รับ Mail
 *     ไม่อยู่ในยอด/กราฟ แต่ถูกนับเป็นหมายเหตุ ("ไม่มีวันที่รับ Mail N ราย")
 *   * `valueTotal` = มูลค่ารวมของสัญญา (value_total) ไม่ปรับเป็นต่อปี
 *   * `isLate` คำนวณครั้งเดียวตอนแปลงแถว (ด้วย isLateRenewal ใน lib/rules) — ห้ามเขียนสูตรซ้ำที่นี่
 */

export type SaleKind = "new" | "renew";
export type SalesDateSource = "mail" | "start";

export interface SalesRow {
  contractId: string;
  customerId: string;
  customerName: string;
  branchId: string;
  branchName: string;
  zoneId: string;
  zoneName: string;
  /** ลำดับเขต (zones.sort_order) ใช้เรียงเขต */
  zoneOrder: number;
  saleType: SaleKind;
  saleName: string | null;
  amName: string | null;
  /**
   * วันที่ที่ใช้จัดเดือนของยอด 'YYYY-MM-DD' (DECISIONS 2.91 + 2.101)
   * = วันที่รับ Mail ถ้ามี · ไม่มี + เป็นสัญญานำเข้า = วันเริ่มสัญญา (ดู dateSource) · null = ไม่มีวันที่ใช้ได้
   */
  salesDate: string | null;
  /** ที่มาของ salesDate: "mail" = วันที่รับ Mail · "start" = วันเริ่มสัญญา (สัญญานำเข้าไม่มี Mail) · null เมื่อ salesDate เป็น null */
  dateSource: SalesDateSource | null;
  valueTotal: number;
  /** Renew ที่รับ Mail หลังวันที่ 15 · แถวที่ใช้วันเริ่มสัญญา (dateSource = "start") เป็น false เสมอ (DECISIONS 2.101) */
  isLate: boolean;
}

export interface SalesFilters {
  /** 'YYYY-MM' (รวม) */
  fromMonth: string;
  toMonth: string;
  zoneId: string | null;
  branchId: string | null;
  /** ชื่อผู้ขาย (sale_name) ตรงตัว · null = ทุกคน */
  seller: string | null;
}

export interface SalesTotals {
  newCount: number;
  newValue: number;
  renewCount: number;
  renewValue: number;
  lateCount: number;
  lateValue: number;
}

export interface BranchSales extends SalesTotals {
  branchId: string;
  branchName: string;
  zoneId: string;
  zoneName: string;
  zoneOrder: number;
}

export interface ZoneSales extends SalesTotals {
  zoneId: string;
  zoneName: string;
  zoneOrder: number;
}

export interface MonthSales extends SalesTotals {
  month: string;
}

export interface SellerSales extends SalesTotals {
  /** ชื่อผู้ขาย · "" = ไม่ระบุ */
  name: string;
  contractCount: number;
  totalValue: number;
}
