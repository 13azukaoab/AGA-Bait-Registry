import { monthOf } from "../rules/date";
import { defaultEndDateForTerm } from "../rules/term";
import {
  COL,
  SOURCE_COLUMNS,
  type CleanedRow,
  type ImportOptions,
  type ImportResult,
  type MustFixRow,
  type RawRow,
  type SaleType,
  type SkippedRow,
} from "./types";
import { normalizeBranch } from "./branches";
import { normalizeCustomerType } from "./customerTypes";
import {
  normalizeContractNo,
  normalizeTeams,
  normalizeTime,
  parseSourceDate,
  parseTermMonths,
  resolveTermValue,
  sellerColumns,
} from "./fields";

/**
 * รวมกฎล้าง+ตรวจข้อมูลนำเข้าสัญญาจาก Excel ไว้ที่เดียว (SPEC §10, §11 · mockup หน้าจอ 7)
 * แบ่งผลเป็น 3 กลุ่ม:
 *   - ready    = แก้ให้อัตโนมัติแล้วพร้อมบันทึก (บอกทุกครั้งว่าแก้อะไรใน fixes · เตือนใน warnings)
 *   - mustFix  = มีปัญหาที่คนต้องแก้เอง ไม่นำเข้า
 *   - skipped  = ไม่ใช่แถวสัญญา (บล็อกสรุปที่ติดมาจากชีท)
 */

/** ระยะ (วัน) ที่ยอมให้วันสิ้นสุดคลาดจากที่ควรเป็น ก่อนจะถือว่าเป็น "ระยะอื่น" (must-fix)
 *  ≤ ค่านี้ = แค่เตือน (SPEC §11) · > ค่านี้ = ระยะไม่ตรง (task.md) — ปรับได้
 *  M30: สัญญาสั้นกว่า 12 เดือนใช้ค่าแคบกว่า (45 วันกว้างเกิน 1 เดือนของสัญญา 1–2 เดือน) */
const TERM_TOLERANCE_DAYS = 45;
const SHORT_TERM_TOLERANCE_DAYS = 7;

/** M30: ช่วงที่ยอมให้คลาดตอน "อนุมาน" สัญญาสั้นจากวันเริ่ม/สิ้นสุด (ไม่มีคอลัมน์จำนวนเดือน) */
const INFER_TOLERANCE_DAYS = 3;

/** ป้ายระยะสัญญาในข้อความ: 12 → "1 ปี" · 36 → "3 ปี" · อื่น → "N เดือน" */
function termLabel(months: number): string {
  return months === 12 || months === 36 ? `${months / 12} ปี` : `${months} เดือน`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.UTC(+isoA.slice(0, 4), +isoA.slice(5, 7) - 1, +isoA.slice(8, 10));
  const b = Date.UTC(+isoB.slice(0, 4), +isoB.slice(5, 7) - 1, +isoB.slice(8, 10));
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * M30 (DECISIONS 2.53): Excel เดิมไม่มีคอลัมน์จำนวนเดือน — สัญญาสั้นอยู่ในช่อง "1 ปี" แต่วันที่ครอบคลุม N เดือน
 * อนุมานเฉพาะ: ช่อง "1 ปี" · 1–11 เดือน · วันสิ้นสุดคลาดไม่เกิน INFER_TOLERANCE_DAYS (เลือกที่ใกล้สุด)
 * ไม่อนุมาน 13–35 เดือน หรือช่อง "3 ปี" (กำกวม — ให้ใส่คอลัมน์ "จำนวนเดือน") → คืน null
 */
function inferShortTerm(startIso: string, endIso: string): number | null {
  let best: { months: number; diff: number } | null = null;
  for (let m = 1; m <= 11; m++) {
    const diff = Math.abs(daysBetween(endIso, defaultEndDateForTerm(startIso, m)));
    if (diff <= INFER_TOLERANCE_DAYS && (!best || diff < best.diff)) best = { months: m, diff };
  }
  return best?.months ?? null;
}

/** ค่าถือว่า "ติ๊ก" เมื่อไม่ว่างและไม่ใช่ FALSE/0 */
function isTruthy(v: string): boolean {
  const s = v.trim().toUpperCase();
  return s !== "" && s !== "FALSE" && s !== "0";
}

/** แปลง RawRow เป็น array ตามลำดับ SOURCE_COLUMNS */
function toCells(row: RawRow): string[] {
  if (Array.isArray(row)) return row.map((c) => c ?? "");
  return SOURCE_COLUMNS.map((name) => row[name] ?? "");
}

/** ผลการตรวจ 1 แถว (ภายใน) */
type RowOutcome =
  | { kind: "skip"; reason: string }
  | { kind: "ready"; row: CleanedRow }
  | { kind: "mustFix"; row: MustFixRow };

function checkRow(
  cells: string[],
  rowIndex: number,
  seen: Map<string, number>,
  opts: ImportOptions,
): RowOutcome {
  const get = (i: number) => (cells[i] ?? "").trim();
  const name = get(COL.name) || "(ไม่มีชื่อ)";

  const ct = normalizeContractNo(cells[COL.contractNo] ?? "");

  // เลขสัญญาผิดรูป/ว่าง แต่มีมูลค่า + วันที่ = แถวสัญญาจริงที่พิมพ์เลขผิด → ต้องแก้ (ไม่ข้ามเงียบ · ค1 18 พ.ย. 2026)
  // แถวสรุปท้ายชีท (ไม่มีวันที่) ยังข้ามเหมือนเดิม
  if (!ct.isContractNo && opts.flagMalformedContractWithValue) {
    const money = (v: string) => {
      const n = Number(v.replace(/,/g, ""));
      return Number.isFinite(n) && n > 0;
    };
    const hasValue = money(get(COL.value1y)) || money(get(COL.value3y));
    const hasDate = get(COL.startDate) !== "" || get(COL.endDate) !== "";
    if (hasValue && hasDate) {
      return {
        kind: "mustFix",
        row: {
          rowIndex,
          contractNo: get(COL.contractNo),
          customerName: name,
          errors: [`เลขที่สัญญาผิดรูปหรือว่าง ("${get(COL.contractNo) || "ว่าง"}") แต่มีมูลค่า`],
          fixes: [],
          warnings: [],
        },
      };
    }
  }

  // ไม่ใช่แถวสัญญา → ข้าม
  if (!ct.isContractNo) {
    return {
      kind: "skip",
      reason: `ไม่ใช่แถวสัญญา (ช่องเลขที่สัญญาเป็น "${get(COL.contractNo) || "ว่าง"}") — น่าจะเป็นบล็อกสรุปที่ติดมาด้วย`,
    };
  }

  const errors: string[] = [];
  const fixes: string[] = [];
  const warnings: string[] = [];
  const addFix = (f?: string) => {
    if (f) fixes.push(f);
  };

  // คอลัมน์เลื่อนทั้งแถว: ช่องทีมกลายเป็นเวลา → แจ้งอย่างเดียว (ค่าที่เหลือเชื่อถือไม่ได้)
  if (/^\d{1,2}:\d{2}/.test(get(COL.team))) {
    return {
      kind: "mustFix",
      row: {
        rowIndex,
        contractNo: ct.value,
        customerName: name,
        errors: [`คอลัมน์เลื่อนทั้งแถว (ช่องทีมเป็นเวลา "${get(COL.team)}")`],
        fixes: [],
        warnings: [],
      },
    };
  }

  // เลขที่สัญญา
  addFix(ct.fix);
  if (!ct.wellFormed) errors.push("เลขที่สัญญาไม่ครบ 7 หลัก (CTyy-nnnnnnn)");
  const dup = seen.get(ct.value);
  if (dup) errors.push(`เลขที่สัญญาซ้ำกับแถว ${dup}`);
  else seen.set(ct.value, rowIndex);

  // สาขา + เขต (คำนวณจากสาขา ไม่อ่านคอลัมน์เขตจากไฟล์)
  const br = normalizeBranch(get(COL.branch));
  if (br.error) errors.push(br.error);
  addFix(br.fix);

  // ประเภทลูกค้า
  const type = normalizeCustomerType(get(COL.customerType));
  if (type.error) errors.push(type.error);
  addFix(type.fix);

  // ทีม
  const team = normalizeTeams(get(COL.team), opts.teamCodes);
  if (team.error) errors.push(team.error);
  team.fixes.forEach(addFix);

  // เวลาบริการ
  const time = normalizeTime(get(COL.serviceTime));
  if (time.error) errors.push(time.error);
  addFix(time.fix);

  // ผู้ขาย
  // นำเข้าจากทะเบียนรายสาขา (2.70 ฉ): ไม่มีผู้ขาย = ปล่อยว่าง (sale_name NULL) + เตือน · การนำเข้าปกติยังบังคับ
  if (!get(COL.seller)) {
    if (opts.allowMissingSeller) warnings.push("ไม่ทราบผู้ขาย (ปล่อยว่าง)");
    else errors.push("ไม่มีผู้ขาย");
  }

  // New / Renew
  const isNew = isTruthy(get(COL.isNew));
  const isRenew = isTruthy(get(COL.isRenew));
  let saleType: SaleType | null = null;
  if (isNew && isRenew) warnings.push("ติ๊กทั้ง New และ Renew");
  else if (isNew) saleType = "new";
  else if (isRenew) saleType = "renew";
  else warnings.push("ไม่ได้ระบุ New/Renew");

  // ระยะสัญญา + มูลค่า (ช่องมูลค่าบอก 12/36 · คอลัมน์ "จำนวนเดือน" ชนะ · M30)
  const tv = resolveTermValue(get(COL.value1y), get(COL.value3y));
  if (tv.error) errors.push(tv.error);
  const tm = parseTermMonths(get(COL.termMonths));
  if (tm.error) errors.push(tm.error);
  let termMonths: number | null = tm.months ?? tv.termMonths;
  if (
    tm.months !== null &&
    tv.termMonths !== null &&
    ((tv.termMonths === 36 && tm.months !== 36) || (tv.termMonths === 12 && tm.months === 36))
  ) {
    warnings.push(
      `จำนวนเดือน ${tm.months} ไม่ตรงช่องมูลค่า (${termLabel(tv.termMonths)}) — ใช้จำนวนเดือน ${tm.months}`,
    );
  }

  // วันเริ่ม / วันสิ้นสุด (บังคับ)
  const start = parseSourceDate(get(COL.startDate));
  const end = parseSourceDate(get(COL.endDate));
  if (!start.iso) errors.push(`วันเริ่มสัญญา${start.error ? ": " + start.error : "ว่าง"}`);
  if (!end.iso) errors.push(`วันสิ้นสุด${end.error ? ": " + end.error : "ว่าง"}`);

  // ตรวจความสอดคล้องวันที่ ↔ ระยะสัญญา
  if (start.iso && end.iso) {
    if (end.iso < start.iso) {
      errors.push("วันสิ้นสุดก่อนวันเริ่ม");
    } else if (termMonths !== null && !tm.error) {
      // ไม่มีคอลัมน์จำนวนเดือน + ช่อง "1 ปี" + วันที่ไม่ใช่ 12 เดือนพอดี → ลองอนุมานสัญญาสั้น (Custom)
      if (
        tm.months === null &&
        tv.termMonths === 12 &&
        defaultEndDateForTerm(start.iso, 12) !== end.iso
      ) {
        const inferred = inferShortTerm(start.iso, end.iso);
        if (inferred !== null) {
          termMonths = inferred;
          warnings.push(`สัญญา ${inferred} เดือน (Custom) — อ่านจากวันเริ่ม/วันสิ้นสุด ตรวจว่าถูกต้อง`);
        }
      }
      const expectedEnd = defaultEndDateForTerm(start.iso, termMonths);
      const diff = Math.abs(daysBetween(end.iso, expectedEnd));
      const tolerance = termMonths >= 12 ? TERM_TOLERANCE_DAYS : SHORT_TERM_TOLERANCE_DAYS;
      if (diff > 0 && diff <= tolerance) {
        warnings.push(
          `ระยะสัญญาไม่ตรงวันที่ (คาดสิ้นสุด ${expectedEnd} แต่ใส่ ${end.iso})`,
        );
      } else if (diff > tolerance) {
        errors.push(
          `ระยะสัญญาไม่ใช่ ${termLabel(termMonths)} (ห่างจากที่ควรเป็น ${diff} วัน)`,
        );
      }
    }
  }

  // วันที่บริการ (ไม่บังคับ) — ปีผิด/ไม่มีจริง = must-fix · ก่อนวันเริ่ม/นอกเดือน = เตือน
  const service = parseSourceDate(get(COL.serviceDate));
  if (service.error) errors.push(`วันที่บริการ: ${service.error}`);
  if (service.iso) {
    if (start.iso && service.iso < start.iso) {
      warnings.push("วันที่บริการมาก่อนวันเริ่มสัญญา");
    }
    if (opts.entryMonth && monthOf(service.iso) !== opts.entryMonth) {
      warnings.push(`วันที่บริการอยู่นอกเดือนที่กรอก (${opts.entryMonth})`);
    }
  }

  if (errors.length) {
    return {
      kind: "mustFix",
      row: { rowIndex, contractNo: ct.value, customerName: name, errors, fixes, warnings },
    };
  }

  // ถึงตรงนี้ = ไม่มี error → ค่าหลักต้องครบแล้ว
  return {
    kind: "ready",
    row: {
      rowIndex,
      contractNo: ct.value,
      customerName: name,
      seller: get(COL.seller),
      ...sellerColumns(get(COL.seller), get(COL.position)),
      saleType,
      urgent: isTruthy(get(COL.urgent)),
      branch: br.branch!,
      zone: br.zone,
      division: br.division,
      customerType: type.value!,
      teams: team.teams,
      startDate: start.iso!,
      endDate: end.iso!,
      termMonths: termMonths!,
      valueTotal: tv.valueTotal!,
      serviceDate: service.iso,
      serviceTime: time.value,
      note: get(COL.note),
      fixes,
      warnings,
    },
  };
}

export function importContracts(
  rows: RawRow[],
  opts: ImportOptions = {},
): ImportResult {
  const ready: CleanedRow[] = [];
  const mustFix: MustFixRow[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Map<string, number>();

  rows.forEach((raw, i) => {
    const rowIndex = i + 1;
    const outcome = checkRow(toCells(raw), rowIndex, seen, opts);
    if (outcome.kind === "skip") skipped.push({ rowIndex, reason: outcome.reason });
    else if (outcome.kind === "ready") ready.push(outcome.row);
    else mustFix.push(outcome.row);
  });

  return {
    ready,
    mustFix,
    skipped,
    summary: {
      total: rows.length,
      ready: ready.length,
      mustFix: mustFix.length,
      skipped: skipped.length,
      autoFixedRows: ready.filter((r) => r.fixes.length > 0).length,
    },
  };
}

/** วางข้อมูลจาก Excel (คั่นด้วย tab) → ประมวลผล */
export function importFromTsv(text: string, opts: ImportOptions = {}): ImportResult {
  const rows = (text ?? "")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim())
    .map((l) => l.split("\t"));
  return importContracts(rows, opts);
}
