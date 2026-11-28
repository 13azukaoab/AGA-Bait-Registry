/**
 * อ่าน "วันที่รับ Mail / วันที่บริการ / เวลาบริการ" จากไฟล์เปิดงาน (รายชื่อลูกค้าเปิดงาน ปีXXXX.xlsx) รายเลขสัญญา
 * ใช้เติมช่อง contracts.mail_received_date / first_service_date / first_service_time ของสัญญานำเข้าทะเบียน
 * (ตัวนำเข้าทะเบียนไม่เคยเขียน 3 ช่องนี้ — ทะเบียนรายสาขาไม่มีคอลัมน์เหล่านี้) · pure function ไม่อ่านไฟล์เอง
 *
 * Logic summary:
 *   1. หัวตาราง: หาแถวที่มีป้าย "เลขที่สัญญา" ในช่วง 10 แถวแรก (ไม่ fix เลขแถว — ม.ค.–เม.ย. 26 อยู่แถว 2, พ.ค. ขึ้นไปอยู่แถว 3)
 *      แล้วหาคอลัมน์ "วันที่รับ Mail" / "วันที่บริการ" / "เวลาบริการ" / "สาขา" จากป้ายในแถวเดียวกัน (ตำแหน่งคอลัมน์ต่างกันรายเดือน)
 *      ชีทที่ไม่มีครบ 4 ป้าย (Reference, รายชื่อเซลล์) = ข้าม (sheetsSkipped)
 *   2. แถวข้อมูล = เลขที่สัญญาผ่าน normalizeContractNo (ตัวเดียวกับ importContracts / sellerLookup) · แถวอื่นนับเป็น
 *      "ไม่ใช่แถวสัญญา" (ว่าง/บล็อกสรุปท้ายชีท) · ⚠ ชีทเดือนล่าสุดมีแถวว่างเป็นล้านแถว → loop ธรรมดา ห้าม spread
 *   3. วันที่ (parseJobDate): serial ของ Excel · ข้อความ วว/ดด/ปปปป (คั่น / - .) · ปปปป-ดด-วว
 *      ปี ≥ 2400 = พ.ศ. → ลบ 543 (นับไว้ใน fixes) · ปี 2 หลัก / อ่านไม่ออก / วันไม่มีจริง = ปัญหา (ไม่เดา)
 *      หลายวันในช่องเดียว (12,13/01/2026 · 12-13/1/2026 · 12/1-13/1/2026) = ใช้วันแรก (DECISIONS 2.120 ข้อ 6 · นับใน multiDayFirst)
 *      แล้วตรวจต่อตามกฎเดิม (เช่น ปี 2 หลัก ยังเป็นปัญหา)
 *      ปีนอกช่วง (ค่าเริ่ม 2023–2027) = ปัญหา (ไม่เติม)
 *   4. เวลา (parseJobTime): เศษของวัน (0 ≤ x < 1) · ข้อความ HH:MM / HH.MM (ตัด "น.") · ช่วงเวลา "09.00-10.00" หรือ "09.00/10.00"
 *      = ใช้เวลาเริ่ม (นับไว้ใน ranges) · ตัวเลข ≥ 1 (วันที่อยู่ในช่องเวลา) / คำว่า เช้า-บ่าย / อ่านไม่ออก = ปัญหา (ไม่เดา)
 *   5. เลขสัญญาเดียวกันหลายแถว (ชีทเดียวกันหรือหลายชีท/หลายไฟล์): รวมรายช่อง
 *      ค่าที่อ่านได้ตรงกัน (หรืออีกแถวว่าง) = ใช้ได้ · ค่าต่างกัน = conflict ช่องนั้น (ไม่เลือกเอง ไม่เติม)
 *      เวลาผูกกับวันที่บริการ: วันที่บริการ conflict → เวลาใช้ไม่ได้ด้วย
 *   6. ผลลัพธ์มีแค่ เลขสัญญา · ชื่อชีท · เลขแถว Excel · วันที่/เวลา · ชนิดปัญหา — ไม่มีชื่อ/เบอร์/ที่อยู่ลูกค้า (PDPA)
 *      ค่าในเซลล์ที่อ่านไม่ออกไม่ถูกเก็บ (เก็บแค่ "ชนิด") กันข้อความแปลกที่อาจมีชื่อคนหลุดลงรายงาน
 */
import { excelSerialToIso, type CellValue } from "./registrySheet";
import { normalizeContractNo } from "./fields";

// ---------------------------------------------------------------------
// วันที่
// ---------------------------------------------------------------------

export type DateProblem =
  | "unreadable" // อ่านไม่ออก
  | "twoDigitYear" // ปี 2 หลัก (ไม่เดาศตวรรษ/พ.ศ.)
  | "notRealDate" // วันที่ไม่มีจริง เช่น 31/11
  | "yearOutOfRange"; // ปีหลังแปลงอยู่นอกช่วงที่ยอมรับ

export interface DateParse {
  /** 'YYYY-MM-DD' (ค.ศ.) · null = ว่าง หรือมีปัญหา */
  iso: string | null;
  /** ปีเป็น พ.ศ. แล้วแปลงเป็น ค.ศ. ให้ */
  buddhistYear?: boolean;
  /** ค่าเป็นข้อความ (ไม่ใช่ช่องวันที่ของ Excel) */
  fromText?: boolean;
  /** ช่องมีหลายวัน → ใช้วันแรก (2.120 ข้อ 6) */
  multiDayFirst?: boolean;
  problem?: DateProblem;
}

export interface YearRange {
  minYear: number;
  maxYear: number;
}

/** ช่วงปีที่ยอมรับ (ไฟล์เปิดงาน 2568–2569 + สัญญาที่เริ่มก่อนหน้า) · นอกช่วง = ปัญหา */
export const DEFAULT_YEAR_RANGE: YearRange = { minYear: 2023, maxYear: 2027 };

const BUDDHIST_OFFSET = 543;
const BUDDHIST_MIN = 2400;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function finishDate(y: number, m: number, d: number, range: YearRange, fromText: boolean): DateParse {
  let year = y;
  let buddhistYear = false;
  if (year >= BUDDHIST_MIN) {
    year -= BUDDHIST_OFFSET;
    buddhistYear = true;
  }
  const extra = { ...(buddhistYear ? { buddhistYear } : {}), ...(fromText ? { fromText } : {}) };
  if (!isRealDate(year, m, d)) return { iso: null, problem: "notRealDate", ...extra };
  if (year < range.minYear || year > range.maxYear) return { iso: null, problem: "yearOutOfRange", ...extra };
  return { iso: `${year}-${pad2(m)}-${pad2(d)}`, ...extra };
}

const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d+)$/;
const YMD = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
/** หลายวันในช่องเดียว → ข้อความวันแรก: "12,13/01/26" → "12/01/26" · "12-13/1/2026" → "12/1/2026" · "12/1-13/1/2026" → "12/1/2026" */
const MULTI_DAY: readonly [RegExp, (m: RegExpExecArray) => string][] = [
  [/^(\d{1,2})\s*[,&]\s*\d{1,2}([/.-]\d{1,2}[/.-]\d+)$/, (m) => `${m[1]}${m[2]}`],
  [/^(\d{1,2})\s*-\s*\d{1,2}\s*(\/\d{1,2}\/\d+)$/, (m) => `${m[1]}${m[2]}`],
  [/^(\d{1,2}\/\d{1,2})\s*-\s*\d{1,2}\/\d{1,2}(\/\d+)$/, (m) => `${m[1]}${m[2]}`],
];

/** ค่าเซลล์วันที่ของไฟล์เปิดงาน → 'YYYY-MM-DD' (ดู Logic summary ข้อ 3) */
export function parseJobDate(v: CellValue | undefined, range: YearRange = DEFAULT_YEAR_RANGE): DateParse {
  if (v === null || v === undefined || typeof v === "boolean") return { iso: null };
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 1) return { iso: null, problem: "unreadable" };
    const iso = excelSerialToIso(v);
    if (!iso) return { iso: null, problem: "unreadable" };
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    return finishDate(y, m, d, range, false);
  }
  const text = v.replace(/\s+/g, " ").trim();
  if (text === "") return { iso: null };
  for (const [re, first] of MULTI_DAY) {
    const m = re.exec(text);
    if (m) return { ...parseJobDate(first(m), range), multiDayFirst: true };
  }
  const ymd = YMD.exec(text);
  if (ymd) return finishDate(+ymd[1]!, +ymd[2]!, +ymd[3]!, range, true);
  const dmy = DMY.exec(text);
  if (!dmy) return { iso: null, problem: "unreadable", fromText: true };
  const yearText = dmy[3]!;
  if (yearText.length === 2) return { iso: null, problem: "twoDigitYear", fromText: true };
  if (yearText.length !== 4) return { iso: null, problem: "unreadable", fromText: true };
  return finishDate(+yearText, +dmy[2]!, +dmy[1]!, range, true);
}

// ---------------------------------------------------------------------
// เวลา
// ---------------------------------------------------------------------

export type TimeProblem =
  | "unreadable" // อ่านไม่ออก
  | "dateInTimeCell" // ช่องเวลาเป็นตัวเลขวันที่ (≥ 1)
  | "wordTime" // เช้า / บ่าย / เย็น ฯลฯ (ไม่เดาเวลา)
  | "outOfRange"; // ชั่วโมง > 23 หรือนาที > 59

export interface TimeParse {
  /** 'HH:MM' · null = ว่าง หรือมีปัญหา */
  value: string | null;
  /** ช่องเป็นช่วงเวลา → ใช้เวลาเริ่ม */
  range?: boolean;
  problem?: TimeProblem;
}

const TIME_WORD = /เช้า|บ่าย|เย็น|ค่ำ|เที่ยง|กลางวัน|ทั้งวัน/;
const TIME_ONE = /^(\d{1,2})\s*[:.]\s*(\d{2})$/;
const TIME_RANGE = /^(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:-|–|\/|ถึง)\s*(\d{1,2})\s*[:.]\s*(\d{2})$/;

function hhmm(h: number, m: number): TimeParse {
  if (h > 23 || m > 59) return { value: null, problem: "outOfRange" };
  return { value: `${pad2(h)}:${pad2(m)}` };
}

/** ค่าเซลล์เวลาของไฟล์เปิดงาน → 'HH:MM' (ดู Logic summary ข้อ 4) */
export function parseJobTime(v: CellValue | undefined): TimeParse {
  if (v === null || v === undefined || typeof v === "boolean") return { value: null };
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return { value: null, problem: "unreadable" };
    if (v >= 1) return { value: null, problem: "dateInTimeCell" };
    const minutes = Math.round(v * 24 * 60);
    if (minutes >= 24 * 60) return { value: null, problem: "outOfRange" };
    return hhmm(Math.floor(minutes / 60), minutes % 60);
  }
  if (TIME_WORD.test(v)) return { value: null, problem: "wordTime" };
  // ตัดหน่วย "น." (นาฬิกา) ออก — ตรวจคำ เช้า/บ่าย/เย็น ก่อนแล้ว (คำเหล่านี้มีตัว น)
  const text = v
    .replace(/น\s*\.?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return { value: null };
  const one = TIME_ONE.exec(text);
  if (one) return hhmm(+one[1]!, +one[2]!);
  const range = TIME_RANGE.exec(text);
  if (range) {
    const start = hhmm(+range[1]!, +range[2]!);
    return start.value ? { ...start, range: true } : start;
  }
  return { value: null, problem: "unreadable" };
}

// ---------------------------------------------------------------------
// อ่านทั้งไฟล์ → ดัชนีรายเลขสัญญา
// ---------------------------------------------------------------------

export type JobField = "mail" | "service" | "time";

export interface JobOccurrence {
  /** ป้ายไฟล์ (เช่น "2569") */
  source: string;
  sheet: string;
  excelRow: number;
}

export interface JobFieldValue {
  /** ค่าที่ใช้ได้ (null = ไม่มีค่า / conflict / มีแต่ค่าที่อ่านไม่ได้) */
  value: string | null;
  /** หลายแถวให้ค่าต่างกัน */
  conflict: boolean;
  /** มีแถวที่อ่านค่านี้ไม่ได้ (ปัญหา) — แม้จะมีแถวอื่นที่อ่านได้ */
  hadProblem: boolean;
}

export interface JobEntry {
  contractNo: string;
  occurrences: JobOccurrence[];
  /** ข้อความสาขาของแถวแรก (ใช้แยกสาเหตุ "ไม่พบในทะเบียน" · ชื่อสาขาไม่ใช่ข้อมูลส่วนบุคคล) */
  branchText: string;
  mail: JobFieldValue;
  service: JobFieldValue;
  time: JobFieldValue;
  /** เวลาที่อ่านจากช่วงเวลา (ใช้เวลาเริ่ม) */
  timeFromRange: boolean;
}

export interface JobProblem {
  source: string;
  sheet: string;
  excelRow: number;
  contractNo: string;
  field: JobField;
  kind: DateProblem | TimeProblem;
}

export interface JobSheetStats {
  source: string;
  sheet: string;
  /** แถวหัวตาราง (เลขแถว Excel) */
  headerRow: number;
  /** แถวที่เลขสัญญาเป็นรูป CTyy-… */
  contractRows: number;
  /** แถวที่มีค่าในบางช่องแต่ช่องเลขสัญญาว่าง/ไม่ใช่เลขสัญญา (บล็อกสรุปท้ายชีท ฯลฯ) */
  nonContractRows: number;
  /** ในกลุ่ม nonContractRows: แถวที่มีวันที่รับ Mail หรือวันที่บริการ (น่าจะเป็นงานจริงที่เลขสัญญาว่าง/ผิดรูป) — เลขแถว Excel */
  malformedContractRows: number[];
  withMail: number;
  withService: number;
  withTime: number;
  /** ปีเป็น พ.ศ. ที่แปลงให้ */
  buddhistYearFixes: number;
  /** วันที่เป็นข้อความที่อ่านได้ */
  textDates: number;
  /** ช่องที่มีหลายวัน (ใช้วันแรก) */
  multiDayFirst: number;
  /** เวลาเป็นช่วงที่ใช้เวลาเริ่ม */
  timeRanges: number;
  problems: number;
}

export interface JobOpeningIndex {
  readonly entries: ReadonlyMap<string, JobEntry>;
  readonly sheets: JobSheetStats[];
  /** ชีทที่ไม่ใช่ข้อมูลงาน (ไม่มีป้ายครบ) */
  readonly sheetsSkipped: { source: string; sheet: string }[];
  readonly problems: JobProblem[];
  /** เลขสัญญาที่เจอมากกว่า 1 แถว */
  readonly duplicates: { contractNo: string; occurrences: JobOccurrence[]; conflictFields: JobField[] }[];
}

export interface JobSheetInput {
  name: string;
  rows: CellValue[][];
}

export interface JobSourceInput {
  /** ป้ายไฟล์ (เช่น "2569") — ส่งไฟล์ปีล่าสุดมาก่อน */
  label: string;
  sheets: JobSheetInput[];
}

const HEADER_SCAN_ROWS = 10;
const LABELS = {
  contractNo: "เลขที่สัญญา",
  mail: "วันที่รับ Mail",
  service: "วันที่บริการ",
  time: "เวลาบริการ",
  branch: "สาขา",
} as const;

function label(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

interface JobColumns {
  headerRow: number; // index 0
  contractNo: number;
  mail: number;
  service: number;
  time: number;
  branch: number;
}

/** หาหัวตาราง (ดู Logic summary ข้อ 1) · ไม่เจอครบ = null */
export function findJobColumns(rows: readonly CellValue[][]): JobColumns | null {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    const at = (name: string) => row.findIndex((c) => label(c) === name);
    const contractNo = at(LABELS.contractNo);
    if (contractNo < 0) continue;
    const cols = { headerRow: r, contractNo, mail: at(LABELS.mail), service: at(LABELS.service), time: at(LABELS.time), branch: at(LABELS.branch) };
    if (cols.mail < 0 || cols.service < 0 || cols.time < 0 || cols.branch < 0) return null;
    return cols;
  }
  return null;
}

interface Acc {
  contractNo: string;
  occurrences: JobOccurrence[];
  branchText: string;
  values: Record<JobField, Set<string>>;
  problems: Record<JobField, boolean>;
  timeFromRange: boolean;
}

function hasAnyValue(row: readonly CellValue[]): boolean {
  for (const c of row) if (c !== null && c !== undefined && c !== "") return true;
  return false;
}

function fieldValue(values: Set<string>, hadProblem: boolean): JobFieldValue {
  if (values.size > 1) return { value: null, conflict: true, hadProblem };
  const [only] = values;
  return { value: only ?? null, conflict: false, hadProblem };
}

/** อ่านทุกชีทของไฟล์เปิดงาน (หลายไฟล์ได้ · ส่งปีล่าสุดก่อน) → ดัชนีรายเลขสัญญา */
export function buildJobOpeningIndex(sources: readonly JobSourceInput[], range: YearRange = DEFAULT_YEAR_RANGE): JobOpeningIndex {
  const acc = new Map<string, Acc>();
  const sheets: JobSheetStats[] = [];
  const sheetsSkipped: { source: string; sheet: string }[] = [];
  const problems: JobProblem[] = [];

  for (const src of sources) {
    for (const sheet of src.sheets) {
      const cols = findJobColumns(sheet.rows);
      if (!cols) {
        sheetsSkipped.push({ source: src.label, sheet: sheet.name });
        continue;
      }
      const stats: JobSheetStats = {
        source: src.label,
        sheet: sheet.name,
        headerRow: cols.headerRow + 1,
        contractRows: 0,
        nonContractRows: 0,
        malformedContractRows: [],
        withMail: 0,
        withService: 0,
        withTime: 0,
        buddhistYearFixes: 0,
        textDates: 0,
        multiDayFirst: 0,
        timeRanges: 0,
        problems: 0,
      };
      for (let r = cols.headerRow + 1; r < sheet.rows.length; r++) {
        const cells = sheet.rows[r];
        if (!cells || !hasAnyValue(cells)) continue;
        const ct = normalizeContractNo(label(cells[cols.contractNo]));
        if (!ct.isContractNo) {
          stats.nonContractRows += 1;
          if (parseJobDate(cells[cols.mail], range).iso || parseJobDate(cells[cols.service], range).iso) {
            stats.malformedContractRows.push(r + 1);
          }
          continue;
        }
        stats.contractRows += 1;
        const excelRow = r + 1;
        const where = { source: src.label, sheet: sheet.name, excelRow };
        const entry =
          acc.get(ct.value) ??
          ({
            contractNo: ct.value,
            occurrences: [],
            branchText: label(cells[cols.branch]),
            values: { mail: new Set(), service: new Set(), time: new Set() },
            problems: { mail: false, service: false, time: false },
            timeFromRange: false,
          } satisfies Acc);
        acc.set(ct.value, entry);
        entry.occurrences.push(where);

        const note = (field: JobField, kind: DateProblem | TimeProblem) => {
          problems.push({ ...where, contractNo: ct.value, field, kind });
          entry.problems[field] = true;
          stats.problems += 1;
        };
        const mail = parseJobDate(cells[cols.mail], range);
        const service = parseJobDate(cells[cols.service], range);
        const time = parseJobTime(cells[cols.time]);
        for (const [field, d] of [["mail", mail], ["service", service]] as const) {
          if (d.problem) note(field, d.problem);
          if (d.buddhistYear) stats.buddhistYearFixes += 1;
          if (d.multiDayFirst) stats.multiDayFirst += 1;
          if (d.iso) {
            entry.values[field].add(d.iso);
            if (d.fromText) stats.textDates += 1;
            if (field === "mail") stats.withMail += 1;
            else stats.withService += 1;
          }
        }
        if (time.problem) note("time", time.problem);
        if (time.value) {
          entry.values.time.add(time.value);
          stats.withTime += 1;
          if (time.range) {
            stats.timeRanges += 1;
            entry.timeFromRange = true;
          }
        }
      }
      sheets.push(stats);
    }
  }

  const entries = new Map<string, JobEntry>();
  const duplicates: JobOpeningIndex["duplicates"] = [];
  for (const a of acc.values()) {
    const service = fieldValue(a.values.service, a.problems.service);
    let time = fieldValue(a.values.time, a.problems.time);
    // เวลาผูกกับวันที่บริการ (ข้อ 5)
    if (service.conflict && time.value !== null) time = { value: null, conflict: true, hadProblem: time.hadProblem };
    const e: JobEntry = {
      contractNo: a.contractNo,
      occurrences: a.occurrences,
      branchText: a.branchText,
      mail: fieldValue(a.values.mail, a.problems.mail),
      service,
      time,
      timeFromRange: a.timeFromRange,
    };
    entries.set(a.contractNo, e);
    if (a.occurrences.length > 1) {
      duplicates.push({
        contractNo: a.contractNo,
        occurrences: a.occurrences,
        conflictFields: (["mail", "service", "time"] as const).filter((f) => e[f].conflict),
      });
    }
  }
  return { entries, sheets, sheetsSkipped, problems, duplicates };
}
