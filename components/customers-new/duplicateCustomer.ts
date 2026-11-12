/**
 * ตัวช่วยเรื่อง "ชื่อลูกค้าซ้ำในสาขา" (AG001) ของ RPC `save_job_opening` (pure function — เทสได้)
 *
 * Logic summary:
 *   * DB พบลูกค้าชื่อเดียวกัน (หลังจัดรูป: ตัดช่องว่าง/อักขระมองไม่เห็น/พิมพ์เล็ก) ในสาขาเดียวกัน →
 *     RAISE `AG001` พร้อม DETAIL เป็น JSON string
 *     `[{ customer_id, name, customer_type, latest_contract_no }]` (PostgREST ส่งมาที่ `error.details`)
 *   * หน้าจอต้องถามผู้ใช้: "ใช้ลูกค้ารายเดิม" (ส่งซ้ำด้วย `p_customer_id`) หรือ
 *     "เป็นคนละราย" (ส่งซ้ำด้วย `p_confirm_new_customer: true`)
 *   * `parseDuplicateMatches` แปลง JSON เป็นรายการที่ใช้แสดง — ข้อมูลเพี้ยน/ไม่ใช่ JSON = รายการว่าง
 *     (ผู้เรียกจะแสดง error ธรรมดา ไม่เดาเอง)
 */

export interface DuplicateCustomerMatch {
  customerId: string;
  name: string;
  /** รหัสประเภทลูกค้าของรายเดิม (null = ยังไม่ระบุ) */
  customerType: string | null;
  /** เลขที่สัญญาล่าสุดของลูกค้ารายนี้ (null = ไม่มีสัญญา/อ่านไม่ได้) */
  latestContractNo: string | null;
}

/** ผู้ใช้เลือกอะไรในกล่องถามชื่อซ้ำ */
export type DuplicateChoice =
  | { kind: "existing"; customerId: string }
  | { kind: "new" }
  | { kind: "cancel" };

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** แปลง `error.details` ของ AG001 เป็นรายการลูกค้าที่ซ้ำ · ผิดรูปแบบ = [] (ข้ามรายการที่ไม่มี id/ชื่อ) */
export function parseDuplicateMatches(details: string | null | undefined): DuplicateCustomerMatch[] {
  if (!details) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: DuplicateCustomerMatch[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const customerId = asStringOrNull(r.customer_id);
    const name = asStringOrNull(r.name);
    if (!customerId || !name) continue;
    out.push({
      customerId,
      name,
      customerType: asStringOrNull(r.customer_type),
      latestContractNo: asStringOrNull(r.latest_contract_no),
    });
  }
  return out;
}
