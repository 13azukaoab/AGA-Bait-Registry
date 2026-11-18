/**
 * ปิดเดือน / คำนวณ snapshot ใหม่ ด้วย service role ในนามผู้กด (M39 · เจ้าของอนุมัติใช้ lib/admin 18 พ.ย. 2026)
 *
 * ทำไมต้องใช้ service role: ตัวเลข snapshot ต้องคำนวณฝั่ง server จากทะเบียน "ทุกสัญญา" — recorder อ่านตาม RLS
 * อาจเห็นไม่ครบ และผู้เรียกต้องส่งตัวเลขเองไม่ได้ (RPC close_month_part / resync_month_part ให้ service role เท่านั้น)
 *
 * 🔒 ข้อตกลงการใช้ (route ต้องทำก่อนเรียก):
 *   1. ตรวจ Origin + auth.getUser() (actorId มาจาก token ที่ Supabase ตรวจแล้ว **ห้ามรับจาก body**)
 *   2. ตรวจสิทธิ์ที่ DB ด้วย client ของผู้ใช้: ปิด → `can_close_month_part(scope)` · คำนวณใหม่ → `is_host()`
 *   ฐานข้อมูลตรวจสิทธิ์ของ actor ซ้ำในทุก RPC และบันทึก audit ในนาม actor
 * ไฟล์นี้ไม่คืน client ออกไป — ฟังก์ชันแคบ 2 ตัวเท่านั้น (แพทเทิร์นเดียวกับ userAdmin.ts)
 */
import {
  closeMonth,
  resyncMonth,
  type CloseMonthInput,
  type ClosureScope,
} from "@/lib/dashboard/monthClose";
import { supabaseMonthClosePorts } from "@/lib/dashboard/supabaseMonthClosePorts";
import { createAdminClient } from "@/lib/supabase/admin";

/** ปิด 1 ส่วนในนาม actorId แล้วส่ง Dashboard (source close) · throw error ของ RPC ต่อให้ route แปลง */
export function closeMonthAsActor(actorId: string, input: CloseMonthInput) {
  return closeMonth(supabaseMonthClosePorts(createAdminClient(), actorId), input);
}

/** คำนวณ snapshot ใหม่ในนาม actorId แล้วส่ง Dashboard (source resync) */
export function resyncMonthAsActor(actorId: string, input: { month: string; scope: ClosureScope }) {
  return resyncMonth(supabaseMonthClosePorts(createAdminClient(), actorId), input);
}
