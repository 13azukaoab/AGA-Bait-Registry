/** คืน {y,m,d} จาก 'YYYY-MM-DD' (เลขล้วน ไม่พึ่ง timezone) */
function parse(iso: string): { y: number; m: number; d: number } {
  return {
    y: Number(iso.slice(0, 4)),
    m: Number(iso.slice(5, 7)),
    d: Number(iso.slice(8, 10)),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** จำนวนวันของเดือน (month 1–12) */
function daysInMonth(y: number, month: number): number {
  return new Date(Date.UTC(y, month, 0)).getUTCDate();
}

/**
 * M30 (DECISIONS 2.53): วันสิ้นสุดอัตโนมัติ = วันเริ่ม + N เดือน − 1 วัน **ชนปลายเดือน**
 * - วันที่ของวันเริ่ม > จำนวนวันของเดือนปลายทาง → จบวันสุดท้ายของเดือนปลายทาง (31 ม.ค. + 1 เดือน → 28 ก.พ.)
 * - ไม่งั้น = วันเดียวกันในเดือนปลายทาง − 1 วัน (15 ม.ค. + 5 เดือน → 14 มิ.ย.)
 * ใช้กฎเดียวกันกับ 1 ปี / 3 ปี (ผลเท่าสูตรปีเดิมทุกวัน — 29 ก.พ. + 12 เดือน → 28 ก.พ.)
 * ตรงกับ SQL `contract_default_end_date` (20261115200000_term_months.sql) — แก้ฝั่งหนึ่งต้องแก้อีกฝั่ง
 * คิดด้วยเลขล้วน ไม่ใช้ Date.UTC บวกเดือนตรงๆ (ล้นเดือน: 31 ม.ค. + 1 → 3 มี.ค.)
 */
export function addMonthsMinusDay(startIso: string, months: number): string {
  if (!Number.isInteger(months) || months < 1) {
    throw new Error(`addMonthsMinusDay: months must be a positive integer (got ${months})`);
  }
  const { y, m, d } = parse(startIso);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const last = daysInMonth(ty, tm);
  if (d > last) return `${ty}-${pad(tm)}-${pad(last)}`;
  if (d > 1) return `${ty}-${pad(tm)}-${pad(d - 1)}`;
  // วันที่ 1 → วันสุดท้ายของเดือนก่อนเดือนปลายทาง
  const py = tm === 1 ? ty - 1 : ty;
  const pm = tm === 1 ? 12 : tm - 1;
  return `${py}-${pad(pm)}-${pad(daysInMonth(py, pm))}`;
}

/**
 * วันเริ่ม + N ปี − 1 วัน → 'YYYY-MM-DD'
 * @deprecated M30 — ใช้ `addMonthsMinusDay(start, months)` · คงไว้ให้ผู้เรียกเดิมที่ส่ง "ปี" (= เดือน × 12)
 */
export function addYearsMinusDay(startIso: string, years: number): string {
  return addMonthsMinusDay(startIso, years * 12);
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Bangkok = UTC+7 ตลอดปี (ไม่มี DST)

/**
 * เดือน 'YYYY-MM' จากค่าวันที่/เวลาทุกรูปแบบที่มาจาก DB หรือหน้าจอ
 * - 'YYYY-MM' · 'YYYY-MM-DD' (รวม 'YYYY-MM-01' ของคอลัมน์เดือน) → ตัด 7 ตัวแรก
 * - timestamptz ที่มี offset ('…Z' · '…+00:00' · '… +07' ของ Postgres) → แปลงเป็นเวลาไทยก่อน
 * - เวลาที่ไม่มี offset ถือว่าเป็นเวลาไทยอยู่แล้ว
 */
export function monthOf(iso: string): string {
  const t = iso.trim();
  const offset = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
  let month: string;
  if (t.length <= 10 || !offset.test(t)) {
    month = t.slice(0, 7);
  } else {
    const normalised = t.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
    const ms = Date.parse(normalised);
    month = Number.isNaN(ms) ? "" : new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 7);
  }
  // ค่าเพี้ยนต้องไม่ไหลไปเทียบ string แบบเงียบๆ
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`monthOf: invalid date/month value "${iso}"`);
  }
  return month;
}

/** ไล่เดือนต่อเนื่อง count เดือนจาก startMonth ('YYYY-MM') */
export function listMonths(startMonth: string, count: number): string[] {
  const y = Number(startMonth.slice(0, 4));
  const m = Number(startMonth.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const total = m - 1 + i;
    const yy = y + Math.floor(total / 12);
    const mm = (total % 12) + 1;
    out.push(`${yy}-${pad(mm)}`);
  }
  return out;
}
