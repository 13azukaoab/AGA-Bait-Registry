/**
 * อ่านเบอร์โทรจากช่อง "เบอร์โทรลูกค้า" ของทะเบียน → แถว customer_phones (M19a) — pure function
 * (เจ้าของเลือกให้นำเข้าเบอร์ · 19 พ.ย. 2026 ผ่านหมวด 4)
 *
 * Logic summary:
 *   1. แยกช่องเป็นส่วนด้วย / , ; → ในแต่ละส่วนหา "ชุดตัวเลข" (ตัวเลขต่อกันด้วย - . * เท่านั้น ไม่ข้ามช่องว่าง)
 *   2. ชุดตัวเลข ≥ 7 หลัก = เบอร์ ต้องถูกรูปแบบไทย (หลังตัดขีด):
 *        มือถือ 10 หลัก ขึ้นต้น 06 / 08 / 09 · บ้าน/สำนักงาน 9 หลัก ขึ้นต้น 02–07 · +66 / 66 นำหน้า → 0
 *      ชุดตัวเลข < 7 หลัก (เช่น "ต่อ 123") = ข้อความ เก็บรวมใน label
 *   3. **ผิดรูปแม้เบอร์เดียว = ทั้งช่องว่าง (invalid)** ไม่เดา ไม่เก็บเบอร์อื่นในช่องเดียวกัน · ไม่มีเบอร์เลย (มีแต่ข้อความ) = invalid
 *      ช่องที่เป็นตัวเลข Excel (number) = invalid (เลข 0 หน้าอาจหายไปแล้ว · ไม่เติมให้)
 *   4. เบอร์เก็บเป็นตัวเลขล้วน · ข้อความรอบเบอร์ (ชื่อ/หน้าที่ผู้ติดต่อ) → label (≤ 40 ตัว · ยาวเกิน = ไม่เก็บ label แต่เก็บเบอร์)
 *      ส่วนที่มีแต่ข้อความ → ไปเป็น label ของเบอร์ถัดไป (ไม่มีถัดไป = เบอร์ก่อนหน้า)
 *   5. เบอร์ซ้ำในช่องเดียวกัน เก็บครั้งเดียว (DB ห้ามเบอร์ซ้ำในลูกค้าเดียวกัน · CC003)
 *   ⚠ ผลลัพธ์มีเบอร์จริงและอาจมีชื่อผู้ติดต่อ (PDPA) — ห้าม log · รายงานใช้ summarizePhones (จำนวนเท่านั้น)
 */
import type { CellValue } from "./registrySheet";

export interface ParsedPhone {
  /** ตัวเลขล้วน 9–10 หลัก */
  phone: string;
  /** ชื่อ/หน้าที่ (customer_phones.label) · null = ไม่มี/ยาวเกิน */
  label: string | null;
}

export interface PhoneCellResult {
  status: "empty" | "ok" | "invalid";
  phones: ParsedPhone[];
  /** จำนวน label ที่ยาวเกิน 40 ตัว (ไม่เก็บ) — มีเฉพาะเมื่อ > 0 */
  labelTooLong?: number;
}

export interface PhoneSummary {
  rows: number;
  rowsWithPhones: number;
  phones: number;
  emptyRows: number;
  invalidRows: number;
  labelTooLong: number;
}

const LABEL_MAX = 40;
const MIN_PHONE_DIGITS = 7;
const RUN = /\d[\d\-.*]*\d|\d/g;
const SEPARATORS = /[/,;]/;

function normalizeDigits(run: string): string | null {
  let d = run.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("66")) d = `0${d.slice(2)}`;
  if (/^0[689]\d{8}$/.test(d)) return d;
  if (/^0[2-7]\d{7}$/.test(d)) return d;
  return null;
}

function cleanLabel(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s\-,/;:]+|[\s\-,/;:]+$/g, "")
    .trim();
}

const INVALID: PhoneCellResult = { status: "invalid", phones: [] };

/** อ่าน 1 ช่อง (ดู Logic summary หัวไฟล์) */
export function parseThaiPhones(cell: CellValue | undefined): PhoneCellResult {
  if (cell === null || cell === undefined || cell === "") return { status: "empty", phones: [] };
  if (typeof cell !== "string") return typeof cell === "number" ? INVALID : { status: "empty", phones: [] };
  const text = cell.replace(/\+66[\s-]*/g, "0").trim();
  if (text === "") return { status: "empty", phones: [] };

  const found: { phone: string; label: string }[] = [];
  let pendingText: string[] = [];
  for (const segment of text.split(SEPARATORS)) {
    const phonesHere: string[] = [];
    let rest = segment;
    for (const m of segment.match(RUN) ?? []) {
      if (m.replace(/\D/g, "").length < MIN_PHONE_DIGITS) continue; // เลขสั้น = ข้อความ (เช่น เบอร์ต่อ)
      const phone = normalizeDigits(m);
      if (!phone) return INVALID;
      phonesHere.push(phone);
      rest = rest.replace(m, " ");
    }
    const label = cleanLabel(rest);
    if (phonesHere.length === 0) {
      if (label) pendingText.push(label);
      continue;
    }
    const first = cleanLabel([...pendingText, label].join(" "));
    pendingText = [];
    phonesHere.forEach((phone, i) => found.push({ phone, label: i === 0 ? first : "" }));
  }
  if (found.length === 0) return INVALID;
  if (pendingText.length) {
    const last = found[found.length - 1]!;
    last.label = cleanLabel([last.label, ...pendingText].join(" "));
  }

  const seen = new Set<string>();
  let labelTooLong = 0;
  const phones: ParsedPhone[] = [];
  for (const f of found) {
    if (seen.has(f.phone)) continue;
    seen.add(f.phone);
    let label: string | null = f.label || null;
    if (label && label.length > LABEL_MAX) {
      labelTooLong++;
      label = null;
    }
    phones.push({ phone: f.phone, label });
  }
  return labelTooLong > 0 ? { status: "ok", phones, labelTooLong } : { status: "ok", phones };
}

/** สรุปเป็นจำนวน (ไม่มีเบอร์/ชื่อในผลลัพธ์) */
export function summarizePhones(results: readonly PhoneCellResult[]): PhoneSummary {
  return {
    rows: results.length,
    rowsWithPhones: results.filter((r) => r.status === "ok").length,
    phones: results.reduce((n, r) => n + r.phones.length, 0),
    emptyRows: results.filter((r) => r.status === "empty").length,
    invalidRows: results.filter((r) => r.status === "invalid").length,
    labelTooLong: results.reduce((n, r) => n + (r.labelTooLong ?? 0), 0),
  };
}
