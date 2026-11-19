/**
 * เทียบ old/new (jsonb) ของแถว audit_log ทีละช่อง แล้วเขียนเป็นภาษาคน (pure function — ทดสอบได้)
 *
 * Logic summary:
 *   * update  : แสดงเฉพาะช่องที่ค่าเปลี่ยนจริง (ตัด NOISE_KEYS) เช่น "มูลค่า 50,000 → 55,000"
 *   * insert  : "เพิ่ม<ชนิดข้อมูล> <ชื่อ>" · รายละเอียดแสดงค่าใหม่ทุกช่อง
 *   * delete  : "ลบ<ชนิดข้อมูล> <ชื่อ>" · รายละเอียดแสดงค่าเดิมทุกช่อง
 *   * ค่า UUID: แปลงเป็นชื่อสาขา/ชื่อคนถ้ารู้จัก · ไม่รู้จัก = ไม่โชว์ค่า (`opaque`) บอกแค่ว่า "เปลี่ยน<ช่อง>"
 *   * รูปแบบค่าตัดสินจากหน้าตาของค่า (วันที่ / เดือน / เวลา / ตัวเลข / boolean) ไม่ใช่จากชื่อช่อง → ช่องใหม่ในอนาคตไม่พัง
 *   * ⚠ ข้อมูลลูกค้าอยู่ในค่าเหล่านี้ — ฟังก์ชันที่นี่ไม่ log/ไม่ส่งออกนอกเครื่อง
 */
import { fieldLabel, NOISE_KEYS, tableNoun, valueLabel } from "./historyLabels";
import type { AuditRow } from "./historyTypes";

export interface FormatCtx {
  branchName: (id: string) => string | null;
  personName: (id: string) => string | null;
}

export interface FieldChange {
  key: string;
  label: string;
  /** null = ไม่มีค่า (ใช้กับ insert/delete) · "" ไม่ใช้ */
  before: string | null;
  after: string | null;
  /** ค่าเป็นรหัสอ้างอิงที่แปลงชื่อไม่ได้ — ไม่แสดงค่า */
  opaque: boolean;
}

export interface Described {
  /** ประโยคสั้นหนึ่งบรรทัด */
  headline: string;
  /** ชื่อของแถว (เลขสัญญา / ชื่อลูกค้า / รหัสสถานี …) หรือ null */
  entity: string | null;
  changes: FieldChange[];
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const TIME_RE = /^(\d{2}):(\d{2})(:\d{2})?$/;
const MAX_TEXT = 80;
const MAX_HEADLINE_CHANGES = 3;

/** วัน-เวลาไทย เช่น "5 พ.ย. 14:20" (ปีเป็น ค.ศ. ตาม mockup เมื่อ withYear) */
export function formatThaiDateTime(iso: string, withYear = false): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const p = bangkokParts(ms);
  return `${p.day} ${TH_MONTHS[p.month - 1]}${withYear ? ` ${p.year}` : ""} ${p.hh}:${p.mm}`;
}

export function formatThaiDate(ymd: string): string {
  const m = DATE_RE.exec(ymd);
  if (!m) return ymd;
  return `${Number(m[3])} ${TH_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function formatMonthKey(ym: string): string {
  const m = MONTH_RE.exec(ym);
  if (!m) return ym;
  return `${TH_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** วันที่ไทยของเวลา (YYYY-MM-DD) */
export function bangkokDay(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const p = bangkokParts(ms);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function bangkokParts(ms: number): { year: number; month: number; day: number; hh: string; mm: string } {
  // ไทยคือ UTC+7 ตลอดปี (ไม่มี DST) — บวก 7 ชม. แล้วอ่านเป็น UTC ได้โดยไม่พึ่ง Intl/ICU
  const d = new Date(ms + 7 * 3600_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hh: String(d.getUTCHours()).padStart(2, "0"),
    mm: String(d.getUTCMinutes()).padStart(2, "0"),
  };
}

function isUuidKey(key: string): boolean {
  return key === "id" || key.endsWith("_id") || key.endsWith("_by") || key === "user_id";
}

/** แปลงค่าเป็นข้อความ · null = ไม่แสดง (opaque) */
export function formatValue(key: string, v: unknown, ctx: FormatCtx): { text: string; opaque: boolean } {
  if (v === null || v === undefined) return { text: "ว่าง", opaque: false };
  if (typeof v === "boolean") return { text: v ? "ใช่" : "ไม่ใช่", opaque: false };
  if (typeof v === "number") {
    return { text: v.toLocaleString("en-US", { maximumFractionDigits: 2 }), opaque: false };
  }
  if (Array.isArray(v)) {
    return { text: v.map((x) => formatValue(key, x, ctx).text).join(", "), opaque: false };
  }
  if (typeof v === "object") return { text: "(ข้อมูลหลายช่อง)", opaque: false };

  const s = String(v);
  if (UUID_RE.test(s) || (isUuidKey(key) && UUID_RE.test(s))) {
    const name = key === "branch_id" ? ctx.branchName(s) : key.endsWith("_by") || key === "user_id" ? ctx.personName(s) : null;
    return name ? { text: name, opaque: false } : { text: "", opaque: true };
  }
  if (TIMESTAMP_RE.test(s)) return { text: formatThaiDateTime(s, true), opaque: false };
  if (DATE_RE.test(s)) return { text: formatThaiDate(s), opaque: false };
  if (MONTH_RE.test(s)) return { text: formatMonthKey(s), opaque: false };
  const t = TIME_RE.exec(s);
  if (t) return { text: `${t[1]}:${t[2]}`, opaque: false };
  if (s === "") return { text: "(ข้อความว่าง)", opaque: false };
  const label = valueLabel(s);
  return { text: label.length > MAX_TEXT ? `${label.slice(0, MAX_TEXT)}…` : label, opaque: false };
}

function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** ช่องที่ค่าเปลี่ยน (update) — ตัดช่องที่ระบบประทับเอง */
export function diffRecord(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
  ctx: FormatCtx,
): FieldChange[] {
  const o = oldData ?? {};
  const n = newData ?? {};
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => !NOISE_KEYS.has(k));
  const out: FieldChange[] = [];
  for (const key of keys) {
    if (equalValue(o[key], n[key])) continue;
    const b = formatValue(key, o[key], ctx);
    const a = formatValue(key, n[key], ctx);
    out.push({ key, label: fieldLabel(key), before: b.text, after: a.text, opaque: b.opaque || a.opaque });
  }
  return out;
}

/** ทุกช่องของแถวเดียว (insert = ค่าใหม่ · delete = ค่าเดิม) ข้ามช่องว่าง */
export function snapshotRecord(rec: Record<string, unknown> | null, side: "before" | "after", ctx: FormatCtx): FieldChange[] {
  if (!rec) return [];
  const out: FieldChange[] = [];
  for (const [key, v] of Object.entries(rec)) {
    if (NOISE_KEYS.has(key) || v === null || v === undefined) continue;
    const f = formatValue(key, v, ctx);
    out.push({
      key,
      label: fieldLabel(key),
      before: side === "before" ? f.text : null,
      after: side === "after" ? f.text : null,
      opaque: f.opaque,
    });
  }
  return out;
}

/** ชื่อของแถว เพื่อให้รู้ว่าแก้อันไหน */
export function entityName(table: string, rec: Record<string, unknown> | null, ctx: FormatCtx): string | null {
  if (!rec) return null;
  const str = (k: string): string | null => {
    const v = rec[k];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  switch (table) {
    case "contracts":
      return str("contract_no");
    case "customers":
      return str("name");
    case "stations": {
      const label = str("point_label") ?? str("code");
      const no = typeof rec.station_no === "number" ? String(rec.station_no) : null;
      const type = str("type");
      return [type, label ?? no].filter(Boolean).join("-") || null;
    }
    case "contract_files":
      return str("file_name") ?? str("name");
    case "teams":
      return str("name") ?? str("code");
    case "profiles":
      return str("display_name") ?? str("username");
    case "visits": {
      const d = str("visit_date");
      return d ? formatThaiDate(d) : null;
    }
    case "monthly_branch_snapshots": {
      const b = str("branch_id");
      const bn = b ? ctx.branchName(b) : null;
      const mk = str("month_key");
      return [bn, mk ? formatMonthKey(mk) : null].filter(Boolean).join(" · ") || null;
    }
    case "month_closures":
    case "month_closure_overrides": {
      const mk = str("month_key");
      return mk ? formatMonthKey(mk) : null;
    }
    default:
      return null;
  }
}

/** "มูลค่า 50,000 → 55,000" (insert/delete: "ชื่อช่อง: ค่า") */
export function changePhrase(c: FieldChange): string {
  if (c.opaque) return `เปลี่ยน${c.label}`;
  if (c.before === null) return `${c.label}: ${c.after}`;
  if (c.after === null) return `${c.label}: ${c.before}`;
  return `${c.label} ${c.before} → ${c.after}`;
}

/** สรุปแถว audit เป็นประโยค + รายการช่อง */
export function describeAudit(row: AuditRow, ctx: FormatCtx): Described {
  const noun = tableNoun(row.tableName);
  const rec = row.action === "delete" ? row.oldData : (row.newData ?? row.oldData);
  const entity = entityName(row.tableName, rec, ctx);

  if (row.action === "insert") {
    return {
      headline: `เพิ่ม${noun}${entity ? ` ${entity}` : ""}`,
      entity,
      changes: snapshotRecord(row.newData, "after", ctx),
    };
  }
  if (row.action === "delete") {
    return {
      headline: `ลบ${noun}${entity ? ` ${entity}` : ""}`,
      entity,
      changes: snapshotRecord(row.oldData, "before", ctx),
    };
  }

  const changes = diffRecord(row.oldData, row.newData, ctx);
  if (changes.length === 0) {
    return { headline: `แก้${noun} (ระบบปรับค่าภายใน ไม่มีช่องที่ผู้ใช้เห็นเปลี่ยน)`, entity, changes };
  }
  const shown = changes.slice(0, MAX_HEADLINE_CHANGES).map(changePhrase);
  const rest = changes.length - shown.length;
  return {
    headline: shown.join(" · ") + (rest > 0 ? ` · และอีก ${rest} ช่อง` : ""),
    entity,
    changes,
  };
}
