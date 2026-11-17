/**
 * แปลง dashboard_data.json เดิม (Dashboard ก่อนมีระบบ) → แถว `monthly_branch_snapshots` แบบ `source = 'legacy'`
 * (DECISIONS 2.72 ก · 5.12a · SPEC §9.1) — pure function ทั้งไฟล์ ไม่แตะฐานข้อมูล
 *
 * Logic summary:
 *   - เดือน: key `MMM.YY` → `YYYY-MM` (รูปแบบเดียวกับ month_key ที่ sync อ่าน — sources.ts เทียบ string กับ go-live
 *     ถ้าเก็บ `SEP.26` ไว้ แถว legacy จะหายทั้งหมด)
 *   - นำเข้าเฉพาะเดือน **ก่อน** go-live (`go_live_month()` ส่งมาจากผู้เรียก ห้าม hardcode) · เดือนที่เหลือ = `skippedKeys`
 *     เดือนที่นำเข้าต้องต่อเนื่องจนถึงเดือนก่อน go-live พอดี (ขาดเดือนไหน = throw)
 *   - สาขา: จับคู่ด้วย **ชื่อสาขาเท่านั้น** (สะกดตรงทุกตัวอักษรกับรายชื่อ 43 สาขา · CLAUDE.md กฎ 4)
 *     ช่อง `area` ในไฟล์ไม่ใช้ — ใช้เขตปัจจุบันเสมอ (กฎ "ใช้เขตปัจจุบัน") แต่จดแถวที่เขตในไฟล์ต่างไว้ใน `areaDifferences`
 *   - เงิน: คอลัมน์ DB เป็น numeric(14,2) → แปลงเป็นสตางค์ (จำนวนเต็ม) ก่อน แล้วค่อยหาร 100
 *     เศษ float จากการบวก (เช่น 1600595.4100000001) ถูกตัดทิ้งโดยค่าไม่เปลี่ยน · มีหลักที่ 3 จริง = throw ไม่ปัดเงียบๆ
 *   - ตรวจความถูกต้องทุกแถว (ครบ 43 สาขา/เดือน · ไม่ซ้ำ · จำนวนเป็นจำนวนเต็ม ≥ 0 · cust = ผลรวม 8 tier ·
 *     value = vS+vM+vL+vXL) — เจอผิดแม้แถวเดียว = throw ทั้งไฟล์ (ไม่นำเข้าบางส่วน)
 *   - ไฟล์เดิมไม่มีมูลค่าราย 8 tier (`v_s1…v_xl3`) และ `value_annual` → **ไม่ส่งค่า** ให้ DB ใช้ default 0
 *     (0 ในแถว legacy = "ไม่มีข้อมูล" ไม่ใช่ศูนย์จริง — ดูรายงาน docs/legacy-snapshots-import.md)
 */
import { BRANCHES, BRANCH_COUNT, type Branch } from "../dashboard/branches";
import type { StoredSnapshotRow } from "../dashboard/sources";

const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ช่องจำนวน (จำนวนเต็ม) ตามลำดับ SPEC §9.1 */
export const COUNT_FIELDS = ["s1", "s3", "m1", "m3", "l1", "l3", "xl1", "xl3", "cust"] as const;
/** ช่องเงิน (numeric(14,2)) */
export const MONEY_FIELDS = ["vS", "vM", "vL", "vXL", "value"] as const;
const TIER_COUNT_FIELDS = COUNT_FIELDS.slice(0, 8);

/** แถว legacy 1 สาขา 1 เดือน — รูปเดียวกับที่ sync อ่านจาก DB (`StoredSnapshotRow`) */
export interface LegacySnapshotRow extends StoredSnapshotRow {
  source: "legacy";
}

export interface AreaDifference {
  month: string;
  branch: string;
  fileArea: string;
  currentArea: string;
}

export interface LegacyConversion {
  /** แถวที่จะนำเข้า เรียงตามเดือน แล้วตามลำดับสาขามาตรฐาน */
  rows: LegacySnapshotRow[];
  /** เดือนที่นำเข้า `YYYY-MM` เรียงเก่า→ใหม่ */
  months: string[];
  /** key เดือนในไฟล์ที่ไม่นำเข้า (go-live ขึ้นไป) */
  skippedKeys: string[];
  /** แถวที่ `area` ในไฟล์ไม่ตรงเขตปัจจุบัน (นำเข้าด้วยเขตปัจจุบัน) */
  areaDifferences: AreaDifference[];
}

export interface ConvertOptions {
  /** เดือนแรกที่ใช้ระบบ `YYYY-MM` (จาก `go_live_month()`) */
  goLiveMonth: string;
}

/** `SEP.26` → `2026-09` (กลับด้านของ lib/rules/monthKey) · ผิดรูปแบบ = throw */
export function parseDashboardMonthKey(key: string): string {
  const m = /^([A-Z]{3})\.(\d{2})$/.exec(key);
  const idx = m ? MONTH_NAMES.indexOf(m[1] as (typeof MONTH_NAMES)[number]) : -1;
  if (!m || idx < 0) {
    throw new Error(`legacy: key เดือน "${key}" ไม่ใช่รูปแบบ MMM.YY`);
  }
  return `20${m[2]}-${String(idx + 1).padStart(2, "0")}`;
}

/**
 * บาท → สตางค์ (จำนวนเต็ม) · ตัดเศษ float ที่ต่ำกว่า 0.001 สตางค์ทิ้ง
 * throw เมื่อ: ไม่ใช่ตัวเลข, ติดลบ, มีทศนิยมหลักที่ 3 ขึ้นไปจริง
 */
export function toCents(baht: number): number {
  if (typeof baht !== "number" || !Number.isFinite(baht) || baht < 0) {
    throw new Error(`legacy: ค่าเงิน ${String(baht)} ไม่ถูกต้อง`);
  }
  const raw = baht * 100;
  const cents = Math.round(raw);
  if (Math.abs(raw - cents) > 1e-3) {
    throw new Error(`legacy: ค่าเงิน ${baht} มีทศนิยมเกิน 2 ตำแหน่ง`);
  }
  return cents;
}

function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

const BRANCH_BY_NAME: ReadonlyMap<string, Branch> = new Map(BRANCHES.map((b) => [b.branch, b]));
const BRANCH_ORDER: ReadonlyMap<string, number> = new Map(BRANCHES.map((b, i) => [b.branch, i]));

/** ตรวจ + แปลงแถวของ 1 เดือน · ปัญหาทั้งหมดใส่ `issues` (ไม่ throw ทีละแถว เพื่อรายงานครบในครั้งเดียว) */
function convertMonth(
  key: string,
  month: string,
  rawRows: unknown,
  issues: string[],
  areaDifferences: AreaDifference[],
): LegacySnapshotRow[] {
  if (!Array.isArray(rawRows)) {
    issues.push(`${key}: ไม่ใช่รายการแถว`);
    return [];
  }
  const out: LegacySnapshotRow[] = [];
  const seen = new Set<string>();

  rawRows.forEach((raw: unknown, i) => {
    const where = `${key} แถว ${i + 1}`;
    if (typeof raw !== "object" || raw === null) {
      issues.push(`${where}: ไม่ใช่ object`);
      return;
    }
    const r = raw as Record<string, unknown>;
    const name = r.branch;
    const branch = typeof name === "string" ? BRANCH_BY_NAME.get(name) : undefined;
    if (!branch) {
      issues.push(`${where}: สาขา "${String(name)}" ไม่อยู่ในรายชื่อ 43 สาขา (ต้องสะกดตรงทุกตัวอักษร)`);
      return;
    }
    if (seen.has(branch.branch)) {
      issues.push(`${where}: สาขา "${branch.branch}" ซ้ำในเดือนเดียวกัน`);
      return;
    }
    seen.add(branch.branch);

    const counts = {} as Record<(typeof COUNT_FIELDS)[number], number>;
    for (const f of COUNT_FIELDS) {
      const v = r[f];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        issues.push(`${where} (${branch.branch}): ${f} = ${JSON.stringify(v)} ต้องเป็นจำนวนเต็ม ≥ 0`);
        return;
      }
      counts[f] = v;
    }
    const cents = {} as Record<(typeof MONEY_FIELDS)[number], number>;
    for (const f of MONEY_FIELDS) {
      try {
        cents[f] = toCents(r[f] as number);
      } catch {
        issues.push(`${where} (${branch.branch}): ${f} = ${JSON.stringify(r[f])} ไม่ใช่ค่าเงินที่ถูกต้อง`);
        return;
      }
    }

    const tierSum = TIER_COUNT_FIELDS.reduce((s, f) => s + counts[f], 0);
    if (tierSum !== counts.cust) {
      issues.push(`${where} (${branch.branch}): cust ${counts.cust} ≠ ผลรวม 8 tier ${tierSum}`);
    }
    // ยอมต่างได้ 1 สตางค์ = ระดับเศษปัดของต้นทาง (Excel) · เกินนั้นถือว่าข้อมูลไม่สอดคล้อง
    const groupSum = cents.vS + cents.vM + cents.vL + cents.vXL;
    if (Math.abs(groupSum - cents.value) > 1) {
      issues.push(
        `${where} (${branch.branch}): value ${cents.value / 100} ≠ vS+vM+vL+vXL ${groupSum / 100}`,
      );
    }

    if (r.area !== branch.area) {
      areaDifferences.push({
        month,
        branch: branch.branch,
        fileArea: String(r.area),
        currentArea: branch.area,
      });
    }

    out.push({
      month,
      source: "legacy",
      area: branch.area,
      branch: branch.branch,
      ...counts,
      vS: cents.vS / 100,
      vM: cents.vM / 100,
      vL: cents.vL / 100,
      vXL: cents.vXL / 100,
      value: cents.value / 100,
    });
  });

  const missing = BRANCHES.filter((b) => !seen.has(b.branch)).map((b) => b.branch);
  if (missing.length > 0 && rawRows.length <= BRANCH_COUNT) {
    issues.push(`${key}: ขาด ${missing.length} สาขา (${missing.join(", ")})`);
  }
  if (rawRows.length !== BRANCH_COUNT) {
    issues.push(`${key}: มี ${rawRows.length} แถว (ต้องครบ ${BRANCH_COUNT} สาขา)`);
  }

  out.sort((a, b) => BRANCH_ORDER.get(a.branch)! - BRANCH_ORDER.get(b.branch)!);
  return out;
}

/**
 * แปลงไฟล์ dashboard_data.json ทั้งไฟล์ (ดู Logic summary หัวไฟล์)
 * throw เมื่อเจอปัญหาอย่างน้อย 1 ข้อ — ข้อความรวมปัญหาทั้งหมด (สูงสุด 30 ข้อ)
 */
export function convertLegacyDashboardData(data: unknown, options: ConvertOptions): LegacyConversion {
  const { goLiveMonth } = options;
  if (!MONTH_RE.test(goLiveMonth)) {
    throw new Error(`legacy: goLiveMonth ต้องเป็น YYYY-MM (ได้ "${goLiveMonth}")`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("legacy: ไฟล์ต้องเป็น object { \"MMM.YY\": [แถว…] }");
  }

  const entries = Object.entries(data as Record<string, unknown>).map(([key, rows]) => ({
    key,
    month: parseDashboardMonthKey(key),
    rows,
  }));
  entries.sort((a, b) => a.month.localeCompare(b.month));

  const monthsSeen = new Set<string>();
  for (const e of entries) {
    if (monthsSeen.has(e.month)) throw new Error(`legacy: เดือน ${e.key} ซ้ำในไฟล์`);
    monthsSeen.add(e.month);
  }

  const wanted = entries.filter((e) => e.month < goLiveMonth);
  const skippedKeys = entries.filter((e) => e.month >= goLiveMonth).map((e) => e.key);

  const issues: string[] = [];
  if (wanted.length === 0) {
    issues.push(`ไม่มีเดือนก่อน go-live (${goLiveMonth}) ในไฟล์`);
  } else {
    // ต่อเนื่องตั้งแต่เดือนแรกในไฟล์จนถึงเดือนก่อน go-live พอดี
    let expect = wanted[0]!.month;
    for (const e of wanted) {
      if (e.month !== expect) issues.push(`เดือน ${expect} ขาดหายจากไฟล์`);
      expect = nextMonth(e.month);
    }
    if (expect !== goLiveMonth) {
      // expect = เดือนถัดจากเดือนสุดท้ายที่มี → ขาดตั้งแต่ expect ถึงเดือนก่อน go-live
      issues.push(`เดือน ${expect} (ก่อน go-live ${goLiveMonth}) ไม่มีในไฟล์`);
    }
  }

  const rows: LegacySnapshotRow[] = [];
  const areaDifferences: AreaDifference[] = [];
  for (const e of wanted) {
    rows.push(...convertMonth(e.key, e.month, e.rows, issues, areaDifferences));
  }

  if (issues.length > 0) {
    const shown = issues.slice(0, 30).join("\n  - ");
    const more = issues.length > 30 ? `\n  … และอีก ${issues.length - 30} ข้อ` : "";
    throw new Error(`legacy: ไฟล์ไม่ผ่านการตรวจ ${issues.length} ข้อ (ไม่นำเข้าเลย)\n  - ${shown}${more}`);
  }

  return { rows, months: wanted.map((e) => e.month), skippedKeys, areaDifferences };
}

export interface LegacyMonthTotal {
  month: string;
  rows: number;
  cust: number;
  /** มูลค่ารวมเป็นสตางค์ (จำนวนเต็ม · ไม่มีเศษ float) */
  valueCents: number;
}

/** ยอดรวมต่อเดือน (ใช้เทียบไฟล์ต้นฉบับ / ผลอ่านกลับจาก DB / รายงาน) */
export function legacyTotalsByMonth(rows: readonly StoredSnapshotRow[]): LegacyMonthTotal[] {
  const byMonth = new Map<string, LegacyMonthTotal>();
  for (const r of rows) {
    const t = byMonth.get(r.month) ?? { month: r.month, rows: 0, cust: 0, valueCents: 0 };
    t.rows += 1;
    t.cust += r.cust;
    t.valueCents += toCents(r.value);
    byMonth.set(r.month, t);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** แถวสำหรับ insert ลง `monthly_branch_snapshots` (ชื่อคอลัมน์ตรงตาราง) */
export interface LegacySnapshotInsert {
  month_key: string;
  branch_id: string;
  source: "legacy";
  s1: number; s3: number; m1: number; m3: number;
  l1: number; l3: number; xl1: number; xl3: number;
  cust: number;
  vS: number; vM: number; vL: number; vXL: number;
  value: number;
}

/**
 * แปลงเป็นแถว insert — ไม่ส่ง `v_s1…v_xl3`, `value_annual`, `report_*`, `confirmed_*` (ไฟล์เดิมไม่มี → ใช้ default ของ DB)
 * `branchIdByName` = `branches.name → branches.id` จากฐานข้อมูล · ไม่พบชื่อ = throw
 */
export function toSnapshotInsertRows(
  rows: readonly LegacySnapshotRow[],
  branchIdByName: ReadonlyMap<string, string>,
): LegacySnapshotInsert[] {
  return rows.map((r) => {
    const id = branchIdByName.get(r.branch);
    if (!id) throw new Error(`legacy: ไม่พบ id ของสาขา "${r.branch}" ในตาราง branches`);
    return {
      month_key: r.month,
      branch_id: id,
      source: "legacy",
      s1: r.s1, s3: r.s3, m1: r.m1, m3: r.m3,
      l1: r.l1, l3: r.l3, xl1: r.xl1, xl3: r.xl3,
      cust: r.cust,
      vS: r.vS, vM: r.vM, vL: r.vL, vXL: r.vXL,
      value: r.value,
    };
  });
}
