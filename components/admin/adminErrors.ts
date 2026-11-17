/**
 * ข้อความ error ภาษาไทยของหน้า "จัดการผู้ใช้" และ "ตั้งค่า" — ไฟล์เดียว (pure function · ใช้ได้ทั้ง server/client)
 *
 * Logic summary:
 *   * รับ "รหัส error" (code) → คืนข้อความไทยที่ปลอดภัยให้ผู้ใช้เห็น
 *     - รหัสของ `lib/admin/userAdmin` (FORBIDDEN, PS003, SELF_TARGET, USERNAME_TAKEN …)
 *     - รหัส SQLSTATE ที่ฐานข้อมูลโยน (PS001, TM001–TM006, TR001–TR005, WL001, AS001, CT001, 23505, 42501 …)
 *     - รหัสที่หน้านี้ตั้งเอง: LAST_HOST (P0001 ตอนปิด/ลดสิทธิ์ host คนสุดท้าย)
 *   * **ห้าม log หรือแสดงข้อความดิบจากฐานข้อมูล** — ใช้ได้แค่ `code` · ถ้าไม่รู้จักรหัส = ข้อความกลาง
 *   * ตัวเลขที่ใส่ในข้อความ (เดือน, จำนวนที่ผูก) ดึงจาก `message`/`detail` ด้วย pattern เข้ม ถ้ารูปแบบแปลก = ไม่ใส่
 */

/** รหัสที่ server action ส่งกลับให้ client */
export type AdminErrorCode = string;

export type ActionFailure = { ok: false; code: AdminErrorCode; message: string };
export type ActionResult<T extends object = object> = ({ ok: true } & T) | ActionFailure;

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

/**
 * 'YYYY-MM' ตัวสุดท้ายที่เจอในข้อความ — ไม่เจอ = null
 * (TR002: "เกณฑ์ที่เริ่มใช้ <เดือนที่เลือก> จะกระทบเดือน <เดือนที่ปิดแล้ว>" — ต้องการเดือนที่ปิด = ตัวหลัง)
 */
function monthIn(text: string | null | undefined): string | null {
  const all = [...(text ?? "").matchAll(/(\d{4})-(0[1-9]|1[0-2])/g)];
  const m = all.at(-1);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** DETAIL แบบ JSON `{"contracts":1,"visits":2,"users":0}` → ตัวเลข (ผิดรูปแบบ = null) */
export function parseCounts(detail: string | null | undefined): Record<string, number> | null {
  if (!detail || detail.length > 200) return null;
  try {
    const obj: unknown = JSON.parse(detail);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
      out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

function describeBinding(detail: string | null | undefined): string {
  const c = parseCounts(detail);
  if (!c) return "";
  const parts: string[] = [];
  if (c.contracts) parts.push(`สัญญา ${c.contracts}`);
  if (c.visits) parts.push(`การเข้าบริการ ${c.visits}`);
  if (c.users) parts.push(`ผู้ใช้ ${c.users}`);
  return parts.length > 0 ? ` (${parts.join(" · ")})` : "";
}

export function describeAdminError(
  code: string,
  extra: { message?: string | null; detail?: string | null } = {},
): string {
  switch (code) {
    // ---- บัญชีผู้ใช้ (lib/admin/userAdmin) ----
    case "UNAUTHENTICATED":
      return "กรุณาเข้าสู่ระบบก่อน";
    case "FORBIDDEN":
    case "42501":
    case "TM006":
      return "เฉพาะผู้ดูแลระบบ (PM / OM / เจ้าของ) เท่านั้นที่ทำรายการนี้ได้";
    case "PS001":
    case "PS003":
      return "บัญชีนี้เป็นตำแหน่งเจ้าของ แก้ไข รีเซ็ตรหัส ปิด หรือลบจากหน้านี้ไม่ได้";
    case "PS002":
      return "ตำแหน่งนี้เลือกหรือแก้จากหน้าจอไม่ได้";
    case "SELF_TARGET":
      return "ปิดบัญชีของตัวเองไม่ได้ — ให้ผู้ดูแลระบบคนอื่นเป็นคนปิดให้";
    case "LAST_HOST":
      return "ทำรายการไม่ได้ — ต้องมีผู้ดูแลระบบ (PM / OM / เจ้าของ) ที่ใช้งานอยู่อย่างน้อย 1 คน";
    case "NOT_FOUND":
    case "AG004":
      return "ไม่พบรายการที่ระบุ (อาจถูกลบไปแล้ว) — โหลดหน้าใหม่แล้วลองอีกครั้ง";
    case "INVALID_INPUT":
    case "22004":
    case "22023":
      return "ข้อมูลที่ส่งมาไม่ถูกต้อง ตรวจสอบแล้วลองอีกครั้ง";
    case "USERNAME_TAKEN":
      return "รหัสพนักงาน (username) นี้มีบัญชีแล้ว";
    case "BAD_CONFIRM":
      return 'พิมพ์คำว่า "ยืนยันแก้ไข" ให้ตรงก่อนจึงจะบันทึกได้';
    case "UPSTREAM_ERROR":
      return GENERIC;

    // ---- ทีม / ประเภทลูกค้า ----
    case "TM001":
      return `ลบทีมนี้ไม่ได้ เพราะยังมีงานผูกอยู่${describeBinding(extra.detail)} — ให้ปิดใช้งานทีมแทน`;
    case "TM002":
      return "ทีมระบบ (Sup) ลบ ปิดใช้ หรือเปลี่ยนรหัส/ประเภทไม่ได้";
    case "TM003":
      return `เปลี่ยนเป็นทีมหัวหน้างานไม่ได้ เพราะทีมนี้ยังมีงานผูกอยู่${describeBinding(extra.detail)}`;
    case "TM004":
      return "ทีมนี้ปิดใช้งานอยู่";
    case "TM005":
      return "ทีมหัวหน้างานผูกกับสัญญา/การเข้าบริการไม่ได้";
    case "CT001":
      return "รายการจัดเรียงไม่ตรงกับข้อมูลปัจจุบัน — โหลดหน้าใหม่แล้วลองอีกครั้ง";
    case "23505":
      return "ชื่อหรือรหัสนี้ถูกใช้แล้ว เปลี่ยนเป็นค่าอื่น";
    case "23503":
      return "ลบไม่ได้ เพราะยังมีข้อมูลอื่นอ้างถึงรายการนี้อยู่ — ให้ปิดใช้งานแทน (ถ้ามี)";
    case "23514":
      return "ค่าที่กรอกอยู่นอกช่วงที่อนุญาต";

    // ---- เกณฑ์ Tier / Workload ----
    case "TR001":
      return "ค่าเกณฑ์ไม่ถูกต้อง — ตรวจจุดเริ่ม M < L < XL เรียงจากน้อยไปมาก ทศนิยมไม่เกิน 2 ตำแหน่ง";
    case "TR002": {
      const m = monthIn(extra.message);
      return m
        ? `เกณฑ์ที่เริ่มใช้ตั้งแต่เดือนที่เลือกจะกระทบเดือน ${m} ที่ปิดแล้ว — เลือกเดือนเริ่มใช้หลังเดือนที่ปิดล่าสุด`
        : "เกณฑ์ที่เลือกจะกระทบเดือนที่ปิดแล้ว — เลือกเดือนเริ่มใช้หลังเดือนที่ปิดล่าสุด";
    }
    case "TR003":
      return "ต้องระบุเหตุผลที่แก้เกณฑ์";
    case "TR004":
      return "ชุดเกณฑ์ไม่ครบหรือไม่ต่อกัน — ระบบไม่บันทึกให้ ลองตรวจค่าอีกครั้ง";
    case "TR005": {
      const m = monthIn(extra.message);
      return m
        ? `เกณฑ์ใหม่ต้องเริ่มใช้ตั้งแต่เดือนเริ่มใช้ระบบ (${m}) เป็นต้นไป`
        : "เกณฑ์ใหม่ต้องเริ่มใช้ตั้งแต่เดือนเริ่มใช้ระบบเป็นต้นไป";
    }
    case "WL001":
      return "เกณฑ์ Workload ต้องมากกว่า 0 และไม่เกิน 300 ชม./คน/เดือน ทศนิยมไม่เกิน 2 ตำแหน่ง";
    case "AS001":
      return "ค่าตั้งระบบผิดปกติ — แจ้งผู้ดูแลฐานข้อมูล";
    default:
      return GENERIC;
  }
}

/** ประกอบ failure จากรหัส (ใช้ใน server action) */
export function failure(
  code: string,
  extra: { message?: string | null; detail?: string | null } = {},
): ActionFailure {
  return { ok: false, code, message: describeAdminError(code, extra) };
}

/** error ของ supabase-js → failure (log เฉพาะ code · ไม่แตะข้อความดิบ) */
export function failureFromDb(error: {
  code?: string;
  message?: string;
  details?: string | null;
}): ActionFailure {
  const code = typeof error.code === "string" && error.code !== "" ? error.code : "UPSTREAM_ERROR";
  return failure(code, { message: error.message ?? null, detail: error.details ?? null });
}
