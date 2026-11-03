import type { TermYears } from "../rules/types";

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

/** รายชื่อทีมจริง A–O, Z, Sup (mockup TEAMLIST) */
const TEAM_SET = new Set([
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
  "Z", "Sup",
]);

/** คำที่หมายถึงหัวหน้างาน → Sup */
const SUP_ALIASES = new Set(["sup", "SUP", "Sup", "หนง.", "หน."]);

/**
 * normalize ช่องทีม — รองรับหลายทีมคั่นด้วย ,
 * - sup/หนง. → Sup · ตัวเล็ก a → A
 * - "หลายทีม" (ไม่ระบุว่าทีมไหน) → error
 * - ทีมไม่รู้จัก → error
 * - ว่าง → teams:[] (ยังไม่นัด ไม่ใช่ error)
 */
export function normalizeTeams(raw: string): TeamResult {
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

    if (SUP_ALIASES.has(token)) {
      if (token !== "Sup") fixes.push(`ทีม "${token}" → Sup`);
      teams.push("Sup");
      continue;
    }

    const upper = token.toUpperCase();
    if (TEAM_SET.has(upper)) {
      if (upper !== token) fixes.push(`ทีม "${token}" → ${upper}`);
      teams.push(upper);
      continue;
    }

    return { teams: [], fixes: [], error: `ไม่รู้จักทีม "${token}"` };
  }

  return { teams, fixes };
}

// ---------- ระยะสัญญา + มูลค่า ----------
export interface TermValueResult {
  termYears: TermYears | null;
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
    return { termYears: null, valueTotal: null, error: "ไม่มีมูลค่า" };
  }
  if (v1 !== null && v3 !== null) {
    return {
      termYears: null,
      valueTotal: null,
      error: "มูลค่าอยู่ทั้งช่อง 1 ปี และ 3 ปี — เลือกช่องเดียว",
    };
  }
  return v1 !== null
    ? { termYears: 1, valueTotal: v1 }
    : { termYears: 3, valueTotal: v3 };
}
