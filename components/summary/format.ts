/** ตัวช่วยจัดรูปแบบตัวเลขของหน้า Dashboard สรุป (ตัวเลขอารบิก เหมือน mockup) */

const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DEC1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DEC2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatInt(n: number): string {
  return INT.format(Math.round(n));
}

/** มูลค่าแบบย่อ: ฿166.77M · ฿850.5K · ฿420 */
export function formatBahtShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}฿${DEC2.format(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}฿${DEC1.format(abs / 1_000)}K`;
  return `${sign}฿${INT.format(abs)}`;
}

/** อัตราเปลี่ยนแปลง: +0.4% / -1.2% / 0.0% */
export function formatPct(p: number): string {
  const rounded = Math.round(p * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${DEC1.format(rounded)}%`;
}

/** สัดส่วนไม่ติดเครื่องหมาย: 83.3% */
export function formatShare(p: number): string {
  return `${DEC1.format(p)}%`;
}
