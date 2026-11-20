/**
 * ชนิดข้อมูลของหน้า "Dashboard งานขาย (New/Renew)" (DECISIONS 2.91 ข้อ 2+4)
 *
 * Logic summary:
 *   * 1 แถว = 1 สัญญา · ประเภท New/Renew มาจาก contracts.sale_type
 *   * เดือนของยอด = เดือนของ `mailDate` (contracts.mail_received_date) — เจ้าของยืนยัน 19 พ.ย. 2026
 *     สัญญาที่ไม่มีวันที่รับ Mail จะไม่อยู่ในยอด/กราฟ แต่ถูกนับเป็นหมายเหตุ ("ไม่มีวันที่รับ Mail N ราย")
 *   * `valueTotal` = มูลค่ารวมของสัญญา (value_total) ไม่ปรับเป็นต่อปี
 *   * `isLate` คำนวณครั้งเดียวตอนแปลงแถว (ด้วย isLateRenewal ใน lib/rules) — ห้ามเขียนสูตรซ้ำที่นี่
 */

export type SaleKind = "new" | "renew";

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
  /** 'YYYY-MM-DD' หรือ null ถ้าไม่ได้กรอก */
  mailDate: string | null;
  valueTotal: number;
  /** Renew ที่รับ Mail หลังวันที่ 15 */
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
