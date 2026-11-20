/**
 * นิยามกลาง "สัญญาจบ/หมดอายุ" ฝั่งหน้าจอ — ใช้ร่วม /todo · หน้ารายละเอียดลูกค้า · /bait (pure function)
 *
 * Logic summary:
 *   * ไม่มีงานเบื้องหลังตั้งสถานะ `expired_pending_collection` ให้สัญญาที่เลยวันสิ้นสุดเอง → สัญญา `active` ที่หมดวันแล้วจึงยังเป็น "active" ในฐานข้อมูล
 *     หน้าจอต้องตัดสินเองด้วยนิยามเดียวกันทุกที่ (ตรง collect_ig_stations CL001 + นิยาม "หมดอายุ" ของ BE M44):
 *       - active + วันสิ้นสุด < วันนี้ (เวลาไทย) = หมดอายุ · วันสุดท้ายของสัญญา (= วันนี้) ยังไม่หมด
 *       - expired_pending_collection / closed / cancelled = จบ
 *       - paused (พัก · M29) = **ไม่จบเสมอ** แม้เลยวันสิ้นสุด — สถานียังอยู่กับลูกค้า DB กันการเก็บ (CP010)
 *   * `effectiveContractStatus`: แปลงสถานะที่ใช้ตัดสินบนหน้าจอ — active ที่หมดอายุ → expired_pending_collection (อย่างอื่นคงเดิม)
 *   * วันสิ้นสุด 'YYYY-MM-DD' ให้ผู้เรียกส่งมา (คำนวณจาก lib/rules effectiveEndDate — ห้ามคำนวณเองในที่นี้)
 */

export type ContractStatusAny = "active" | "paused" | "expired_pending_collection" | "closed" | "cancelled";

/** สัญญาจบแล้ว (เก็บสถานีได้) ตามนิยามข้างบน */
export function isContractEnded(c: { status: ContractStatusAny; endDate: string }, today: string): boolean {
  if (c.status === "paused") return false;
  if (c.status === "active") return c.endDate < today;
  return true;
}

/** active ที่เลยวันสิ้นสุด → "expired_pending_collection" · สถานะอื่นคงเดิม (paused ไม่เปลี่ยน) */
export function effectiveContractStatus<S extends ContractStatusAny>(
  status: S,
  endDate: string,
  today: string,
): S | "expired_pending_collection" {
  return status === "active" && endDate < today ? "expired_pending_collection" : status;
}
