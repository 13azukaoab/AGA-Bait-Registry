/**
 * ตรรกะ pure ของหน้า "จัดการผู้ใช้" (`/admin/users`) — ไม่แตะ DB/React จึงทดสอบได้ตรงๆ
 *
 * Logic summary:
 *   * ผู้ใช้เลือก "ตำแหน่ง" (`positions.code`) ไม่ใช่ role ดิบ — role มาจาก `positions.role` (DB trigger ตั้งให้)
 *   * ตำแหน่งที่ `assignable = false` (เจ้าของ) ไม่โผล่ในตัวเลือกสร้าง/แก้ และบัญชีที่ถือตำแหน่งนี้แก้/รีเซ็ต/ปิดจากหน้านี้ไม่ได้
 *   * รหัสพนักงาน (username) เก็บตัวพิมพ์เล็กใน DB · พิมพ์ใหญ่มาก็ normalize ให้ · แสดงบนจอเป็นตัวพิมพ์ใหญ่ตามตัวอย่าง mockup (AG-01001)
 *   * เปลี่ยนตำแหน่ง = เปลี่ยนสิทธิ์ → ต้องพิมพ์คำยืนยัน `CONFIRM_PHRASE` (เจ้าของสั่ง 15 พ.ย. 2026)
 *   * การ์ดสรุป/ตัวกรองสร้างจากรายการตำแหน่งจริง — เพิ่มตำแหน่งใหม่แล้วโผล่เอง
 */
import { isValidUsername, normalizeUsername } from "@/lib/auth/username";

export const CONFIRM_PHRASE = "ยืนยันแก้ไข";
export const DISPLAY_NAME_MAX = 100;

export type UserRoleName = "host" | "admin" | "recorder" | "viewer";

export type PositionOption = {
  code: string;
  nameTh: string;
  shortNameTh: string;
  role: UserRoleName;
  assignable: boolean;
  sortOrder: number;
};

export type UserRow = {
  userId: string;
  username: string;
  displayName: string | null;
  positionCode: string | null;
  role: UserRoleName;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLogin: string | null;
  /** วันเปิดบัญชี (profiles.created_at · ISO timestamptz) · DECISIONS 2.114 — optional ให้ fixture เดิมไม่พัง */
  createdAt?: string;
  /** M38: มีแจ้งเตือน "ตำแหน่งถูกเปลี่ยน" ที่ผู้ใช้ยังไม่อ่าน (RPC list_notification_read_status) */
  hasUnreadPositionChange?: boolean;
  unreadCount?: number;
  oldestUnreadAt?: string | null;
};

/** แถวจาก RPC `list_notification_read_status()` (host เท่านั้น · ไม่มีเนื้อหาแจ้งเตือน) */
export type ReadStatusRow = {
  userId: string;
  hasUnread: boolean;
  unreadCount: number;
  oldestUnreadAt: string | null;
};

/** แปลงผล RPC — รูปแบบแปลก = null (หน้าจอไม่แสดงป้าย ไม่เดา) */
export function parseReadStatusRows(data: unknown): ReadStatusRow[] | null {
  if (!Array.isArray(data)) return null;
  const out: ReadStatusRow[] = [];
  for (const r of data) {
    if (typeof r !== "object" || r === null) return null;
    const o = r as Record<string, unknown>;
    const n = Number(o.unread_count);
    if (typeof o.user_id !== "string" || typeof o.has_unread_position_change !== "boolean" || !Number.isInteger(n) || n < 0) {
      return null;
    }
    out.push({
      userId: o.user_id,
      hasUnread: o.has_unread_position_change,
      unreadCount: n,
      oldestUnreadAt: typeof o.oldest_unread_at === "string" ? o.oldest_unread_at : null,
    });
  }
  return out;
}

/** ผนวกสถานะอ่านเข้าแถวผู้ใช้ (ผู้ใช้ที่ไม่มีในผลลัพธ์ = ไม่มีป้าย) */
export function mergeReadStatus(users: readonly UserRow[], rows: readonly ReadStatusRow[]): UserRow[] {
  const byId = new Map(rows.map((r) => [r.userId, r]));
  return users.map((u) => {
    const s = byId.get(u.userId);
    return s
      ? { ...u, hasUnreadPositionChange: s.hasUnread, unreadCount: s.unreadCount, oldestUnreadAt: s.oldestUnreadAt }
      : u;
  });
}

/** ชื่อที่แสดง: ไม่มีชื่อ = ใช้ username */
export function nameOf(u: Pick<UserRow, "displayName" | "username">): string {
  const n = (u.displayName ?? "").trim();
  return n !== "" ? n : u.username.toUpperCase();
}

export function usernameLabel(username: string): string {
  return username.toUpperCase();
}

export function positionOf(
  positions: readonly PositionOption[],
  code: string | null,
): PositionOption | undefined {
  return code === null ? undefined : positions.find((p) => p.code === code);
}

/** บัญชีนี้แก้/รีเซ็ต/ปิดจากหน้านี้ได้ไหม (ตำแหน่งต้อง assignable — ไม่รู้จักตำแหน่ง = ไม่ได้) */
export function canManageRow(
  u: Pick<UserRow, "positionCode">,
  positions: readonly PositionOption[],
): boolean {
  if (u.positionCode === null) return true; // ยังไม่ตั้งตำแหน่ง = ไม่ใช่เจ้าของ (ตรงกับ lib/admin/userAdmin)
  const p = positionOf(positions, u.positionCode);
  return p !== undefined && p.assignable;
}

/** ตำแหน่งที่เลือกได้ในฟอร์ม (เรียงตาม sort_order) */
export function selectablePositions(positions: readonly PositionOption[]): PositionOption[] {
  return positions.filter((p) => p.assignable).sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------
// ตัวกรอง / สถิติ
// ---------------------------------------------------------------------------

export type UserFilter = {
  query: string;
  positionCode: string; // "" = ทุกตำแหน่ง
  status: "" | "on" | "off";
  /** การ์ดสรุปที่กดอยู่: "" = ทั้งหมด · "off" = ปิดบัญชี · อื่น = รหัสตำแหน่ง (เฉพาะที่ใช้งานอยู่) */
  card: string;
};

export const EMPTY_FILTER: UserFilter = { query: "", positionCode: "", status: "", card: "" };

export function matchesFilter(u: UserRow, f: UserFilter): boolean {
  const q = f.query.trim().toLowerCase();
  if (q !== "" && !nameOf(u).toLowerCase().includes(q) && !u.username.toLowerCase().includes(q)) {
    return false;
  }
  if (f.positionCode !== "" && u.positionCode !== f.positionCode) return false;
  if (f.status === "on" && !u.isActive) return false;
  if (f.status === "off" && u.isActive) return false;
  if (f.card === "off" && u.isActive) return false;
  if (f.card !== "" && f.card !== "off" && (u.positionCode !== f.card || !u.isActive)) return false;
  return true;
}

export type UserStats = { total: number; off: number; byPosition: Record<string, number> };

/** นับบัญชีที่ใช้งานอยู่ต่อตำแหน่ง + จำนวนที่ปิด */
export function computeStats(users: readonly UserRow[]): UserStats {
  const byPosition: Record<string, number> = {};
  let off = 0;
  for (const u of users) {
    if (!u.isActive) {
      off += 1;
      continue;
    }
    const key = u.positionCode ?? "";
    byPosition[key] = (byPosition[key] ?? 0) + 1;
  }
  return { total: users.length, off, byPosition };
}

/** ผู้ดูแลระบบ (host) ที่ใช้งานอยู่ ไม่นับ `exceptUserId` — ใช้เตือนก่อนปิด/ลดสิทธิ์คนสุดท้าย (DB บังคับจริงอีกชั้น) */
export function activeHostCount(users: readonly UserRow[], exceptUserId?: string): number {
  return users.filter((u) => u.role === "host" && u.isActive && u.userId !== exceptUserId).length;
}

// ---------------------------------------------------------------------------
// ฟอร์ม
// ---------------------------------------------------------------------------

export type CreateDraft = { username: string; displayName: string; positionCode: string };
export type FieldErrors = Partial<Record<"username" | "displayName" | "positionCode" | "confirm", string>>;

export function validateCreate(
  d: CreateDraft,
  positions: readonly PositionOption[],
  existingUsernames: readonly string[],
): FieldErrors {
  const errors: FieldErrors = {};
  const username = normalizeUsername(d.username);
  if (!isValidUsername(username)) {
    errors.username = "รหัสพนักงานต้องเป็นตัวอักษร/ตัวเลข (a-z 0-9 . _ -) ยาว 3–20 ตัว เช่น ag-01234";
  } else if (existingUsernames.some((x) => x.toLowerCase() === username)) {
    errors.username = "รหัสพนักงานนี้มีบัญชีแล้ว";
  }
  const name = d.displayName.trim();
  if (name === "") errors.displayName = "กรอกชื่อ-นามสกุลจริง";
  else if (name.length > DISPLAY_NAME_MAX) errors.displayName = `ชื่อยาวได้ไม่เกิน ${DISPLAY_NAME_MAX} ตัวอักษร`;
  if (!selectablePositions(positions).some((p) => p.code === d.positionCode)) {
    errors.positionCode = "เลือกตำแหน่งก่อน";
  }
  return errors;
}

export type EditDraft = { displayName: string; positionCode: string; confirm: string };

/**
 * ตรวจฟอร์มแก้ไข · `positionChanged` = ตำแหน่งต่างจากเดิม (ต้องพิมพ์คำยืนยัน)
 * `wouldLeaveNoHost` = การเปลี่ยนนี้ทำให้ไม่เหลือ host ที่ใช้งานอยู่ (เตือนก่อนส่ง · DB กันซ้ำ)
 */
export function validateEdit(
  d: EditDraft,
  original: Pick<UserRow, "positionCode" | "role" | "isActive" | "userId">,
  positions: readonly PositionOption[],
  users: readonly UserRow[],
): FieldErrors {
  const errors: FieldErrors = {};
  const name = d.displayName.trim();
  if (name === "") errors.displayName = "กรอกชื่อ-นามสกุลจริง";
  else if (name.length > DISPLAY_NAME_MAX) errors.displayName = `ชื่อยาวได้ไม่เกิน ${DISPLAY_NAME_MAX} ตัวอักษร`;

  const unchanged = d.positionCode === (original.positionCode ?? "");
  if (!unchanged) {
    const target = selectablePositions(positions).find((p) => p.code === d.positionCode);
    if (!target) {
      errors.positionCode = "เลือกตำแหน่งก่อน";
    } else if (
      original.role === "host" &&
      original.isActive &&
      target.role !== "host" &&
      activeHostCount(users, original.userId) === 0
    ) {
      errors.positionCode =
        "เปลี่ยนตำแหน่งนี้ไม่ได้ — ต้องมีผู้ดูแลระบบ (PM / OM / เจ้าของ) ที่ใช้งานอยู่อย่างน้อย 1 คน";
    }
    if (d.confirm.trim() !== CONFIRM_PHRASE) {
      errors.confirm = `พิมพ์คำว่า "${CONFIRM_PHRASE}" ให้ตรงก่อนจึงจะเปลี่ยนตำแหน่งได้`;
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// วันที่ "เข้าใช้ล่าสุด" (เวลาไทย)
// ---------------------------------------------------------------------------

function bangkokParts(date: Date): { ymd: string; hm: string; dmy: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hm: `${hour}:${get("minute")}`,
    dmy: `${get("day")}/${get("month")}/${get("year")}`,
  };
}

/** "ยังไม่เคยเข้า" · "วันนี้ 08:41" · "เมื่อวาน 17:20" · "04/11/2026" (ค.ศ. ตาม mockup) */
export function formatLastLogin(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "ยังไม่เคยเข้า";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const at = bangkokParts(d);
  const today = bangkokParts(now);
  if (at.ymd === today.ymd) return `วันนี้ ${at.hm}`;
  const yesterday = bangkokParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (at.ymd === yesterday.ymd) return `เมื่อวาน ${at.hm}`;
  return at.dmy;
}
