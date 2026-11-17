/**
 * ตัวเรียก RPC `set_station_point_label` (M37) — แก้ชื่อจุดกล่อง AG อย่างเดียว ไม่สร้างการเข้าบริการ
 *
 * Logic summary:
 *   * ส่ง `{ p_station_id, p_point_label }` (ค่าที่ตัดช่องว่างแล้ว · null = ลบชื่อจุด) · DB ตัดช่องว่าง/ตรวจ 40 ตัวอักษร/สิทธิ์ซ้ำ
 *   * คืนแถว `{ station_id, point_label, updated_at }` — ใช้ point_label ที่ DB คืนมาเป็นค่าจริงบนหน้าจอ
 *   * error แปลเป็นไทยด้วย `describeServiceError` (SV012/SV013/SV014/22001/42501) · บั๊กหน้าจอ console.error ข้อความดิบ
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { describeServiceError, type ServiceError } from "@/components/service/errors";

export type SetPointLabelResult =
  | { ok: true; pointLabel: string | null }
  | { ok: false; error: ServiceError };

export async function setStationPointLabel(
  supabase: SupabaseClient,
  stationId: string,
  pointLabel: string | null,
): Promise<SetPointLabelResult> {
  const { data, error } = await supabase.rpc("set_station_point_label", {
    p_station_id: stationId,
    p_point_label: pointLabel,
  });
  if (error) {
    const described = describeServiceError(error);
    if (described.isBug) console.error("[bait] set_station_point_label error", error);
    return { ok: false, error: described };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { point_label: string | null } | null | undefined;
  if (!row) {
    return { ok: false, error: { message: "บันทึกชื่อจุดแล้วแต่ระบบไม่ส่งค่ากลับ — รีเฟรชหน้าเพื่อดูชื่อล่าสุด", isBug: true } };
  }
  return { ok: true, pointLabel: row.point_label };
}
