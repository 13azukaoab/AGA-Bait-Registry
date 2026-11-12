/**
 * กฎ/ข้อความเตือนตอนบันทึกสัญญา (pure function)
 *
 * Logic summary:
 *   * ใช้ลูกค้าเดิม (ชื่อตรงในสาขา หรือผูก Renew) → ประเภทลูกค้าที่เลือกในแถวจะ **ไม่ถูกบันทึก**
 *     (ประเภทเป็นของลูกค้า ไม่ใช่ของสัญญา) ถ้าไม่ตรงกับของเดิมต้องแจ้งผู้ใช้ ไม่ทิ้งเงียบๆ
 */

export interface CustomerTypeMismatch {
  /** รหัสประเภทของลูกค้าเดิมในระบบ (null = ยังไม่เคยระบุ) */
  existing: string | null;
  /** รหัสประเภทที่ผู้ใช้เลือกในแถว */
  chosen: string;
}

/** ไม่ตรง = ผู้ใช้เลือกประเภทมา และต่างจากของลูกค้าเดิม · ไม่ได้เลือก = ไม่ถือว่าขัดแย้ง */
export function customerTypeMismatch(
  existing: string | null | undefined,
  chosen: string,
): CustomerTypeMismatch | null {
  const c = chosen.trim();
  if (!c) return null;
  const e = existing?.trim() ? existing : null;
  return e === c ? null : { existing: e, chosen: c };
}

/** ข้อความเตือนต่อ 1 แถว · `label` แปลรหัสประเภทเป็นชื่อ (ไม่เจอใช้รหัสเอง) */
export function describeTypeMismatch(
  contractNo: string,
  customerName: string,
  m: CustomerTypeMismatch,
  label: (code: string) => string,
): string {
  const was = m.existing ? `ประเภทเดิมในระบบ "${label(m.existing)}"` : "ลูกค้าเดิมยังไม่มีประเภท";
  return `สัญญา ${contractNo}: ใช้ลูกค้าเดิม "${customerName}" (${was}) — ประเภท "${label(m.chosen)}" ที่เลือกไม่ได้ถูกบันทึก`;
}
