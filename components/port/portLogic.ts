/**
 * ตรรกะล้วน (pure) ของหน้า "ลงข้อมูล Port ต่างจังหวัด" (/admin/port · SPEC §6.5, §8 หน้า 9 · M40)
 *
 * Logic summary:
 *   * host กรอก 8 tier (S1…XL3) × (จำนวน, มูลค่า) ต่อสาขาต่างจังหวัด × เดือน → เขียน `monthly_branch_snapshots`
 *     (source = manual) ด้วย JWT ของผู้ใช้เท่านั้น · server (trigger M40) คำนวณ cust/vS/vM/vL/vXL/value ใหม่ทับค่าที่ส่ง
 *   * สูตรคำนวณ/ตรวจยอดอยู่ที่ `lib/dashboard/manualRow.ts` (import ใช้ ไม่คัดลอก) — ไฟล์นี้เติมเฉพาะส่วนหน้าจอ:
 *       - แปลงข้อความที่พิมพ์/วาง → ตัวเลข (ปัดมูลค่า 2 ตำแหน่ง · รวมเป็นสตางค์ให้ตรง numeric(14,2) ของ DB)
 *       - กฎ DECISIONS 5.11: ยอดจากรายงานต้องตรง ไม่ตรง = บันทึกไม่ได้ · กรอกไม่ครบคู่ = บันทึกไม่ได้
 *       - กฎ DECISIONS 2.85 Q1: ถ้าค่าล่าสุดก่อนหน้าเป็น legacy (มีแค่ยอดรวม ไม่มีมูลค่าราย tier) ปิด "ยืนยันใช้ค่าเดิม"
 *         และบังคับกรอกมูลค่าก่อนบันทึก (กัน Dashboard ของสาขาตกเป็น 0) · ต่อเนื่องจากแถว manual ยกค่ามาได้ (5.12a)
 *       - เดือนที่แถวเป็น legacy อยู่แล้ว = อ่านอย่างเดียว (DB ปฏิเสธ SN001)
 *       - แปลง error code ของ DB (SN001–SN004 · 23514 · 42501) เป็นข้อความไทย — ไม่แสดงข้อความดิบ
 */
import {
  buildManualRow,
  checkManualInput,
  checkReportTotals,
  checkTierBands,
  MANUAL_TIER_KEYS,
  type ManualTierInput,
  type ManualTierKey,
} from "@/lib/dashboard/manualRow";
import type { DashboardRow } from "@/lib/dashboard/types";
import { rulesForMonth } from "@/lib/rules/tier";
import type { TierRule } from "@/lib/rules/types";

export { MANUAL_TIER_KEYS };
export type { ManualTierKey };

// ---------------------------------------------------------------------------
// ตัวเลข
// ---------------------------------------------------------------------------

/** ปัดเป็น 2 ตำแหน่ง (ตรงกับ numeric(14,2)) — กัน 1.005 ถูกปัดลง */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
export function cents(x: number): number {
  return Math.round(round2(x) * 100);
}

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function fmt0(x: number): string {
  return nf0.format(x);
}
export function fmt2(x: number): string {
  return nf2.format(round2(x));
}
export function fmtSigned(x: number): string {
  const v = round2(x);
  return (v > 0 ? "+" : v < 0 ? "−" : "") + fmt2(Math.abs(v));
}

/** ข้อความ → ตัวเลข: ตัด , ช่องว่าง ฿ · "-" หรือว่าง = 0 · ผิดรูปแบบ = NaN */
export function parseNum(s: string | null | undefined): number {
  const t = String(s ?? "").replace(/[,\s฿ ]/g, "");
  if (t === "" || t === "-") return 0;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

// ---------------------------------------------------------------------------
// error ของ DB → ข้อความไทย (M40) · ห้ามส่ง error.message ดิบไปแสดง
// ---------------------------------------------------------------------------

export const PORT_ERROR_MESSAGES: Record<string, string> = {
  SN001: "แถวนี้ไม่ใช่ข้อมูลที่กรอกเอง (เป็นข้อมูลเก่าที่นำเข้ามา) จึงแก้ในหน้านี้ไม่ได้",
  SN002: "สาขานี้ไม่ใช่สาขาต่างจังหวัด หน้านี้ลงข้อมูลได้เฉพาะ 19 สาขาต่างจังหวัด",
  SN003: "ห้ามย้ายข้อมูลไปเดือนหรือสาขาอื่น",
  SN004: "เดือนที่เลือกไม่ถูกต้อง",
  "23514": "ข้อมูลไม่ผ่านเงื่อนไข (จำนวน/มูลค่าติดลบ, จำนวน 0 แต่มีมูลค่า หรือยอดไม่ตรงกับรายงาน) ตรวจตัวเลขอีกครั้ง",
  "42501": "บัญชีนี้ไม่มีสิทธิ์บันทึก — หน้านี้ใช้ได้เฉพาะ OM/PM",
};
const GENERIC_SAVE_ERROR = "บันทึกไม่สำเร็จ ลองอีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ";

export function portErrorMessage(code: string | null | undefined): string {
  return (code ? PORT_ERROR_MESSAGES[code] : undefined) ?? GENERIC_SAVE_ERROR;
}

// ---------------------------------------------------------------------------
// แถว snapshot จาก DB → สถานะของสาขา
// ---------------------------------------------------------------------------

export interface SnapRow {
  month_key: string;
  branch_id: string;
  source: "computed" | "legacy" | "manual";
  s1: number; s3: number; m1: number; m3: number; l1: number; l3: number; xl1: number; xl3: number;
  v_s1: number | string; v_s3: number | string; v_m1: number | string; v_m3: number | string;
  v_l1: number | string; v_l3: number | string; v_xl1: number | string; v_xl3: number | string;
  report_cust: number | null;
  report_value: number | string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
}

export const SNAP_COLUMNS =
  "month_key, branch_id, source, s1, s3, m1, m3, l1, l3, xl1, xl3, v_s1, v_s3, v_m1, v_m3, v_l1, v_l3, v_xl1, v_xl3, report_cust, report_value, confirmed_at, confirmed_by";

export function rowToInput(r: SnapRow): ManualTierInput {
  return {
    s1: Number(r.s1), s3: Number(r.s3), m1: Number(r.m1), m3: Number(r.m3),
    l1: Number(r.l1), l3: Number(r.l3), xl1: Number(r.xl1), xl3: Number(r.xl3),
    v_s1: Number(r.v_s1), v_s3: Number(r.v_s3), v_m1: Number(r.v_m1), v_m3: Number(r.v_m3),
    v_l1: Number(r.v_l1), v_l3: Number(r.v_l3), v_xl1: Number(r.v_xl1), v_xl3: Number(r.v_xl3),
  };
}

export function emptyInput(): ManualTierInput {
  return {
    s1: 0, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    v_s1: 0, v_s3: 0, v_m1: 0, v_m3: 0, v_l1: 0, v_l3: 0, v_xl1: 0, v_xl3: 0,
  };
}

/** ผลรวมของ 8 tier: ราย + มูลค่า (สตางค์) */
export function totalsOfInput(input: ManualTierInput): { n: number; cents: number } {
  let n = 0;
  let c = 0;
  for (const k of MANUAL_TIER_KEYS) {
    n += input[k];
    c += cents(input[`v_${k}`]);
  }
  return { n, cents: c };
}

export type BranchKind =
  /** เดือนนี้มีแถว manual แล้ว */
  | "saved"
  /** เดือนนี้ยังไม่มีแถว · ยกค่าจากแถว manual ก่อนหน้า (ยืนยันใช้ค่าเดิมได้) */
  | "carried"
  /** เดือนนี้ยังไม่มีแถว · ค่าก่อนหน้าเป็น legacy (มีแค่ยอดรวม) → ต้องกรอกเอง (2.85 Q1) */
  | "legacy-carry"
  /** ไม่มีข้อมูลก่อนหน้าเลย → ต้องกรอกเอง */
  | "empty"
  /** เดือนนี้มีแถวที่ไม่ใช่ manual (เช่น legacy) → อ่านอย่างเดียว */
  | "readonly";

export interface BranchState {
  kind: BranchKind;
  /** ค่าตั้งต้นของฟอร์ม */
  input: ManualTierInput;
  report: { cust: number; value: number } | null;
  /** แถว manual ที่ยืนยันแล้ว (confirmed_at ไม่ว่าง) */
  updated: boolean;
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** เดือนที่ยกค่ามา (เฉพาะ carried / legacy-carry) */
  from: string | null;
  /** ปุ่ม "ยืนยันใช้ค่าเดิม" แสดงได้ไหม — เฉพาะ carried (2.85 Q1) */
  canKeepSame: boolean;
  /** ต้องมีมูลค่าครบถ้วนก่อนบันทึก (legacy-carry / empty) */
  strictValues: boolean;
  /** มูลค่ารวมเดือนก่อน (สตางค์) ไว้เทียบส่วนต่าง · null = ไม่มีแถวเดือนก่อน */
  prevCents: number | null;
}

/** 'YYYY-MM' ก่อนหน้า 1 เดือน */
export function prevMonthKey(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * ตัดสินสถานะของสาขา จากแถวทั้งหมดของสาขานั้นที่ month_key ≤ เดือนที่เลือก
 * (ส่งเฉพาะเดือนที่จำเป็นมาก็พอ — ฟังก์ชันหาแถวล่าสุดก่อนเดือนเอง ไม่ใช่แค่เดือนก่อนหน้า)
 */
export function resolveBranchState(rows: readonly SnapRow[], month: string): BranchState {
  const current = rows.find((r) => r.month_key === month) ?? null;
  const earlier = rows.filter((r) => r.month_key < month).sort((a, b) => (a.month_key < b.month_key ? 1 : -1));
  const latest = earlier[0] ?? null;
  const prevRow = rows.find((r) => r.month_key === prevMonthKey(month)) ?? null;
  const prevCents = prevRow ? totalsOfInput(rowToInput(prevRow)).cents : null;

  if (current) {
    const input = rowToInput(current);
    const isManual = current.source === "manual";
    return {
      kind: isManual ? "saved" : "readonly",
      input,
      report:
        current.report_cust !== null && current.report_value !== null
          ? { cust: Number(current.report_cust), value: Number(current.report_value) }
          : null,
      updated: isManual && current.confirmed_at !== null,
      confirmedAt: isManual ? current.confirmed_at : null,
      confirmedBy: isManual ? current.confirmed_by : null,
      from: null,
      canKeepSame: false,
      strictValues: false,
      prevCents,
    };
  }

  const base = { report: null, updated: false, confirmedAt: null, confirmedBy: null, prevCents };
  if (latest && latest.source === "manual") {
    return { ...base, kind: "carried", input: rowToInput(latest), from: latest.month_key, canKeepSame: true, strictValues: false };
  }
  if (latest) {
    // legacy (หรือแหล่งอื่นที่ไม่ใช่ manual): มีแค่ยอดรวม ไม่มีมูลค่าราย tier → เริ่มฟอร์มว่าง ปิดยืนยันค่าเดิม
    return { ...base, kind: "legacy-carry", input: emptyInput(), from: latest.month_key, canKeepSame: false, strictValues: true };
  }
  return { ...base, kind: "empty", input: emptyInput(), from: null, canKeepSame: false, strictValues: true };
}

// ---------------------------------------------------------------------------
// ฟอร์ม (ข้อความที่พิมพ์) → ตัวเลข + ตรวจ
// ---------------------------------------------------------------------------

export interface TierDraft { count: string; value: string }
export interface Draft { tiers: TierDraft[]; reportCust: string; reportValue: string }

export function draftFromState(s: BranchState): Draft {
  return {
    tiers: MANUAL_TIER_KEYS.map((k) => ({
      count: String(s.input[k]),
      value: fmt2(s.input[`v_${k}`]),
    })),
    reportCust: s.report ? String(s.report.cust) : "",
    reportValue: s.report ? fmt2(s.report.value) : "",
  };
}

/** ข้อความที่ปรับรูปแบบแล้ว (ไว้เทียบว่าแก้อะไรไปบ้าง) — ผิดรูปแบบคืน "?ข้อความ" */
export function normStr(s: string): string {
  const v = parseNum(s);
  return Number.isNaN(v) ? `?${s}` : String(round2(v));
}

export function isDraftDirty(d: Draft, saved: Draft): boolean {
  for (let k = 0; k < MANUAL_TIER_KEYS.length; k++) {
    const a = d.tiers[k];
    const b = saved.tiers[k];
    if (!a || !b) return true;
    if (normStr(a.count) !== normStr(b.count)) return true;
    if (normStr(a.value) !== normStr(b.value)) return true;
  }
  const rep = (x: Draft) => [x.reportCust.trim() === "" ? "" : normStr(x.reportCust), x.reportValue.trim() === "" ? "" : normStr(x.reportValue)].join("|");
  return rep(d) !== rep(saved);
}

export type ReportState = "none" | "ok" | "partial" | "bad";

export interface EvalResult {
  /** ตัวเลขหลังปัด (ใช้ส่งจริง) — ช่องที่ผิดรูปแบบเป็น 0 */
  input: ManualTierInput;
  row: DashboardRow | null;
  /** ข้อความแยกรายแถว tier (index ตาม MANUAL_TIER_KEYS) */
  rowErrors: string[];
  rowWarns: string[];
  /** ข้อความรวมที่บล็อกการบันทึก (รวมของรายแถวด้วย) */
  errors: string[];
  warnings: string[];
  total: { n: number; cents: number };
  report: { cust: number; value: number } | null;
  reportState: ReportState;
  /** เทียบกับรายงานแล้วตรง (เมื่อมีรายงาน) */
  match: boolean | null;
  dn: number;
  dCents: number;
  canSave: boolean;
}

export interface EvalContext {
  branchName: string;
  month: string;
  rules: TierRule[] | null;
  /** legacy-carry / empty: ต้องมีมูลค่าครบทุก tier ที่มีจำนวน */
  strictValues: boolean;
}

const TIER_LABELS = MANUAL_TIER_KEYS.map((k) => k.toUpperCase());

/** แจกข้อความที่ขึ้นต้น "S1: " ให้แถวของ tier นั้น */
function splitByTier(messages: readonly string[]): { perRow: string[]; rest: string[] } {
  const perRow = TIER_LABELS.map(() => "");
  const rest: string[] = [];
  for (const m of messages) {
    const idx = TIER_LABELS.findIndex((l) => m.startsWith(`${l}: `));
    if (idx < 0) rest.push(m);
    else {
      const body = m.slice((TIER_LABELS[idx] ?? "").length + 2);
      const prev = perRow[idx];
      perRow[idx] = prev ? `${prev} · ${body}` : body;
    }
  }
  return { perRow, rest };
}

export function evalDraft(d: Draft, ctx: EvalContext): EvalResult {
  const n = MANUAL_TIER_KEYS.length;
  const rowErrors: string[] = Array(n).fill("");
  const rowWarns: string[] = Array(n).fill("");
  const errors: string[] = [];
  const warnings: string[] = [];
  const input = emptyInput();
  const parseBad: boolean[] = Array(n).fill(false);

  MANUAL_TIER_KEYS.forEach((key, k) => {
    const c = parseNum(d.tiers[k]?.count);
    const v = parseNum(d.tiers[k]?.value);
    let e = "";
    if (Number.isNaN(c) || c < 0 || !Number.isInteger(c)) e = "จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0";
    else if (c > 99999) e = "จำนวนเกินช่วงที่รับได้";
    else if (Number.isNaN(v) || v < 0) e = "มูลค่าต้องเป็นตัวเลขตั้งแต่ 0";
    else if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) e = "มูลค่าทศนิยมไม่เกิน 2 ตำแหน่ง";
    else if (v > 999_999_999) e = "มูลค่าเกินช่วงที่รับได้";
    if (e) {
      parseBad[k] = true;
      rowErrors[k] = e;
      return;
    }
    input[key] = c;
    input[`v_${key}`] = round2(v);
  });

  // ตรวจรายช่อง/ตรวจ band ด้วยตัวตรวจกลาง (ข้ามแถวที่ผิดรูปแบบอยู่แล้ว)
  const field = checkManualInput(input);
  const f = splitByTier(field.errors);
  const fw = splitByTier(field.warnings);
  let bandMsgs: string[] = [];
  if (ctx.rules) {
    try {
      bandMsgs = checkTierBands(input, ctx.rules, ctx.month);
    } catch {
      warnings.push("ตรวจเกณฑ์ Tier ไม่ได้ (ยังไม่มีชุดเกณฑ์ที่ใช้กับเดือนนี้) — ตรวจตัวเลขเองก่อนบันทึก");
    }
  }
  const bw = splitByTier(bandMsgs);

  MANUAL_TIER_KEYS.forEach((key, k) => {
    if (parseBad[k]) return;
    if (f.perRow[k]) rowErrors[k] = f.perRow[k];
    else if (ctx.strictValues && input[key] > 0 && input[`v_${key}`] === 0) {
      rowErrors[k] = `มี ${input[key]} ราย แต่ยังไม่ได้กรอกมูลค่า — กรอกมูลค่าจากรายงาน`;
    } else if (fw.perRow[k]) rowWarns[k] = fw.perRow[k];
    else if (bw.perRow[k]) rowWarns[k] = bw.perRow[k];
  });
  rowErrors.forEach((m, k) => {
    if (m) errors.push(`${TIER_LABELS[k]}: ${m}`);
  });
  errors.push(...f.rest);
  warnings.push(...fw.rest, ...bw.rest);

  // รวม
  const row = buildManualRow(ctx.branchName, input);
  const total = { n: row.cust, cents: cents(row.value) };
  if (ctx.strictValues && total.n === 0 && !parseBad.some(Boolean)) {
    errors.push("ยังไม่ได้กรอกข้อมูลสาขานี้ — กรอก 8 tier หรือวางตารางจากรายงาน");
  }

  // ยอดจากรายงาน (DECISIONS 5.11)
  const rc = d.reportCust.trim();
  const rv = d.reportValue.trim();
  let reportState: ReportState = "none";
  let report: { cust: number; value: number } | null = null;
  let match: boolean | null = null;
  let dn = 0;
  let dCents = 0;
  if (rc !== "" || rv !== "") {
    const pc = parseNum(rc);
    const pv = parseNum(rv);
    if (rc === "" || rv === "") {
      reportState = "partial";
      errors.push("ยอดจากรายงาน: กรอกให้ครบทั้งจำนวนและมูลค่า (หรือเว้นว่างทั้งคู่)");
    } else if (
      Number.isNaN(pc) || pc < 0 || !Number.isInteger(pc) ||
      Number.isNaN(pv) || pv < 0 || Math.abs(pv * 100 - Math.round(pv * 100)) > 1e-6
    ) {
      reportState = "bad";
      errors.push("ยอดจากรายงาน: จำนวนต้องเป็นจำนวนเต็ม มูลค่าเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่ง");
    } else {
      reportState = "ok";
      report = { cust: pc, value: round2(pv) };
      dn = total.n - pc;
      dCents = total.cents - cents(pv);
      match = dn === 0 && dCents === 0;
      const rep = checkReportTotals({ ...row, value: total.cents / 100 }, { reportCust: pc, reportValue: report.value });
      // ถ้ามีช่อง tier ผิดรูปแบบ ยังไม่ฟ้องยอดไม่ตรง (กัน error ซ้อนที่อ่านยาก)
      if (!rep.ok && !parseBad.some(Boolean)) {
        errors.push(...rep.errors.map((m) => `${m} — แก้ให้ตรงก่อนบันทึก`));
      }
    }
  }

  return {
    input, row, rowErrors, rowWarns, errors, warnings, total, report, reportState, match, dn, dCents,
    canSave: errors.length === 0,
  };
}

// ---------------------------------------------------------------------------
// ข้อมูลที่ส่งไป DB
// ---------------------------------------------------------------------------

export interface UpsertPayload {
  month_key: string;
  branch_id: string;
  source: "manual";
  s1: number; s3: number; m1: number; m3: number; l1: number; l3: number; xl1: number; xl3: number;
  v_s1: number; v_s3: number; v_m1: number; v_m3: number; v_l1: number; v_l3: number; v_xl1: number; v_xl3: number;
  cust: number;
  vS: number; vM: number; vL: number; vXL: number; value: number;
  report_cust: number | null;
  report_value: number | null;
  /** ค่าใดๆ ที่ไม่ว่าง = "อัปเดตแล้ว" · server ใส่เวลา/ผู้ยืนยันเองจริง (M40) */
  confirmed_at: string;
}

/** ประกอบแถวที่จะเขียน — ปัด 2 ตำแหน่งทุกช่องเงิน · cust/vS… ส่งไปเพื่อให้ตรง แต่ server คำนวณทับ */
export function buildUpsertPayload(args: {
  month: string;
  branchId: string;
  branchName: string;
  input: ManualTierInput;
  report: { cust: number; value: number } | null;
  nowIso: string;
}): UpsertPayload {
  const inp = { ...args.input };
  for (const k of MANUAL_TIER_KEYS) inp[`v_${k}`] = round2(inp[`v_${k}`]);
  const row = buildManualRow(args.branchName, inp);
  return {
    month_key: args.month,
    branch_id: args.branchId,
    source: "manual",
    ...inp,
    cust: row.cust,
    vS: round2(row.vS), vM: round2(row.vM), vL: round2(row.vL), vXL: round2(row.vXL),
    value: round2(row.value),
    report_cust: args.report ? args.report.cust : null,
    report_value: args.report ? round2(args.report.value) : null,
    confirmed_at: args.nowIso,
  };
}

// ---------------------------------------------------------------------------
// วางตารางจาก Excel
// ---------------------------------------------------------------------------

export interface PasteResult {
  tiers: Partial<Record<ManualTierKey, { n: number; v: number; swapped: boolean }>>;
  report: { n: number; v: number } | null;
  issues: string[];
}

/**
 * อ่านข้อความที่วางจาก Excel/เว็บ: คั่นด้วย tab (ไม่มี tab ใช้ช่องว่าง 2 ตัวขึ้นไป)
 * จับ tier จากเซลล์แรก เช่น "S1", "XL3 (>=300K)" · "-" = 0 · "รวมทั้งสิ้น" = ยอดรายงาน
 * ถ้าคอลัมน์จำนวน/มูลค่าสลับกัน (จำนวนมีทศนิยม แต่มูลค่าเป็นจำนวนเต็ม) สลับให้
 */
export function parsePaste(text: string): PasteResult {
  const res: PasteResult = { tiers: {}, report: null, issues: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/ /g, " ").trim();
    if (!line) continue;
    const cells = (line.includes("\t") ? line.split("\t") : line.split(/\s{2,}/))
      .map((c) => c.trim())
      .filter((c, idx) => c !== "" || idx > 0);
    const head = cells[0] ?? "";
    const nums: number[] = [];
    for (let c = 1; c < cells.length; c++) {
      const x = (cells[c] ?? "").replace(/[,\s฿]/g, "");
      if (/^-?\d+(\.\d+)?$/.test(x)) nums.push(Number(x));
      else if (x === "-") nums.push(0);
    }
    if (/^(รวมทั้งสิ้น|รวม|total|grand)/i.test(head)) {
      if (nums.length >= 2) res.report = { n: nums[0] ?? 0, v: nums[1] ?? 0 };
      else res.issues.push(`บรรทัด "${head}" ต้องมีตัวเลข 2 ค่า (จำนวน, มูลค่า)`);
      continue;
    }
    const m = /(^|[^A-Za-z])(XL|S|M|L)\s*([13])(?![0-9])/i.exec(head);
    if (!m) continue; // หัวตาราง/บรรทัดอื่น ข้าม
    const key = `${m[2]}${m[3]}`.toLowerCase() as ManualTierKey;
    if (nums.length < 2) {
      res.issues.push(`${key.toUpperCase()}: ต้องมีตัวเลข 2 ค่า (จำนวน, มูลค่า) พบ ${nums.length} ค่า`);
      continue;
    }
    let n = nums[0] ?? 0;
    let v = nums[1] ?? 0;
    let swapped = false;
    if (!Number.isInteger(n) && Number.isInteger(v)) {
      [n, v] = [v, n];
      swapped = true;
    }
    if (res.tiers[key]) res.issues.push(`${key.toUpperCase()}: พบซ้ำหลายบรรทัด ใช้บรรทัดหลังสุด`);
    res.tiers[key] = { n, v, swapped };
  }
  return res;
}

/** ใส่ผลที่อ่านได้ลงฟอร์ม — tier ที่ไม่พบคงค่าเดิม · มูลค่าปัด 2 ตำแหน่ง */
export function applyPasteToDraft(d: Draft, p: PasteResult): Draft {
  const tiers = d.tiers.map((t, k) => {
    const key = MANUAL_TIER_KEYS[k];
    const x = key ? p.tiers[key] : undefined;
    return x ? { count: String(x.n), value: fmt2(x.v) } : t;
  });
  return {
    tiers,
    reportCust: p.report ? String(p.report.n) : d.reportCust,
    reportValue: p.report ? fmt2(p.report.v) : d.reportValue,
  };
}

// ---------------------------------------------------------------------------
// สรุปรายสาขา (ตาราง / การ์ดสถิติ)
// ---------------------------------------------------------------------------

export interface TableRow {
  index: number;
  area: string;
  name: string;
  state: BranchState;
  totalN: number;
  totalCents: number;
  diffCents: number | null;
  bigDiff: boolean;
  /** ยอดรายงานตรงกับที่บันทึกไว้ไหม · null = ไม่ได้เทียบ */
  reportMatch: boolean | null;
}

export function toTableRow(index: number, area: string, name: string, state: BranchState): TableRow {
  const t = totalsOfInput(state.input);
  const diff = state.prevCents === null ? null : t.cents - state.prevCents;
  const reportMatch = state.report ? state.report.cust === t.n && cents(state.report.value) === t.cents : null;
  return {
    index, area, name, state, totalN: t.n, totalCents: t.cents, diffCents: diff,
    bigDiff: diff !== null && state.prevCents !== null && state.prevCents > 0 && Math.abs(diff) / state.prevCents > 0.1,
    reportMatch,
  };
}

export type StatusFilter = "all" | "pend" | "ok" | "big";

export function filterRows(rows: readonly TableRow[], q: string, zone: string, st: StatusFilter): TableRow[] {
  const query = q.trim();
  return rows.filter((r) => {
    if (query && !r.name.includes(query)) return false;
    if (zone !== "all" && r.area !== zone) return false;
    if (st === "pend" && r.state.updated) return false;
    if (st === "ok" && !r.state.updated) return false;
    if (st === "big" && !r.bigDiff) return false;
    return true;
  });
}

export function summarizeRows(rows: readonly TableRow[]): {
  updated: number; pending: number; totalN: number; totalCents: number; prevCents: number;
} {
  let updated = 0, totalN = 0, totalCents = 0, prevCents = 0;
  for (const r of rows) {
    if (r.state.updated) updated++;
    totalN += r.totalN;
    totalCents += r.totalCents;
    prevCents += r.state.prevCents ?? 0;
  }
  return { updated, pending: rows.length - updated, totalN, totalCents, prevCents };
}

/** ข้อความช่วย 2.85 Q1 */
export const LEGACY_CARRY_MESSAGE =
  "เดือนก่อนหน้าเป็นข้อมูลเก่าที่นำเข้ามา (มีแต่ยอดรวม ไม่มีมูลค่าแยกตาม tier) จึงยกค่ามาให้ไม่ได้ — กรอกจำนวนและมูลค่า 8 tier จากรายงานเอง (เกิดครั้งแรกครั้งเดียวต่อสาขา)";
export const EMPTY_CARRY_MESSAGE = "ยังไม่มีข้อมูลสาขานี้ในระบบ — กรอกจำนวนและมูลค่า 8 tier จากรายงานเอง";

// ---------------------------------------------------------------------------
// ข้อความช่วงมูลค่า (band) ต่อ tier — อ่านจาก tier_rules ของเดือนนั้นเท่านั้น (ห้าม hardcode)
// ---------------------------------------------------------------------------

export interface BandText { line1: string; line2: string }

/** ข้อความ band ของ 8 tier ตามลำดับ MANUAL_TIER_KEYS · ไม่มีชุดเกณฑ์ของเดือน = null */
export function tierBandTexts(rules: TierRule[] | null, month: string): BandText[] | null {
  if (!rules) return null;
  let sorted: TierRule[];
  try {
    sorted = rulesForMonth(rules, month);
  } catch {
    return null;
  }
  const band = (group: string, mult: number): string => {
    const i = sorted.findIndex((r) => r.tier === group);
    if (i < 0) return "–";
    const r = sorted[i];
    if (!r) return "–";
    const next = sorted[i + 1];
    if (i === 0 && next) return `ต่ำกว่า ${fmt0(round2(next.minAnnual * mult))}`;
    if (!next) return `ตั้งแต่ ${fmt0(round2(r.minAnnual * mult))}`;
    // ปลายช่วง = จุดเริ่มของ tier ถัดไป − 0.01 (ไม่ใช้ max เพื่อไม่ให้เกิดเลขแปลก)
    return `${fmt0(round2(r.minAnnual * mult))} – ${fmt0(round2(next.minAnnual * mult - 0.01))}`;
  };
  return MANUAL_TIER_KEYS.map((k) => {
    const group = k.slice(0, -1).toUpperCase();
    const three = k.endsWith("3");
    return {
      line1: `ปีละ ${band(group, 1)}`,
      line2: three ? `สัญญา 3 ปี · มูลค่าสัญญา ${band(group, 3)}` : "สัญญา 1 ปี",
    };
  });
}
