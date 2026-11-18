/**
 * ชั้นอ่านข้อมูลหน้า "จัดการผู้ใช้" (ฝั่ง server จาก page.tsx)
 *
 * Logic summary:
 *   * ใช้ client ของผู้ใช้จริง (host) — RLS `profiles_host_all` ให้ host อ่านทุกแถว · ไม่ใช้ service role
 *   * select ระบุคอลัมน์ชัดเจน ไม่ใช้ `select('*')` · ไม่อ่านอีเมล/รหัสผ่าน (อยู่ฝั่ง GoTrue)
 *   * อ่านพลาด = คืน `error` ให้หน้าแสดงข้อความ ไม่แสดงรายการว่างเหมือนไม่มีผู้ใช้
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mergeReadStatus,
  parseReadStatusRows,
  type PositionOption,
  type ReadStatusRow,
  type UserRoleName,
  type UserRow,
} from "./userLogic";

type ProfileDb = {
  user_id: string;
  username: string;
  display_name: string | null;
  role: UserRoleName;
  position_code: string | null;
  is_active: boolean;
  must_change_password: boolean;
  last_login: string | null;
};

type PositionDb = {
  code: string;
  name_th: string;
  short_name_th: string;
  role: UserRoleName;
  assignable: boolean;
  sort_order: number;
};

const PROFILE_COLUMNS =
  "user_id, username, display_name, role, position_code, is_active, must_change_password, last_login";
const POSITION_COLUMNS = "code, name_th, short_name_th, role, assignable, sort_order";

/** ขอบบนจำนวนบัญชี (ทีมงานภายในหลักสิบ) — เกินนี้ต้องทำแบ่งหน้า */
export const USER_ROW_LIMIT = 500;

export async function loadUsersPage(
  supabase: SupabaseClient,
): Promise<{ users: UserRow[]; positions: PositionOption[]; error: boolean }> {
  const [profiles, positions, readStatus] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).order("username").limit(USER_ROW_LIMIT),
    supabase.from("positions").select(POSITION_COLUMNS).order("sort_order"),
    // M38: ป้าย "รอแจ้งผู้ใช้" — ไม่สำคัญพอทำให้หน้าล่ม: ล้ม = ไม่แสดงป้าย (log เฉพาะ code)
    supabase.rpc("list_notification_read_status"),
  ]);
  if (profiles.error || positions.error) return { users: [], positions: [], error: true };

  let statusRows: ReadStatusRow[] | null = null;
  if (readStatus.error) console.error("[admin/users] list_notification_read_status", readStatus.error.code ?? "unknown");
  else statusRows = parseReadStatusRows(readStatus.data);

  const users: UserRow[] = ((profiles.data ?? []) as ProfileDb[]).map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    positionCode: r.position_code,
    role: r.role,
    isActive: r.is_active,
    mustChangePassword: r.must_change_password,
    lastLogin: r.last_login,
  }));

  return {
    error: false,
    users: statusRows ? mergeReadStatus(users, statusRows) : users,
    positions: ((positions.data ?? []) as PositionDb[]).map((r) => ({
      code: r.code,
      nameTh: r.name_th,
      shortNameTh: r.short_name_th,
      role: r.role,
      assignable: r.assignable,
      sortOrder: r.sort_order,
    })),
  };
}
