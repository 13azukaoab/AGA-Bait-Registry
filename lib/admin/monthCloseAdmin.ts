/**
 * ปิดเดือน / คำนวณ snapshot ใหม่ ด้วย service role ในนามผู้กด (M39 · เจ้าของอนุมัติใช้ lib/admin 18 พ.ย. 2026)
 *
 * ทำไมต้องใช้ service role: ตัวเลข snapshot ต้องคำนวณฝั่ง server จากทะเบียน "ทุกสัญญา" — recorder อ่านตาม RLS
 * อาจเห็นไม่ครบ และผู้เรียกต้องส่งตัวเลขเองไม่ได้ (RPC close_month_part / resync_month_part ให้ service role เท่านั้น)
 *
 * 🔒 กันสวมรอย: ฟังก์ชันรับ **client ของผู้ใช้** (ไม่รับ user id) แล้วทำเองทุกครั้ง:
 *   1. auth.getUser() — ผู้กด = user ที่ Supabase ตรวจ token แล้ว
 *   2. ตรวจสิทธิ์ที่ DB ด้วย JWT ของผู้ใช้: ปิด → `can_close_month_part(scope)` · คำนวณใหม่ → `is_host()`
 *   3. ค่อยสร้าง service role แล้วเรียก RPC ในนามผู้กด (DB ตรวจสิทธิ์ผู้กดซ้ำ + ลง audit ในนามผู้กด)
 *   ไม่ผ่าน → throw error code 42501 (route แปลงเป็น 403)
 * ไฟล์นี้ไม่คืน service-role client ออกไป (แพทเทิร์นเดียวกับ userAdmin.ts) · route ยังต้องตรวจ Origin เอง
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  closeMonth,
  resyncMonth,
  type CloseMonthInput,
  type ClosureScope,
} from "@/lib/dashboard/monthClose";
import { supabaseMonthClosePorts } from "@/lib/dashboard/supabaseMonthClosePorts";
import { createAdminClient } from "@/lib/supabase/admin";

function forbidden(): Error {
  return Object.assign(new Error("ไม่มีสิทธิ์ทำรายการนี้"), { code: "42501" });
}

/** ผู้ใช้ที่ล็อกอิน + ผ่านด่านสิทธิ์ที่ DB → user id · ไม่ผ่าน = throw 42501 */
async function verifiedActor(
  userClient: SupabaseClient,
  check: { rpc: "can_close_month_part"; scope: ClosureScope } | { rpc: "is_host" },
): Promise<string> {
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) throw forbidden();
  const { data, error } =
    check.rpc === "is_host"
      ? await userClient.rpc("is_host")
      : await userClient.rpc("can_close_month_part", { p_scope: check.scope });
  if (error || data !== true) throw forbidden();
  return user.id;
}

/** ปิด 1 ส่วนในนามผู้ใช้ของ `userClient` แล้วส่ง Dashboard (source close) · throw error ของ RPC ต่อให้ route แปลง */
export async function closeMonthForUser(userClient: SupabaseClient, input: CloseMonthInput) {
  const actor = await verifiedActor(userClient, { rpc: "can_close_month_part", scope: input.scope });
  return closeMonth(supabaseMonthClosePorts(createAdminClient(), actor), input);
}

/** คำนวณ snapshot ใหม่ (host) ในนามผู้ใช้ของ `userClient` แล้วส่ง Dashboard (source resync) */
export async function resyncMonthForUser(
  userClient: SupabaseClient,
  input: { month: string; scope: ClosureScope },
) {
  const actor = await verifiedActor(userClient, { rpc: "is_host" });
  return resyncMonth(supabaseMonthClosePorts(createAdminClient(), actor), input);
}
