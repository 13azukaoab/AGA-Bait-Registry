/**
 * ป้าย "New เดือนนี้" / "Renew เดือนนี้" ในรายชื่อลูกค้า — pure function (DECISIONS 2.38 ค)
 *
 * Logic summary:
 *   * สัญญา "เริ่มในเดือนที่เลือก" = `start_date` อยู่ในเดือนนั้น ('YYYY-MM' ตรงกัน)
 *   * เริ่มในเดือนนั้น + ไม่มี `renewed_from_contract_id` = New · มี = Renew · เริ่มคนละเดือน = ไม่มีป้าย
 *   * คำนวณจากข้อมูลสัญญาล้วน ไม่มีช่องเก็บเพิ่มในฐานข้อมูล
 */
import type { ContractMonthTag } from "./types";

export function contractMonthTag(
  startDate: string,
  renewedFromContractId: string | null,
  month: string,
): ContractMonthTag {
  if (startDate.slice(0, 7) !== month) return null;
  return renewedFromContractId ? "renew" : "new";
}
