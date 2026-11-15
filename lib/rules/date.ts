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

/** วันเริ่ม + N ปี − 1 วัน → 'YYYY-MM-DD' (ใช้ UTC เพื่อความแน่นอน) */
export function addYearsMinusDay(startIso: string, years: number): string {
  const { y, m, d } = parse(startIso);
  const t = Date.UTC(y + years, m - 1, d);
  const end = new Date(t - 24 * 60 * 60 * 1000);
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
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
