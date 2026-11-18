/**
 * ตรรกะ pure ของแท็บ "เกณฑ์ Tier" หน้าตั้งค่า (`/admin/settings`) — M20 / M25 (DECISIONS 2.31 · 2.49)
 *
 * Logic summary:
 *   * **ห้าม hardcode เกณฑ์** — ค่าที่โชว์/คำนวณมาจาก `tier_rules` ทุกครั้ง (ตัวอย่างตรวจสอบใช้ `tierOf` ของ lib/rules กับ "ร่างที่กำลังแก้")
 *     แม้ปุ่ม "คืนค่าเริ่มต้น" ก็คืนเป็น "ชุดตั้งต้น" (effective_month เก่าสุดใน tier_rules) ไม่ใช่เลขตายตัว
 *   * 1 ชุด = 4 แถว S/M/L/XL · แก้เฉพาะจุดเริ่มของ M, L, XL (S เริ่ม 0) · ปลายช่วง = จุดเริ่มถัดไป − 0.01 (ไม่มีช่องว่าง/ซ้อนทับ)
 *   * เดือนที่เลือกเริ่มใช้ได้: ไม่ก่อน (ก) เดือนปัจจุบัน (ข) เดือนเริ่มใช้ระบบ `go_live_month` (ค) เดือนถัดจากเดือนที่ปิดล่าสุด
 *     และต้องอยู่หลังชุดตั้งต้น — ตรงกับด่าน TR001/TR002/TR005 ใน `save_tier_rule_set` (DB ยังบังคับจริงอีกชั้น)
 *   * ค่าเงินเป็น JSON number (DB เช็ก jsonb_typeof = 'number') ทศนิยมไม่เกิน 2 ตำแหน่ง ห่างกันอย่างน้อย 0.02
 */
import { annualValueForTerm, tierOf, type Tier, type TierRule } from "@/lib/rules";

export const TIER_MONEY_MAX = 9_999_999_999.99;
export const REASON_MIN = 5;
export const REASON_MAX = 500;
export const CONFIRM_PHRASE = "ยืนยันแก้ไข";

/** ค่า 3 จุดที่แก้ได้ (บาท/ปี) — null = ยังกรอกไม่ถูกรูปแบบ */
export type TierDraft = { m: number | null; l: number | null; xl: number | null };
export type TierThresholds = { m: number; l: number; xl: number };
export type TierDraftErrors = Partial<Record<"m" | "l" | "xl", string>>;

/** แปลงข้อความที่พิมพ์ ("30,000" / "30000.5") เป็นตัวเลข — ไม่ใช่ตัวเลขล้วน = null */
export function parseMoney(raw: string): number | null {
  const s = raw.replace(/[,\s]/g, "");
  if (s === "" || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** รูปแบบแสดง 30,000 / 29,999.99 (ไม่แสดงทศนิยมถ้าเป็นจำนวนเต็ม) */
export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function twoDecimals(v: number): boolean {
  return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
}

export function validateTierDraft(d: TierDraft): TierDraftErrors {
  const errors: TierDraftErrors = {};
  const fields = [
    ["m", "M"],
    ["l", "L"],
    ["xl", "XL"],
  ] as const;
  for (const [k, label] of fields) {
    const v = d[k];
    if (v === null) errors[k] = `กรอกจุดเริ่ม Tier ${label} เป็นตัวเลข`;
    else if (v <= 0) errors[k] = "ต้องมากกว่า 0";
    else if (v > TIER_MONEY_MAX) errors[k] = "ค่ามากเกินไป";
    else if (!twoDecimals(v)) errors[k] = "ทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
  }
  if (d.m !== null && !errors.m && d.m < 0.02) errors.m = "จุดเริ่ม M ต้องไม่น้อยกว่า 0.02";
  if (d.m !== null && d.l !== null && !errors.m && !errors.l && d.l - d.m < 0.02 - 1e-9) {
    errors.l = "จุดเริ่ม L ต้องมากกว่า M (ห่างกันอย่างน้อย 0.02)";
  }
  if (d.l !== null && d.xl !== null && !errors.l && !errors.xl && d.xl - d.l < 0.02 - 1e-9) {
    errors.xl = "จุดเริ่ม XL ต้องมากกว่า L (ห่างกันอย่างน้อย 0.02)";
  }
  return errors;
}

export function isDraftValid(d: TierDraft): d is TierThresholds {
  return d.m !== null && d.l !== null && d.xl !== null && Object.keys(validateTierDraft(d)).length === 0;
}

/** ปลายช่วงของแต่ละ Tier = จุดเริ่มถัดไป − 0.01 (ปัดทศนิยม 2 ตำแหน่ง) */
export function rangeEnds(t: TierThresholds): { s: number; m: number; l: number } {
  const end = (v: number) => Math.round((v - 0.01) * 100) / 100;
  return { s: end(t.m), m: end(t.l), l: end(t.xl) };
}

export function sameThresholds(a: TierDraft, b: TierThresholds): boolean {
  return a.m === b.m && a.l === b.l && a.xl === b.xl;
}

// ---------------------------------------------------------------------------
// ชุดเกณฑ์จาก tier_rules
// ---------------------------------------------------------------------------

export type TierRuleDbRow = {
  tier: Tier;
  min_annual: number | string;
  effective_month: string;
  change_reason: string | null;
};

export type RuleSet = {
  /** 'YYYY-MM' */
  month: string;
  thresholds: TierThresholds;
  reason: string | null;
  /** ชุดตั้งต้น (effective_month เก่าสุด) — ลบ/ย้ายเดือนไม่ได้ */
  isBaseline: boolean;
};

/** รวมแถวเป็นชุด (4 แถวต่อเดือน) เรียงเก่า→ใหม่ · ชุดที่ไม่ครบ M/L/XL ถูกข้าม */
export function groupRuleSets(rows: readonly TierRuleDbRow[]): RuleSet[] {
  const byMonth = new Map<string, Map<Tier, number>>();
  const reasons = new Map<string, string | null>();
  for (const r of rows) {
    const month = r.effective_month.slice(0, 7);
    const set = byMonth.get(month) ?? new Map<Tier, number>();
    set.set(r.tier, Number(r.min_annual));
    byMonth.set(month, set);
    if (r.change_reason) reasons.set(month, r.change_reason);
  }
  const months = [...byMonth.keys()].sort();
  const out: RuleSet[] = [];
  months.forEach((month, i) => {
    const set = byMonth.get(month)!;
    const m = set.get("M");
    const l = set.get("L");
    const xl = set.get("XL");
    if (m === undefined || l === undefined || xl === undefined) return;
    out.push({ month, thresholds: { m, l, xl }, reason: reasons.get(month) ?? null, isBaseline: i === 0 });
  });
  return out;
}

/** ชุดที่ใช้กับเดือน `month` = ชุดที่เริ่มใช้ล่าสุดที่ไม่เกินเดือนนั้น (ไม่มี = null) */
export function setForMonth(sets: readonly RuleSet[], month: string): RuleSet | null {
  let picked: RuleSet | null = null;
  for (const s of sets) if (s.month <= month) picked = s;
  return picked;
}

export type RuleSetStatus = "current" | "upcoming" | "past";

export function statusOf(set: RuleSet, sets: readonly RuleSet[], currentMonth: string): RuleSetStatus {
  if (set.month > currentMonth) return "upcoming";
  return setForMonth(sets, currentMonth)?.month === set.month ? "current" : "past";
}

/** ช่วงเดือนที่ชุดนี้ใช้: จนถึงเดือนก่อนชุดถัดไป (null = ใช้เรื่อยไป) */
export function endMonthOf(set: RuleSet, sets: readonly RuleSet[]): string | null {
  const next = sets.find((s) => s.month > set.month);
  return next ? shiftMonthKey(next.month, -1) : null;
}

export function shiftMonthKey(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

/**
 * เดือนที่เลือกเริ่มใช้เกณฑ์ใหม่ได้ — เริ่มที่เดือนที่ "ช้าที่สุด" ของ (เดือนปัจจุบัน · go-live · เดือนหลังปิดล่าสุด · หลังชุดตั้งต้น)
 * แล้วต่อไปข้างหน้า `count` เดือน
 */
export function effectiveMonthOptions(args: {
  currentMonth: string;
  goLiveMonth: string | null;
  lastClosedMonth: string | null;
  baselineMonth: string | null;
  count?: number;
}): string[] {
  const floors = [args.currentMonth];
  if (args.goLiveMonth) floors.push(args.goLiveMonth);
  if (args.lastClosedMonth) floors.push(shiftMonthKey(args.lastClosedMonth, 1));
  if (args.baselineMonth) floors.push(shiftMonthKey(args.baselineMonth, 1));
  const start = floors.sort().at(-1)!;
  return Array.from({ length: args.count ?? 14 }, (_, i) => shiftMonthKey(start, i));
}

/** ข้อมูลที่ส่ง RPC `save_tier_rule_set(p)` — ค่าเงินเป็น number (DB เช็กชนิด) */
export function buildSavePayload(t: TierThresholds, month: string, reason: string) {
  return { effective_month: month, min_m: t.m, min_l: t.l, min_xl: t.xl, reason: reason.trim() };
}

export function validateSaveForm(args: {
  month: string;
  options: readonly string[];
  reason: string;
  confirm: string;
}): Partial<Record<"month" | "reason" | "confirm", string>> {
  const errors: Partial<Record<"month" | "reason" | "confirm", string>> = {};
  if (!args.options.includes(args.month)) errors.month = "เลือกเดือนที่ยังเปิดอยู่";
  const r = args.reason.trim();
  if (r.length < REASON_MIN) errors.reason = `ใส่เหตุผลอย่างน้อย ${REASON_MIN} ตัวอักษร`;
  else if (r.length > REASON_MAX) errors.reason = `เหตุผลยาวได้ไม่เกิน ${REASON_MAX} ตัวอักษร`;
  if (args.confirm.trim() !== CONFIRM_PHRASE) {
    errors.confirm = `พิมพ์คำว่า "${CONFIRM_PHRASE}" ให้ตรงก่อนจึงจะบันทึกได้`;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// ผลกระทบต่อสัญญา (RPC `preview_tier_rule_change` · M38 · DECISIONS 2.74)
// ---------------------------------------------------------------------------

export const TIER_ORDER: readonly Tier[] = ["S", "M", "L", "XL"];

/** 1 แถวจาก RPC: จำนวนสัญญาที่ย้ายจาก Tier เดิม → Tier ใหม่ (กลุ่มสี 1 = 1 ปี/Custom · 3 = 3 ปี) — ไม่มีชื่อลูกค้า */
export type ImpactRow = { from: Tier; to: Tier; termGroup: "1" | "3"; count: number };

function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIER_ORDER as readonly string[]).includes(v);
}

/** แปลงผล RPC เป็นแถวที่ปลอดภัย — รูปแบบแปลก (ไม่ใช่ array / tier ผิด / จำนวนติดลบ) = null (หน้าจอแจ้ง "คำนวณไม่ได้" ไม่เดา) */
export function parseImpactRows(data: unknown): ImpactRow[] | null {
  if (!Array.isArray(data)) return null;
  const out: ImpactRow[] = [];
  for (const r of data) {
    if (typeof r !== "object" || r === null) return null;
    const o = r as Record<string, unknown>;
    const count = Number(o.contract_count);
    if (
      !isTier(o.from_tier) ||
      !isTier(o.to_tier) ||
      (o.term_group !== "1" && o.term_group !== "3") ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      return null;
    }
    out.push({ from: o.from_tier, to: o.to_tier, termGroup: o.term_group, count });
  }
  return out;
}

export type ImpactTierLine = { tier: Tier; before: number; after: number; diff: number };
export type ImpactMove = { from: Tier; to: Tier; y1: number; y3: number; total: number };
export type ImpactSummary = {
  total: number;
  moved: number;
  perTier: ImpactTierLine[];
  /** เฉพาะคู่ที่ Tier เปลี่ยนจริง (from ≠ to) เรียง S→XL */
  moves: ImpactMove[];
};

/** จัดกลุ่มแถวผลกระทบ: ตารางก่อน/หลังต่อ Tier + รายการคู่ที่ย้าย (แยก 1 ปี/3 ปี) */
export function summarizeImpact(rows: readonly ImpactRow[]): ImpactSummary {
  const before = new Map<Tier, number>();
  const after = new Map<Tier, number>();
  const moveMap = new Map<string, ImpactMove>();
  let total = 0;
  let moved = 0;
  for (const r of rows) {
    total += r.count;
    before.set(r.from, (before.get(r.from) ?? 0) + r.count);
    after.set(r.to, (after.get(r.to) ?? 0) + r.count);
    if (r.from === r.to) continue;
    moved += r.count;
    const key = `${r.from}>${r.to}`;
    const m = moveMap.get(key) ?? { from: r.from, to: r.to, y1: 0, y3: 0, total: 0 };
    if (r.termGroup === "3") m.y3 += r.count;
    else m.y1 += r.count;
    m.total += r.count;
    moveMap.set(key, m);
  }
  const idx = (t: Tier) => TIER_ORDER.indexOf(t);
  return {
    total,
    moved,
    perTier: TIER_ORDER.map((tier) => {
      const b = before.get(tier) ?? 0;
      const a = after.get(tier) ?? 0;
      return { tier, before: b, after: a, diff: a - b };
    }),
    moves: [...moveMap.values()].sort((a, b) => idx(a.from) - idx(b.from) || idx(a.to) - idx(b.to)),
  };
}

// ---------------------------------------------------------------------------
// ตัวอย่างตรวจสอบ (คำนวณสดจากร่าง)
// ---------------------------------------------------------------------------

/** ร่างเกณฑ์ → TierRule[] ชุดเดียว (ไม่ใส่ effectiveMonth) ส่งเข้า `tierOf` ของ lib/rules */
export function rulesFromThresholds(t: TierThresholds): TierRule[] {
  return [
    { tier: "S", minAnnual: 0 },
    { tier: "M", minAnnual: t.m },
    { tier: "L", minAnnual: t.l },
    { tier: "XL", minAnnual: t.xl },
  ];
}

/** Tier + ปี (ป้าย 1 ปี/3 ปี) ของสัญญา `value` บาท ระยะ `termMonths` เดือน ตามร่างเกณฑ์ */
export function classify(
  value: number,
  termMonths: number,
  t: TierThresholds,
): { tier: Tier; annual: number } {
  const annual = annualValueForTerm(value, termMonths);
  return { tier: tierOf(annual, rulesFromThresholds(t)), annual };
}

/** ตัวอย่างสัญญา (ค่าสมมติ — เป็นข้อมูลเข้าของตัวอย่าง ไม่ใช่เกณฑ์) */
export const SAMPLE_CONTRACTS: readonly { value: number; termMonths: number }[] = [
  { value: 20_000, termMonths: 12 },
  { value: 50_000, termMonths: 36 },
  { value: 75_000, termMonths: 12 },
  { value: 150_000, termMonths: 12 },
  { value: 150_000, termMonths: 36 },
  { value: 500_000, termMonths: 36 },
];
