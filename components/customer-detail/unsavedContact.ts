/**
 * ตัดสินว่า "แผงข้อมูลติดต่อมีค่าที่พิมพ์ค้างและยังไม่บันทึก" (M34 · ส่งเข้า `useUnsavedWork` ใน InfoPanel)
 *
 * Logic summary:
 *   * original = null (ไม่ได้เปิดช่องแก้อยู่) → ไม่ค้าง
 *   * เปิดช่องแก้แล้วค่าที่พิมพ์ต่างจากค่าเดิมแม้ช่องเดียว → ค้าง · เปิดแล้วไม่ได้แก้อะไร → ไม่ค้าง
 *   * pure function — ไม่เปลี่ยน logic บันทึก
 */
export interface ContactDraftValues {
  value: string;
  phone: string;
  label: string;
}

export function isContactDraftDirty(original: ContactDraftValues | null, draft: ContactDraftValues): boolean {
  return !!original && (original.value !== draft.value || original.phone !== draft.phone || original.label !== draft.label);
}
