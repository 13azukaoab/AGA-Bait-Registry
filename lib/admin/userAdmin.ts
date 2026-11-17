/**
 * ด่านเดียวสำหรับ `supabase.auth.admin.*` กับบัญชีผู้ใช้ (M21b)
 *
 * ทำไมต้องมีไฟล์นี้:
 *   DB กัน PS001/PS002 ได้กับ profiles/positions แต่ `auth.admin.updateUserById`
 *   (รีเซ็ตรหัส / แบน / เปลี่ยนอีเมล) ไปถึง GoTrue ตรงๆ ไม่แตะ profiles → DB กันบัญชีเจ้าของไม่ได้
 *   จึงต้องกันที่ชั้น server: ไฟล์นี้เป็นที่เดียวที่ import `@/lib/supabase/admin` สำหรับงานผู้ใช้
 *   (ตัวเช็กกัน bypass: `lib/admin/noAdminImportBypass.test.ts`)
 *
 * Logic ของทุกฟังก์ชัน (ลำดับตายตัว):
 *   1. ตรวจว่าอยู่ฝั่ง server
 *   2. ตรวจ input แบบ allowlist — ช่องที่ไม่รู้จัก (เช่น `division_scope`) ถูกปฏิเสธ ไม่ใช่เมินเงียบ
 *      (division_scope ให้ DB DEFAULT ตั้งเอง — SPEC §5.1 / M21)
 *   3. ตรวจ "ผู้เรียก" เป็น host ที่ยังเปิดอยู่ ด้วย session ของผู้เรียกเอง (ไม่ใช่ service role)
 *   4. (กับบัญชีที่มีอยู่) โหลด profiles.position_code → positions.assignable ของ "เป้าหมาย"
 *      ถ้าเป้าหมายอยู่ตำแหน่งที่ assignable=false (เจ้าของ) → PS003 ก่อนแตะ GoTrue
 *      อ่านไม่ได้/ไม่พบ/ตำแหน่งหาย = ปฏิเสธ (fail closed)
 *   5. หลังผ่านทุกด่านจึงสร้าง `createAdminClient()` แล้วเรียก GoTrue
 *   ผลลัพธ์เป็น `UserAdminResult` — ไม่โยน error ดิบของ GoTrue ออกไปให้ client
 *
 * ไฟล์นี้ไม่ทำ route/หน้าจอ (หมวด FE) — route เรียกฟังก์ชัน export ที่นี่แล้วแปลง code เป็น HTTP
 */
import { randomInt } from "node:crypto";

import { emailForUsername, isValidUsername, normalizeUsername } from "@/lib/auth/username";
import { fetchProfileByUserId } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

if (typeof window !== "undefined") {
  throw new Error("lib/admin/userAdmin must not be loaded in the browser");
}

/** รหัสข้อผิดพลาดที่ FE ใช้แปลงเป็นข้อความ/HTTP status */
export type UserAdminErrorCode =
  | "UNAUTHENTICATED" // ไม่ได้ล็อกอิน / บัญชีผู้เรียกถูกปิด → 401
  | "FORBIDDEN" // ผู้เรียกไม่ใช่ host → 403
  | "PS003" // เป้าหมายเป็นตำแหน่งที่เลือกไม่ได้ (เจ้าของ) → 403
  | "SELF_TARGET" // ปิด/ลบบัญชีตัวเองไม่ได้ → 409
  | "NOT_FOUND" // ไม่พบผู้ใช้/ตำแหน่ง → 404
  | "INVALID_INPUT" // input ผิดรูปแบบ / มีช่องที่ไม่อนุญาต → 400
  | "USERNAME_TAKEN" // username ซ้ำ → 409
  | "UPSTREAM_ERROR"; // GoTrue/DB ล้มเหลว (ไม่บอกรายละเอียด) → 500

export type UserAdminFailure = { ok: false; code: UserAdminErrorCode; message: string };
export type UserAdminResult<T extends object = object> = ({ ok: true } & T) | UserAdminFailure;

/** ข้อความไทยสำหรับแสดงผู้ใช้ — FE ใช้ตรงๆ ได้ */
export const USER_ADMIN_MESSAGES: Record<UserAdminErrorCode, string> = {
  UNAUTHENTICATED: "กรุณาเข้าสู่ระบบก่อน",
  FORBIDDEN: "เฉพาะผู้ดูแลระบบเท่านั้นที่จัดการบัญชีผู้ใช้ได้",
  PS003: "บัญชีนี้เป็นตำแหน่งเจ้าของ แก้ไข รีเซ็ตรหัส ปิด หรือลบจากหน้านี้ไม่ได้",
  SELF_TARGET: "ปิดหรือลบบัญชีของตัวเองไม่ได้",
  NOT_FOUND: "ไม่พบบัญชีผู้ใช้หรือตำแหน่งที่ระบุ",
  INVALID_INPUT: "ข้อมูลที่ส่งมาไม่ถูกต้อง",
  USERNAME_TAKEN: "ชื่อผู้ใช้นี้ถูกใช้แล้ว",
  UPSTREAM_ERROR: "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
};

function fail(code: UserAdminErrorCode): UserAdminFailure {
  return { ok: false, code, message: USER_ADMIN_MESSAGES[code] };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ban นานมาก (~100 ปี) = ปิดถาวรจนกว่าจะสั่ง "none" */
const BAN_FOREVER = "876000h";
const DISPLAY_NAME_MAX = 100;
const TEMP_PASSWORD_LENGTH = 12;
// ตัดตัวที่สับสนง่าย (0/O, 1/l/I)
const PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PASSWORD_LOWER = "abcdefghijkmnopqrstuvwxyz";
const PASSWORD_DIGITS = "23456789";
const PASSWORD_ALPHABET = PASSWORD_UPPER + PASSWORD_LOWER + PASSWORD_DIGITS;

/**
 * รหัสผ่านชั่วคราวแบบสุ่มด้วย crypto — แสดงให้ host ครั้งเดียว ไม่เก็บ ไม่ log
 * ผ่านกติการหัสผ่าน (DECISIONS 2.69) เสมอ: ยาว ≥ 10 + มีตัวพิมพ์เล็ก/ใหญ่/ตัวเลขอย่างน้อยอย่างละ 1
 * วิธี: บังคับ 3 ตำแหน่งแรกให้ครบ 3 ชนิด แล้วเติมที่เหลือจากทั้งชุด แล้วสลับตำแหน่ง (Fisher–Yates)
 */
function generateTempPassword(): string {
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(PASSWORD_LOWER), pick(PASSWORD_UPPER), pick(PASSWORD_DIGITS)];
  while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(pick(PASSWORD_ALPHABET));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** ตรวจว่า object มีเฉพาะ key ที่อนุญาต — กัน `division_scope`/`role`/`is_active` ที่แอบส่งมา */
function hasOnlyKeys(input: unknown, allowed: readonly string[]): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  return Object.keys(input).every((k) => allowed.includes(k));
}

type CallerSession = Awaited<ReturnType<typeof createClient>>;

/**
 * ด่าน (3): ผู้เรียกต้องล็อกอิน + เป็น host + บัญชียังเปิด — ใช้ session ของผู้เรียกเอง
 * ทั้ง `is_host()` (DB ตัดสิน) และโปรไฟล์ต้องผ่านทั้งคู่
 */
async function requireHostCaller(
  supabase: CallerSession,
): Promise<{ ok: true; callerId: string } | UserAdminFailure> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("UNAUTHENTICATED");

  const { data: isHost, error } = await supabase.rpc("is_host");
  if (error) return fail("UPSTREAM_ERROR");
  if (isHost !== true) return fail("FORBIDDEN");

  const profile = await fetchProfileByUserId(supabase, user.id);
  if (!profile || !profile.isActive) return fail("UNAUTHENTICATED");
  if (profile.role !== "host") return fail("FORBIDDEN");

  return { ok: true, callerId: user.id };
}

type PositionRow = { code: string; role: string; assignable: boolean };

async function loadPosition(
  supabase: CallerSession,
  code: string,
): Promise<{ ok: true; position: PositionRow } | UserAdminFailure> {
  const { data, error } = await supabase
    .from("positions")
    .select("code, role, assignable")
    .eq("code", code)
    .maybeSingle();
  if (error) return fail("UPSTREAM_ERROR");
  if (!data) return fail("NOT_FOUND");
  const row = data as PositionRow;
  // ค่า assignable ต้องเป็น boolean จริง — อย่างอื่น (null/ขาด) ถือว่าไม่ปลอดภัย
  if (typeof row.assignable !== "boolean") return fail("UPSTREAM_ERROR");
  return { ok: true, position: row };
}

/**
 * ด่าน (4): เป้าหมายต้องมีโปรไฟล์ + ตำแหน่งต้อง assignable
 * ไม่มีโปรไฟล์ = ปฏิเสธ (ไม่แตะบัญชี auth ที่ไม่รู้ว่าเป็นใคร — อาจเป็นเจ้าของที่โปรไฟล์ตกหล่น)
 * ตำแหน่ง null = ไม่ใช่เจ้าของ (DB guard ถือเหมือนกัน) แต่ต้องมีแถวโปรไฟล์ก่อน
 */
async function requireAssignableTarget(
  supabase: CallerSession,
  targetUserId: string,
): Promise<{ ok: true } | UserAdminFailure> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("user_id, position_code")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (error) return fail("UPSTREAM_ERROR");
  if (!profile) return fail("NOT_FOUND");

  const positionCode = (profile as { position_code: string | null }).position_code;
  if (positionCode === null) return { ok: true };

  const pos = await loadPosition(supabase, positionCode);
  if (!pos.ok) {
    // ตำแหน่งที่โปรไฟล์อ้างแต่หาไม่เจอ = ข้อมูลผิดปกติ → ปฏิเสธ ไม่เดาว่าปลอดภัย
    return pos.code === "NOT_FOUND" ? fail("UPSTREAM_ERROR") : pos;
  }
  if (!pos.position.assignable) return fail("PS003");
  return { ok: true };
}

/** ด่านรวมสำหรับ action กับบัญชีที่มีอยู่: input → ผู้เรียก → เป้าหมาย */
async function guardExistingTarget(
  targetUserId: unknown,
  opts: { forbidSelf?: boolean } = {},
): Promise<{ ok: true; supabase: CallerSession; targetUserId: string } | UserAdminFailure> {
  if (typeof targetUserId !== "string" || !UUID_PATTERN.test(targetUserId)) {
    return fail("INVALID_INPUT");
  }
  const supabase = await createClient();
  const caller = await requireHostCaller(supabase);
  if (!caller.ok) return caller;
  if (opts.forbidSelf && caller.callerId === targetUserId.toLowerCase()) {
    return fail("SELF_TARGET");
  }
  const target = await requireAssignableTarget(supabase, targetUserId);
  if (!target.ok) return target;
  return { ok: true, supabase, targetUserId };
}

// ---------------------------------------------------------------------------
// สร้างบัญชี
// ---------------------------------------------------------------------------

export type CreateUserInput = {
  /** username ดิบจากฟอร์ม (จะ normalize ให้) · อีเมลประกอบฝั่ง server */
  username: string;
  displayName: string;
  positionCode: string;
};

export type CreateUserData = { userId: string; username: string; temporaryPassword: string };

/**
 * สร้างบัญชี: auth user + แถว profiles (role มาจาก positions.role ไม่รับจาก input)
 * ห้ามส่ง division_scope — ให้ DB DEFAULT ตั้ง · ตำแหน่ง assignable=false → PS003
 * ถ้าแทรก profiles ล้มเหลว จะลบ auth user ที่เพิ่งสร้างทิ้ง (ไม่ทิ้งบัญชีกำพร้า)
 */
export async function createUser(input: CreateUserInput): Promise<UserAdminResult<CreateUserData>> {
  if (!hasOnlyKeys(input, ["username", "displayName", "positionCode"])) return fail("INVALID_INPUT");
  const { username: rawUsername, displayName: rawDisplayName, positionCode } = input as Record<
    string,
    unknown
  >;
  if (
    typeof rawUsername !== "string" ||
    typeof rawDisplayName !== "string" ||
    typeof positionCode !== "string"
  ) {
    return fail("INVALID_INPUT");
  }
  const username = normalizeUsername(rawUsername);
  const displayName = rawDisplayName.trim();
  if (
    !isValidUsername(username) ||
    displayName.length === 0 ||
    displayName.length > DISPLAY_NAME_MAX ||
    positionCode.trim().length === 0
  ) {
    return fail("INVALID_INPUT");
  }

  const supabase = await createClient();
  const caller = await requireHostCaller(supabase);
  if (!caller.ok) return caller;

  const pos = await loadPosition(supabase, positionCode);
  if (!pos.ok) return pos;
  if (!pos.position.assignable) return fail("PS003");

  const temporaryPassword = generateTempPassword();
  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: emailForUsername(username),
    password: temporaryPassword,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    const status = (createError as { status?: number } | null)?.status;
    return fail(status === 422 ? "USERNAME_TAKEN" : "UPSTREAM_ERROR");
  }
  const userId = created.user.id;

  // แถว profiles ผ่านด้วยสิทธิ์ของผู้เรียก (RLS host) — ไม่ส่ง division_scope
  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: userId,
    username,
    display_name: displayName,
    role: pos.position.role,
    position_code: pos.position.code,
    must_change_password: true,
  });
  if (profileError) {
    // ย้อนกลับ: ลบ auth user ที่เพิ่งสร้างเอง (เป้าหมายใหม่ ไม่ใช่เจ้าของ)
    await admin.auth.admin.deleteUser(userId);
    const code = (profileError as { code?: string }).code;
    return fail(code === "23505" ? "USERNAME_TAKEN" : "UPSTREAM_ERROR");
  }

  return { ok: true, userId, username, temporaryPassword };
}

// ---------------------------------------------------------------------------
// รีเซ็ตรหัสผ่าน
// ---------------------------------------------------------------------------

/**
 * รีเซ็ตรหัสเป็นรหัสชั่วคราวใหม่ + บังคับเปลี่ยนตอนเข้าครั้งหน้า
 * ตั้ง must_change_password ก่อน เพื่อถ้าล้มจะยังไม่เปลี่ยนรหัสจริง
 */
export async function resetPassword(
  targetUserId: string,
): Promise<UserAdminResult<{ temporaryPassword: string }>> {
  const guard = await guardExistingTarget(targetUserId);
  if (!guard.ok) return guard;

  const { error: flagError } = await guard.supabase
    .from("profiles")
    .update({ must_change_password: true })
    .eq("user_id", guard.targetUserId);
  if (flagError) return fail("UPSTREAM_ERROR");

  const temporaryPassword = generateTempPassword();
  const { error } = await createAdminClient().auth.admin.updateUserById(guard.targetUserId, {
    password: temporaryPassword,
  });
  if (error) return fail("UPSTREAM_ERROR");
  return { ok: true, temporaryPassword };
}

// ---------------------------------------------------------------------------
// ปิด / เปิดบัญชี (ฝั่ง GoTrue)
// ---------------------------------------------------------------------------

/**
 * ปิด (banned=true) / เปิดคืน (banned=false) ที่ GoTrue เพื่อตัดการล็อกอิน
 * ⚠ ไม่แตะ profiles.is_active — route ต้องอัปเดตผ่าน client ของผู้เรียก (RLS + trigger กัน host คนสุดท้าย)
 *   ในคำขอเดียวกัน · ปิดตัวเองไม่ได้ (SELF_TARGET) เฉพาะตอนปิด
 */
export async function setBanned(
  targetUserId: string,
  banned: boolean,
): Promise<UserAdminResult> {
  if (typeof banned !== "boolean") return fail("INVALID_INPUT");
  const guard = await guardExistingTarget(targetUserId, { forbidSelf: banned });
  if (!guard.ok) return guard;

  const { error } = await createAdminClient().auth.admin.updateUserById(guard.targetUserId, {
    ban_duration: banned ? BAN_FOREVER : "none",
  });
  if (error) return fail("UPSTREAM_ERROR");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// เปลี่ยน username (= เปลี่ยนอีเมลภายใน)
// ---------------------------------------------------------------------------

/** mockup ให้ username แก้ไม่ได้ตอนแก้ไข — เตรียมไว้เผื่อ SPEC เปลี่ยน · อีเมลประกอบจาก username เสมอ */
export async function changeUsername(
  targetUserId: string,
  newUsername: string,
): Promise<UserAdminResult<{ username: string }>> {
  if (typeof newUsername !== "string") return fail("INVALID_INPUT");
  const username = normalizeUsername(newUsername);
  if (!isValidUsername(username)) return fail("INVALID_INPUT");

  const guard = await guardExistingTarget(targetUserId);
  if (!guard.ok) return guard;

  const { data: before, error: beforeError } = await guard.supabase
    .from("profiles")
    .select("username")
    .eq("user_id", guard.targetUserId)
    .maybeSingle();
  const previousUsername = (before as { username?: string } | null)?.username;
  if (beforeError || !previousUsername) return fail("UPSTREAM_ERROR");

  const { error: profileError } = await guard.supabase
    .from("profiles")
    .update({ username })
    .eq("user_id", guard.targetUserId);
  if (profileError) {
    const code = (profileError as { code?: string }).code;
    return fail(code === "23505" ? "USERNAME_TAKEN" : "UPSTREAM_ERROR");
  }

  const { error } = await createAdminClient().auth.admin.updateUserById(guard.targetUserId, {
    email: emailForUsername(username),
    email_confirm: true,
  });
  if (error) {
    // ย้อน username ใน profiles ให้ตรงกับอีเมลเดิมใน GoTrue (best effort)
    await guard.supabase
      .from("profiles")
      .update({ username: previousUsername })
      .eq("user_id", guard.targetUserId);
    return fail("UPSTREAM_ERROR");
  }
  return { ok: true, username };
}

// ---------------------------------------------------------------------------
// ลบบัญชีถาวร
// ---------------------------------------------------------------------------

/** ลบถาวร (cascade ลบ profiles) — mockup ใช้ "ปิดบัญชี" แทน (DECISIONS 1.10) ควรเรียกเฉพาะกรณีพิเศษ */
export async function deleteUser(targetUserId: string): Promise<UserAdminResult> {
  const guard = await guardExistingTarget(targetUserId, { forbidSelf: true });
  if (!guard.ok) return guard;

  const { error } = await createAdminClient().auth.admin.deleteUser(guard.targetUserId);
  if (error) return fail("UPSTREAM_ERROR");
  return { ok: true };
}
