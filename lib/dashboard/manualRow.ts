/**
 * แถวต่างจังหวัด (`source = manual`) — SPEC §6.5
 *
 * ต่างจังหวัด 19 สาขายังไม่มีทะเบียนในระบบ host จึงกรอกตัวเลขเองรายสาขา × รายเดือน
 * จากรายงาน "สรุปมูลค่าลูกค้า แยก Size × ปี" ซึ่งมี 8 tier (S1/S3/M1/M3/L1/L3/XL1/XL3)
 * แต่ละ tier มี **จำนวน** และ **มูลค่า**
 *
 * ไฟล์นี้คือตัวคำนวณ/ตัวตรวจกลาง (pure function) ที่หน้าจอ 9 และฝั่งบันทึกเรียกใช้ร่วมกัน:
 * - `buildManualRow`         → คำนวณ cust / vS / vM / vL / vXL / value จาก 8 tier (ไม่ให้ผู้ใช้กรอกซ้ำ)
 * - `checkManualInput`       → ตรวจความสมเหตุสมผลรายช่อง
 * - `checkReportTotals`      → เทียบ "ยอดจากรายงาน" (ไม่ตรง = บันทึกไม่ได้ · ไม่กรอก = บันทึกได้แต่เตือน)
 * - `checkTierBands`         → เตือนเมื่อมูลค่าเฉลี่ยต่อรายหลุด band ของ tier (เกณฑ์จาก `tier_rules` เท่านั้น)
 * - `buildManualSnapshotRow` → รวมทั้งหมดไว้ในครั้งเดียว
 */
import { annualValue, tierOf } from "../rules/tier";
import type { Tier, TierRule } from "../rules/types";
import { BRANCHES } from "./branches";
import type { DashboardRow } from "./types";

/** 8 tier ตามรายงาน (เรียงตามลำดับในฟอร์ม) */
export const MANUAL_TIER_KEYS = [
  "s1", "s3", "m1", "m3", "l1", "l3", "xl1", "xl3",
] as const;

export type ManualTierKey = (typeof MANUAL_TIER_KEYS)[number];

/** จำนวนรายต่อ tier — ตรงกับคอลัมน์ `s1…xl3` ของ `monthly_branch_snapshots` */
export type ManualTierCounts = Record<ManualTierKey, number>;
/** มูลค่าต่อ tier — ตรงกับคอลัมน์ `v_s1…v_xl3` (v1.4) */
export type ManualTierValues = Record<`v_${ManualTierKey}`, number>;
export type ManualTierInput = ManualTierCounts & ManualTierValues;

/** ยอดจากรายงานที่ host กรอกไว้เทียบ (`report_cust`, `report_value`) — ไม่กรอกก็ได้ */
export interface ManualReportTotals {
  reportCust?: number | null;
  reportValue?: number | null;
}

export interface ManualCheckResult {
  /** `true` = บันทึกได้ (ไม่มี error) · คำเตือนไม่บล็อกการบันทึก */
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ManualRowResult extends ManualCheckResult {
  row: DashboardRow;
}

/**
 * ความคลาดเคลื่อนที่ยอมรับได้ตอนเทียบมูลค่า (บาท) — ครึ่งสตางค์
 * กันการบวกเลขทศนิยมของ JavaScript ทำให้ยอดที่ตรงกันจริงถูกตีว่าไม่ตรง
 */
export const MONEY_EPSILON = 0.005;

const BRANCH_BY_NAME = new Map(BRANCHES.map((b) => [b.branch, b]));

/** ป้ายชื่อ tier ที่แสดงให้ผู้ใช้เห็น เช่น `s1` → `S1` */
function label(key: ManualTierKey): string {
  return key.toUpperCase();
}

/** กลุ่ม tier ของคีย์ เช่น `xl3` → `XL` */
function tierGroup(key: ManualTierKey): Tier {
  return key.slice(0, -1).toUpperCase() as Tier;
}

/** จำนวนปีสัญญาของคีย์ เช่น `s3` → 3 */
function termYears(key: ManualTierKey): number {
  return key.endsWith("3") ? 3 : 1;
}

function countOf(input: ManualTierInput, key: ManualTierKey): number {
  return input[key];
}

function valueOf(input: ManualTierInput, key: ManualTierKey): number {
  return input[`v_${key}`];
}

/**
 * คำนวณแถว Dashboard 16 ฟิลด์จาก 8 tier (SPEC §6.5)
 * - `cust`  = ผลรวมจำนวนทั้ง 8
 * - `vS/vM/vL/vXL` = ผลรวมมูลค่า s1+s3 / m1+m3 / l1+l3 / xl1+xl3
 * - `value` = ผลรวมมูลค่าทั้ง 8
 *
 * throw เมื่อชื่อสาขาไม่อยู่ในรายชื่อ 43 สาขา หรือเป็นสาขาส่วนกลาง
 * (ส่วนกลางต้องมาจาก `computed` เท่านั้น — SPEC §6.5 บรรทัดสุดท้าย)
 */
export function buildManualRow(
  branchName: string,
  input: ManualTierInput,
): DashboardRow {
  const branch = BRANCH_BY_NAME.get(branchName);
  if (!branch) {
    throw new Error(
      `buildManualRow: สาขา "${branchName}" ไม่อยู่ในรายชื่อ 43 สาขา — ตรวจการสะกด`,
    );
  }
  if (branch.division !== "province") {
    throw new Error(
      `buildManualRow: สาขา "${branchName}" เป็นส่วนกลาง — ตัวเลขต้องมาจากทะเบียน (computed) ไม่ใช่การกรอกมือ`,
    );
  }

  const cust = MANUAL_TIER_KEYS.reduce((sum, k) => sum + countOf(input, k), 0);
  const vS = valueOf(input, "s1") + valueOf(input, "s3");
  const vM = valueOf(input, "m1") + valueOf(input, "m3");
  const vL = valueOf(input, "l1") + valueOf(input, "l3");
  const vXL = valueOf(input, "xl1") + valueOf(input, "xl3");

  return {
    area: branch.area,
    branch: branch.branch,
    s1: input.s1, s3: input.s3,
    m1: input.m1, m3: input.m3,
    l1: input.l1, l3: input.l3,
    xl1: input.xl1, xl3: input.xl3,
    cust,
    vS, vM, vL, vXL,
    value: vS + vM + vL + vXL,
  };
}

/**
 * ตรวจความสมเหตุสมผลรายช่อง (SPEC §6.5)
 * - error: จำนวนไม่ใช่จำนวนเต็ม ≥ 0 · มูลค่าไม่ใช่ตัวเลข ≥ 0 · จำนวน 0 แต่มีมูลค่า
 * - warning: มีจำนวนแต่มูลค่าเป็น 0 (อาจลืมกรอกมูลค่า — ไม่บล็อก)
 */
export function checkManualInput(input: ManualTierInput): ManualCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of MANUAL_TIER_KEYS) {
    const count = countOf(input, key);
    const value = valueOf(input, key);

    if (!Number.isInteger(count) || count < 0) {
      errors.push(`${label(key)}: จำนวนต้องเป็นจำนวนเต็ม 0 ขึ้นไป`);
    }
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${label(key)}: มูลค่าต้องเป็นตัวเลข 0 ขึ้นไป`);
    }
    if (count === 0 && Number.isFinite(value) && Math.abs(value) > MONEY_EPSILON) {
      errors.push(`${label(key)}: จำนวนเป็น 0 แต่มีมูลค่า — ตรวจว่าใส่ผิดช่องหรือไม่`);
    }
    if (count > 0 && Number.isFinite(value) && Math.abs(value) <= MONEY_EPSILON) {
      warnings.push(`${label(key)}: มีจำนวน ${count} ราย แต่มูลค่าเป็น 0`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * เทียบ "ยอดจากรายงาน" กับผลรวมที่คำนวณได้ (SPEC §6.5 · DECISIONS 5.11)
 * - กรอกแล้วไม่ตรง → error (บันทึกไม่ได้)
 * - ไม่กรอก → warning "ยังไม่ได้เทียบยอด" (บันทึกได้)
 */
export function checkReportTotals(
  row: DashboardRow,
  totals: ManualReportTotals = {},
): ManualCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { reportCust, reportValue } = totals;

  if (reportCust === undefined || reportCust === null) {
    warnings.push("ยังไม่ได้เทียบยอดจำนวนรายกับรายงาน");
  } else if (reportCust !== row.cust) {
    errors.push(
      `จำนวนรายไม่ตรงรายงาน: คำนวณได้ ${row.cust} · รายงาน ${reportCust}`,
    );
  }

  if (reportValue === undefined || reportValue === null) {
    warnings.push("ยังไม่ได้เทียบยอดมูลค่ากับรายงาน");
  } else if (Math.abs(reportValue - row.value) > MONEY_EPSILON) {
    errors.push(
      `มูลค่ารวมไม่ตรงรายงาน: คำนวณได้ ${row.value} · รายงาน ${reportValue}`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * เตือนเมื่อมูลค่าเฉลี่ยต่อราย (คิดเป็นต่อปี) หลุด band ของ tier นั้น — จับกรณีใส่ผิดช่อง
 * **เกณฑ์มาจาก `tier_rules` เท่านั้น ห้าม hardcode** (CLAUDE.md กฎ 3)
 * เตือนอย่างเดียว ไม่บล็อกการบันทึก (SPEC §6.5)
 */
export function checkTierBands(
  input: ManualTierInput,
  rules: TierRule[],
): string[] {
  const warnings: string[] = [];
  for (const key of MANUAL_TIER_KEYS) {
    const count = countOf(input, key);
    const value = valueOf(input, key);
    if (!Number.isInteger(count) || count <= 0) continue;
    if (!Number.isFinite(value) || value <= 0) continue;

    const annual = annualValue(value / count, termYears(key));
    const actual = tierOf(annual, rules);
    const expected = tierGroup(key);
    if (actual !== expected) {
      warnings.push(
        `${label(key)}: มูลค่าเฉลี่ยต่อรายต่อปี ${Math.round(annual).toLocaleString("en-US")} บาท เข้าเกณฑ์ ${actual} ไม่ใช่ ${expected} — ตรวจว่าใส่ผิดช่องหรือไม่`,
      );
    }
  }
  return warnings;
}

/**
 * คำนวณแถว + ตรวจทุกอย่างในครั้งเดียว (ตัวที่หน้าจอ/ฝั่งบันทึกเรียกใช้)
 * ส่ง `rules` มาด้วยถึงจะตรวจ band ของ tier (ไม่ส่ง = ข้ามการตรวจนั้น)
 */
export function buildManualSnapshotRow(
  branchName: string,
  input: ManualTierInput,
  totals: ManualReportTotals = {},
  rules?: TierRule[],
): ManualRowResult {
  const row = buildManualRow(branchName, input);
  const field = checkManualInput(input);
  const report = checkReportTotals(row, totals);
  const bandWarnings = rules ? checkTierBands(input, rules) : [];

  const errors = [...field.errors, ...report.errors];
  const warnings = [...field.warnings, ...report.warnings, ...bandWarnings];

  return { row, ok: errors.length === 0, errors, warnings };
}
