import { isValidTermMonths } from "../rules/term";

/**
 * ตัวล้าง/ตรวจระดับฟิลด์ (pure) สำหรับการนำเข้าสัญญาจาก Excel
 * ทุกตัวคืน value ที่ล้างแล้ว + fix (บอกว่าแก้อะไร) หรือ error (ต้องแก้เอง)
 */

// ---------- เลขที่สัญญา ----------
export interface ContractNoResult {
  value: string;
  /** รูปแบบเป็นเลขที่สัญญา CTyy-nnn… หรือไม่ (ถ้าไม่ใช่ = ไม่ใช่แถวสัญญา) */
  isContractNo: boolean;
  /** ครบรูปแบบ CTyy-nnnnnnn (7 หลัก) หรือไม่ */
  wellFormed: boolean;
  fix?: string;
}

const CONTRACT_LOOSE = /^CT\d{2}-\d+$/;
const CONTRACT_STRICT = /^CT\d{2}-\d{7}$/;

export function normalizeContractNo(raw: string): ContractNoResult {
  const original = raw ?? "";
  const value = original.replace(/\s+/g, "").toUpperCase();
  const isContractNo = CONTRACT_LOOSE.test(value);
  const wellFormed = CONTRACT_STRICT.test(value);
  let fix: string | undefined;
  if (isContractNo && value !== original) {
    // value ต่างจากที่พิมพ์มา = มีการล้าง (ตัวพิมพ์/ช่องว่างใน vs ช่องว่างหัวท้าย)
    fix =
      value !== original.trim()
        ? `เลขที่สัญญา "${original.trim()}" → ${value}`
        : `เลขที่สัญญา: ตัดช่องว่าง → ${value}`;
  }
  return { value, isContractNo, wellFormed, fix };
}

// ---------- เวลา ----------
export interface TimeResult {
  value: string | null; // 'HH:mm'
  fix?: string;
  error?: string;
}

export function normalizeTime(raw: string): TimeResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { value: null };

  const m = trimmed.match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return { value: null, error: `อ่านเวลาไม่ออก "${trimmed}"` };

  const value = `${m[1]!.padStart(2, "0")}:${m[2]}`;
  const fix = value !== trimmed ? `เวลา "${trimmed}" → ${value}` : undefined;
  return { value, fix };
}

// ---------- วันที่ ----------
export interface DateResult {
  iso: string | null; // 'YYYY-MM-DD'
  error?: string;
}

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** ตรวจว่าเป็นวันที่มีจริง (กันเดือน/วันเกินจริง เช่น 31/11) */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * รับได้ 2 รูปแบบ: dd/mm/yyyy และ yyyy-mm-dd (ค.ศ.)
 * ปฏิเสธ: รูปแบบพัง, วันที่ไม่มีจริง, ปี < 2000 หรือ > 2100
 */
export function parseSourceDate(raw: string): DateResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { iso: null };

  let y: number, m: number, d: number;
  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const ymd = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dmy) {
    d = +dmy[1]!;
    m = +dmy[2]!;
    y = +dmy[3]!;
  } else if (ymd) {
    y = +ymd[1]!;
    m = +ymd[2]!;
    d = +ymd[3]!;
  } else {
    return { iso: null, error: `อ่านวันที่ไม่ออก "${trimmed}"` };
  }

  if (y < MIN_YEAR || y > MAX_YEAR) {
    return { iso: null, error: `ปีผิดปกติ (${trimmed})` };
  }
  if (!isRealDate(y, m, d)) {
    return { iso: null, error: `วันที่ไม่มีจริง (${trimmed})` };
  }
  return { iso: `${y}-${pad(m)}-${pad(d)}` };
}

// ---------- ทีม ----------
export interface TeamResult {
  teams: string[];
  fixes: string[];
  error?: string;
}

/**
 * รหัสทีมสำรอง (ชุดตอนตั้งต้นระบบ: A–O, Z, Sup) ใช้เมื่อผู้เรียกไม่ส่งรายชื่อทีมจริงจากตาราง `teams`
 * ผู้เรียกที่อ่านตาราง `teams` ได้ ควรส่ง `knownCodes` เสมอ — ทีมใหม่ที่เพิ่มจากหน้าตั้งค่า (M22) จะได้ผ่านการตรวจ
 */
const DEFAULT_TEAM_CODES: readonly string[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
  "Z", "Sup",
];

/** คำที่หมายถึงหัวหน้างาน → Sup */
const SUP_ALIASES = new Set(["sup", "SUP", "Sup", "หนง.", "หน."]);

/**
 * normalize ช่องทีม — รองรับหลายทีมคั่นด้วย ,
 * - sup/หนง. → Sup · ตัวเล็ก a → A
 * - "หลายทีม" (ไม่ระบุว่าทีมไหน) → error
 * - ทีมไม่รู้จัก → error
 * - ว่าง → teams:[] (ยังไม่นัด ไม่ใช่ error)
 * - `knownCodes` = รหัสทีมที่มีอยู่จริงในตาราง `teams` (ไม่ระบุ = ชุดตั้งต้น A–O, Z, Sup)
 *   เทียบแบบไม่สนตัวพิมพ์ แล้วคืนรหัสตามที่ลงทะเบียนไว้จริง (เช่น "sup" → "Sup")
 */
export function normalizeTeams(raw: string, knownCodes: readonly string[] = DEFAULT_TEAM_CODES): TeamResult {
  const byUpper = new Map(knownCodes.map((c) => [c.toUpperCase(), c]));
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { teams: [], fixes: [] };
  if (trimmed === "หลายทีม") {
    return { teams: [], fixes: [], error: `"หลายทีม" ต้องระบุว่าทีมไหนบ้าง` };
  }

  const teams: string[] = [];
  const fixes: string[] = [];
  for (const rawToken of trimmed.split(",")) {
    const token = rawToken.trim();
    if (!token) continue;

    const supCode = byUpper.get("SUP");
    if (supCode !== undefined && SUP_ALIASES.has(token)) {
      if (token !== supCode) fixes.push(`ทีม "${token}" → ${supCode}`);
      teams.push(supCode);
      continue;
    }

    const code = byUpper.get(token.toUpperCase());
    if (code !== undefined) {
      if (code !== token) fixes.push(`ทีม "${token}" → ${code}`);
      teams.push(code);
      continue;
    }

    return { teams: [], fixes: [], error: `ไม่รู้จักทีม "${token}"` };
  }

  return { teams, fixes };
}

// ---------- ระยะสัญญา + มูลค่า ----------
export interface TermValueResult {
  /** ระยะตามช่องมูลค่า: "1 ปี" → 12 · "3 ปี" → 36 (สัญญาสั้น/Custom ตัดสินต่อใน importContracts · M30) */
  termMonths: 12 | 36 | null;
  valueTotal: number | null;
  error?: string;
}

function parseAmount(raw: string): number | null {
  const cleaned = (raw ?? "").trim().replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * อ่านระยะสัญญาจากว่ามูลค่าอยู่คอลัมน์ "1 ปี" หรือ "3 ปี" (SPEC §10)
 * - มีค่าช่องเดียว → term ตามช่องนั้น
 * - ไม่มีทั้งสองช่อง → error (ไม่มีมูลค่า)
 * - มีทั้งสองช่อง → error (กำกวม)
 */
export function resolveTermValue(
  value1y: string,
  value3y: string,
): TermValueResult {
  const v1 = parseAmount(value1y);
  const v3 = parseAmount(value3y);

  if (v1 === null && v3 === null) {
    return { termMonths: null, valueTotal: null, error: "ไม่มีมูลค่า" };
  }
  if (v1 !== null && v3 !== null) {
    return {
      termMonths: null,
      valueTotal: null,
      error: "มูลค่าอยู่ทั้งช่อง 1 ปี และ 3 ปี — เลือกช่องเดียว",
    };
  }
  return v1 !== null
    ? { termMonths: 12, valueTotal: v1 }
    : { termMonths: 36, valueTotal: v3 };
}

// ---------- จำนวนเดือน (M30) ----------
export interface TermMonthsResult {
  months: number | null;
  error?: string;
}

/**
 * คอลัมน์ "จำนวนเดือน" (ไม่บังคับ · DECISIONS 2.53): ว่าง → null · จำนวนเต็ม 1–36 → ค่านั้น
 * รับรูป "9" หรือ "9 เดือน" · อื่นๆ (0, 37, ทศนิยม, ตัวอักษร) → error
 */
export function parseTermMonths(raw: string): TermMonthsResult {
  const s = (raw ?? "").trim().replace(/\s*เดือน$/, "");
  if (!s) return { months: null };
  const n = /^\d+$/.test(s) ? Number(s) : Number.NaN;
  if (!isValidTermMonths(n)) {
    return { months: null, error: `จำนวนเดือน "${raw.trim()}" ไม่ถูกต้อง (ต้องเป็นจำนวนเต็ม 1–36)` };
  }
  return { months: n };
}

// ---------- ผู้ขาย → sale_name / am_name ----------
export interface SellerColumns {
  saleName: string | null;
  amName: string | null;
}

/**
 * แยกชื่อผู้ขายลงช่องตามตำแหน่ง (เหมือนหน้าเปิดงาน components/customers-new/savePayload.ts)
 * - ตำแหน่ง AM (= ตำแหน่ง "ต่อสัญญา") → am_name
 * - ตำแหน่งอื่นทั้งหมด (Sale · ผู้จัดการ · "ไม่พบชื่อ" · ว่าง) → sale_name (เจ้าของตอบ ต1–ต2 17 พ.ย. 2026)
 * - ไม่มีชื่อ → ว่างทั้ง 2 ช่อง
 * ⚠ ไม่อนุมาน New/Renew จากตำแหน่ง (เจ้าของไม่ได้สั่ง)
 */
export function sellerColumns(name: string, position: string): SellerColumns {
  const n = (name ?? "").trim();
  if (!n) return { saleName: null, amName: null };
  return (position ?? "").trim().toUpperCase() === "AM" ? { saleName: null, amName: n } : { saleName: n, amName: null };
}
