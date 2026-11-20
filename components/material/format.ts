/** ตัวช่วยจัดรูปแบบตัวเลขของหน้า /material (ตัวเลขอารบิก เหมือน mockup) */

const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DEC1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function fmtInt(n: number): string {
  return INT.format(Math.round(n));
}

export function fmtDec1(n: number): string {
  return DEC1.format(n);
}

/** ชั่วโมงทศนิยม 1 ตำแหน่ง */
export function fmtHours(minutes: number): string {
  return DEC1.format(minutes / 60);
}

/** +4% / -3% / 0% · null = "—" (ไม่มีเดือนก่อนให้เทียบ) */
export function fmtPct(p: number | null): string {
  if (p === null) return "—";
  return `${p > 0 ? "+" : ""}${p}%`;
}
