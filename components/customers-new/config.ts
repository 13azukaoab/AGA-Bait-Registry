/**
 * ค่าตั้งของหน้าเปิดงาน
 *
 * ช่องที่ schema ยังไม่มีที่เก็บ (เจ้าของตัดสิน 12 พ.ย. 2026: ศูนย์กลางทำ migration เพิ่มคู่ขนาน
 * แล้วค่อยเติมในหน้านี้) — ซ่อนไว้ด้วยตัวแปรตัวเดียว:
 *
 *   1) เบิกด่วน (checkbox)               4) วันที่รับ Mail
 *   2) ลูกค้าเดิม (ผูกสัญญาเก่า — Renew)  5) วันที่บริการ + เวลาบริการ (นัดครั้งแรก)
 *   3) ตำแหน่งผู้ขาย Sale / AM           6) หมายเหตุสัญญา
 *
 * วิธีเติมเมื่อ migration เข้า main แล้ว:
 *   * เพิ่มค่าของช่องใน `DraftRow` / `SavedContract` (types.ts) + `createDraft` (draftRow.ts)
 *   * เพิ่ม select ใน `data.ts` + ฟิลด์ใน `saveDraft` (save.ts)
 *   * เพิ่มคอลัมน์ใน `NewContractsClient.tsx` ตามจุดที่ mockup วางไว้ แล้วเปลี่ยนค่านี้เป็น true
 *   * เพิ่มสถานะ "รอนัดบริการ" ใน filters.ts / ตัวเลือกสถานะ
 */
export const SHOW_PENDING_SCHEMA_COLUMNS = false;
