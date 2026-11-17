/**
 * สถานะ "มีข้อมูลที่ยังไม่บันทึก" ของหน้า /customers/new (M34 · ส่งให้แถบแจ้งเวอร์ชันใหม่ผ่าน useUnsavedWork)
 *
 * Logic summary:
 *   * แถวใหม่ (drafts) ที่ผู้ใช้เริ่มกรอกแล้ว (ต่างจากแถวเปล่า) = ค้าง · แถวเปล่าที่เพิ่งกด "เพิ่มแถว" ไม่นับ
 *   * แถวที่บันทึกแล้วแต่กำลังแก้ (edits) ที่ค่าต่างจากตอนเปิดแก้ = ค้าง · เปิดแก้แล้วไม่ได้เปลี่ยนอะไรไม่นับ
 *   * ไม่นับ saveError (ข้อความผลบันทึก ไม่ใช่ข้อมูลที่ผู้ใช้กรอก) และ key ชั่วคราว
 * ไม่เปลี่ยน logic บันทึก/payload — อ่านอย่างเดียว
 */
import { createDraft } from "./draftRow";
import type { DraftRow } from "./types";

function comparable(row: DraftRow): string {
  return JSON.stringify({ ...row, key: "", saveError: undefined });
}

/** แถวใหม่นี้มีข้อมูลที่ผู้ใช้กรอกไหม */
export function isDraftTouched(row: DraftRow): boolean {
  return comparable(row) !== comparable(createDraft());
}

/** แถวที่กำลังแก้ ต่างจากค่าตอนเริ่มแก้ไหม */
export function isEditChanged(edit: { draft: DraftRow; original: DraftRow }): boolean {
  return comparable(edit.draft) !== comparable(edit.original);
}

export function hasUnsavedCustomers(
  drafts: readonly DraftRow[],
  edits: Readonly<Record<string, { draft: DraftRow; original: DraftRow }>>,
): boolean {
  return drafts.some(isDraftTouched) || Object.values(edits).some(isEditChanged);
}
