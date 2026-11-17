/**
 * ตรรกะ "แก้ชื่อจุด" ของกล่อง AG บนหน้า /bait (M37 · DECISIONS 2.60 / 2.65) — pure function ทดสอบได้
 *
 * Logic summary:
 *   * ใครเห็นปุ่ม: host / recorder เท่านั้น (admin / viewer ไม่เห็น — DB ก็ปฏิเสธ 42501) ·
 *     เฉพาะกล่อง AG ที่สถานะ active / pending_removal (ถอด/กำจัด/หาย/ถอนแล้ว = SV013) ← `canEditPointLabel`
 *   * ค่าที่พิมพ์: ตัดช่องว่างหัว-ท้าย · ยาวสุด 40 ตัวอักษร (นับ code point เหมือน char_length ของ DB) ·
 *     ว่าง = ลบชื่อจุด (ต้องยืนยัน) · เท่าเดิม = ไม่ต้องเรียก RPC ← `planPointLabelEdit`
 *   * DB เป็นด่านจริง (RPC `set_station_point_label`) — ด่านฝั่งหน้าจอนี้แค่กันเรียกเปล่าและให้ข้อความไวขึ้น
 *   * `applyPointLabel` = อัปเดตชื่อบนหน้าจอหลังบันทึกสำเร็จ (รายละเอียดสัญญา + ฟอร์มกล่อง AG ที่เปิดอยู่)
 */
import type { ContractDetail, FormState, StationRow } from "@/components/service/types";
import type { UserRole } from "@/lib/db/types";

export const POINT_LABEL_MAX = 40;

/** นับตัวอักษรแบบ code point (ตรงกับ char_length ของ PostgreSQL) */
export function labelLength(s: string): number {
  return Array.from(s).length;
}

/** ปุ่มแก้ชื่อจุดแสดงได้ไหม — ตามบทบาท + ชนิด/สถานะสถานี */
export function canEditPointLabel(
  role: UserRole | null | undefined,
  station: Pick<StationRow, "type" | "status">,
): boolean {
  if (role !== "host" && role !== "recorder") return false;
  if (station.type !== "AG") return false;
  return station.status === "active" || station.status === "pending_removal";
}

/** สถานีที่แก้ชื่อจุดได้ของสัญญา เรียงตามเลขจุด */
export function editablePointLabelStations(role: UserRole | null | undefined, stations: readonly StationRow[]): StationRow[] {
  return stations
    .filter((s) => canEditPointLabel(role, s))
    .sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
}

export type PointLabelPlan =
  | { kind: "unchanged" }
  /** value = ข้อความที่ตัดช่องว่างแล้ว · null = ลบชื่อจุด (ต้องให้ผู้ใช้ยืนยันก่อน) */
  | { kind: "save"; value: string | null; needsConfirm: boolean }
  | { kind: "invalid"; message: string };

/** ตัดสินสิ่งที่จะทำเมื่อกดบันทึก: current = ชื่อจุดปัจจุบันบนหน้าจอ ("" = ยังไม่มี) */
export function planPointLabelEdit(raw: string, current: string): PointLabelPlan {
  const value = raw.trim();
  if (labelLength(value) > POINT_LABEL_MAX) {
    return { kind: "invalid", message: `ชื่อจุดยาวเกิน ${POINT_LABEL_MAX} ตัวอักษร (ตอนนี้ ${labelLength(value)})` };
  }
  if (value === current.trim()) return { kind: "unchanged" };
  if (value === "") return { kind: "save", value: null, needsConfirm: true };
  return { kind: "save", value, needsConfirm: false };
}

/** ช่องกรอกถือว่า "แก้ค้าง" ไหม (ใช้กับแถบเตือนก่อนออกจากหน้า) */
export function isPointLabelDirty(raw: string, current: string): boolean {
  return raw.trim() !== current.trim();
}

/**
 * ใส่ชื่อจุดใหม่ลงรายละเอียดสัญญา + ฟอร์ม หลังบันทึกสำเร็จ
 * ฟอร์ม: `labelDb` = ค่าใหม่เสมอ (ไว้เทียบตอนส่ง station_labels) · `label` (ช่องในฟอร์มบันทึกการเข้า) เปลี่ยนตามเฉพาะเมื่อ
 * ผู้ใช้ยังไม่ได้พิมพ์แก้เอง (label ยังเท่า labelDb เดิม) — ไม่ทับสิ่งที่พิมพ์ค้างอยู่
 */
export function applyPointLabel(
  detail: ContractDetail,
  form: FormState,
  stationId: string,
  newLabel: string | null,
): { detail: ContractDetail; form: FormState } {
  const text = newLabel ?? "";
  return {
    detail: {
      ...detail,
      stations: detail.stations.map((s) => (s.id === stationId ? { ...s, pointLabel: text } : s)),
    },
    form: {
      ...form,
      ag: form.ag.map((p) =>
        p.stationId === stationId ? { ...p, label: p.label === p.labelDb ? text : p.label, labelDb: text } : p,
      ),
    },
  };
}
