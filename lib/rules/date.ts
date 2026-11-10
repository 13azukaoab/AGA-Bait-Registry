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

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
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
