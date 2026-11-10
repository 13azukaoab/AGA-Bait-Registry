const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

/** 'YYYY-MM' → 'MMM.YY' เช่น '2026-09' → 'SEP.26' (รูปแบบ key ของ dashboard_data.json) */
export function monthKey(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const name = MONTHS[m - 1];
  if (!name) throw new Error(`monthKey: เดือนไม่ถูกต้อง (${month})`);
  return `${name}.${String(y).slice(-2)}`;
}
