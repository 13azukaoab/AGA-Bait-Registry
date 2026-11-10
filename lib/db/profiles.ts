/**
 * อ่านโปรไฟล์ของผู้ใช้จากตาราง `profiles` (+ ชื่อตำแหน่งจาก `positions`)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้ที่ล็อกอิน (role `authenticated`) ไม่ใช้ service key —
 *     RLS `profiles_select_own` ยอมให้อ่าน "แถวตัวเอง" เท่านั้น ส่ง user_id ของคนอื่น
 *     เข้ามาก็ได้ 0 แถว (SPEC §5)
 *   * `positions` ทุกคนที่ล็อกอินอ่านได้ (policy `positions_select`) จึง join มาเอา
 *     ชื่อตำแหน่งภาษาไทยที่ผู้ใช้เห็น (SPEC §5.1) ได้ในคำสั่งเดียว
 *   * ยังไม่มี generated types ของ Supabase ในโครงการ — จึงประกาศรูปแบบแถวไว้เอง
 *     แล้วแปลงเป็น `AppProfile` (camelCase) ที่ชั้นนี้ที่เดียว
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppProfile, Division, UserRole } from "./types";

/** คอลัมน์ที่ต้องใช้ — ประกาศไว้ที่เดียวเพื่อให้ select กับ type ตรงกันแน่นอน */
const PROFILE_COLUMNS =
  "user_id, display_name, username, role, position_code, division_scope, team_id, is_active, must_change_password, last_login, positions ( name_th )";

/** รูปแบบแถวที่ PostgREST ส่งกลับตาม `PROFILE_COLUMNS` */
type ProfileRow = {
  user_id: string;
  display_name: string | null;
  username: string;
  role: UserRole;
  position_code: string | null;
  division_scope: Division[] | null;
  team_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
  last_login: string | null;
  /** join แบบ to-one — ไม่มีตำแหน่งก็เป็น null */
  positions: { name_th: string } | null;
};

function toAppProfile(row: ProfileRow): AppProfile {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    positionCode: row.position_code,
    positionName: row.positions?.name_th ?? null,
    divisionScope: row.division_scope ?? [],
    teamId: row.team_id,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    lastLogin: row.last_login,
  };
}

/**
 * อ่านโปรไฟล์ตาม user_id
 * คืน null เมื่อไม่มีแถว (ยังไม่ได้สร้างโปรไฟล์ให้บัญชีนี้) หรือ RLS ไม่ให้อ่าน
 */
export async function fetchProfileByUserId(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return toAppProfile(data as unknown as ProfileRow);
}
