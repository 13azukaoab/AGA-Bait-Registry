/**
 * ตัวเรียก RPC ข้อมูลติดต่อลูกค้า (ฝั่ง client · Supabase client ของผู้ใช้จริง · RLS/RPC บังคับสิทธิ์)
 *
 * Logic summary:
 *   * `save_customer_contact(p)` — ใช้ทุก role (host/admin/หัวหน้างาน) เพราะประทับ "แก้ล่าสุด/ข้ามทีม" + กันลบเบอร์สุดท้าย
 *   * `customer_contact_is_cross_team(p_customer_id)` — ถามก่อนเปิดช่องแก้ (หัวหน้างานเท่านั้น · role อื่นได้ false)
 *   * log เฉพาะ code (ห้าม log payload/ข้อความของฐานข้อมูลที่อาจมีข้อมูลลูกค้า)
 *   * ผลคืน `{ ok: true } | { ok: false, error }` ข้อความแปลเป็นไทยแล้ว (describeContactError)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { describeContactError, type ContactErrorInfo } from "./logic";

export type ContactResult = { ok: true } | { ok: false; error: ContactErrorInfo };

export async function saveCustomerContact(supabase: SupabaseClient, payload: Record<string, unknown>): Promise<ContactResult> {
  const { error } = await supabase.rpc("save_customer_contact", { p: payload });
  if (!error) return { ok: true };
  const info = describeContactError(error);
  if (info.isBug) console.error("[customer-detail] save_customer_contact error code:", error.code);
  return { ok: false, error: info };
}

/** true = ลูกค้าของทีมอื่น (ต้องถามยืนยัน) · null = ถามไม่สำเร็จ (ให้ฐานข้อมูลตัดสินตอนบันทึก — จะได้ CC001) */
export async function checkCrossTeam(supabase: SupabaseClient, customerId: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("customer_contact_is_cross_team", { p_customer_id: customerId });
  if (error) {
    console.error("[customer-detail] cross_team check error code:", error.code);
    return null;
  }
  return data === true;
}
