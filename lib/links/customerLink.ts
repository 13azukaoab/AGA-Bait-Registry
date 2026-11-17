/**
 * ตัวสร้าง URL ไปหน้ารายละเอียดลูกค้า `/customers/<id>` จากหน้าอื่น (/todo · /service · /customers/new)
 *
 * Logic summary:
 *   * จุดเดียวที่สร้าง URL นี้ — หน้าไหนอยากลิงก์ไปหน้ารายละเอียดลูกค้าให้เรียกที่นี่ ไม่ประกอบสตริงเอง
 *   * query ที่ส่งได้มีแค่ `tab` · `contract` (id) · `status` · `type` ตามที่หน้ารายละเอียดรับ
 *     (app/(app)/customers/[id]/page.tsx) — ทุกค่าเป็น id (UUID) หรือค่า enum ที่กำหนดไว้ตายตัว
 *     **ห้ามใส่ชื่อ/เบอร์/ที่อยู่/ป้ายจุด** ลง URL (PDPA · URL ไปอยู่ใน log/history ได้) — ตัวช่วยนี้ไม่มีช่องรับค่าอิสระเลย
 *   * id ที่ไม่ใช่ UUID → คืน null (ผู้เรียกแสดงเป็นข้อความธรรมดา ไม่ทำลิงก์พัง)
 *   * บริบท (context) ที่ตรงกับ mockup FINAL: ชื่อลูกค้าทั่วไป = แท็บ "สัญญา" · ตกบริการ = แท็บ "ประวัติทำบริการ"
 *     · กล่อง AG รอถอด = แท็บ "สถานี" กรอง AG + รอถอด
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CustomerDetailTab = "dash" | "contracts" | "stations" | "visits";

export interface CustomerLinkContext {
  /** แท็บที่เปิด · ไม่ใส่ = ไม่ส่ง tab (หน้ารายละเอียดเปิดแท็บ "ภาพรวม") */
  tab?: CustomerDetailTab;
  /** id สัญญา (UUID) ที่ให้โฟกัสในหน้ารายละเอียด */
  contractId?: string | null;
  /** กรองแท็บสถานีตามสถานะ (เฉพาะค่าที่หน้ารายละเอียดรู้จัก) */
  stationStatus?: "pending_removal";
  /** กรองแท็บสถานีตามประเภท */
  stationType?: "AG";
}

/** URL ไปหน้ารายละเอียดลูกค้า · คืน null ถ้า customerId ไม่ใช่ UUID */
export function customerDetailHref(customerId: string | null | undefined, ctx: CustomerLinkContext = {}): string | null {
  if (!customerId || !UUID_RE.test(customerId)) return null;
  const qs = new URLSearchParams();
  if (ctx.tab) qs.set("tab", ctx.tab);
  if (ctx.contractId && UUID_RE.test(ctx.contractId)) qs.set("contract", ctx.contractId);
  if (ctx.stationStatus) qs.set("status", ctx.stationStatus);
  if (ctx.stationType) qs.set("type", ctx.stationType);
  const q = qs.toString();
  return `/customers/${customerId.toLowerCase()}${q ? `?${q}` : ""}`;
}

/** บริบทสำเร็จรูปตาม mockup — ใช้ชื่อเหล่านี้แทนการประกอบ context เอง */
export const customerLinkContexts = {
  /** ชื่อลูกค้าทั่วไป (ยังไม่กรอก · แถวสัญญาที่บันทึกแล้ว · หัวฟอร์มลงบริการ) → แท็บสัญญา โฟกัสสัญญานั้น */
  contract: (contractId: string): CustomerLinkContext => ({ tab: "contracts", contractId }),
  /** เรื่องตกบริการ (รอตัดสิน/ปิดแล้ว) → แท็บประวัติทำบริการของสัญญานั้น */
  missed: (contractId: string): CustomerLinkContext => ({ tab: "visits", contractId }),
  /** กล่อง AG รอถอด → แท็บสถานี กรอง AG + รอถอด ของสัญญานั้น */
  agPendingRemoval: (contractId: string): CustomerLinkContext => ({
    tab: "stations",
    contractId,
    stationStatus: "pending_removal",
    stationType: "AG",
  }),
} as const;
