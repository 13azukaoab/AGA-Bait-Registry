/**
 * การ์ดสรุป 4 ใบบนสุด: New · Renew · ต่อสัญญาล่าช้า · รวมทั้งหมด (mockup FINAL ?v=b)
 *
 * Logic summary:
 *   * แสดงครบเสมอ ไม่กรองตามประเภทที่เลือก — แค่ไฮไลต์กรอบการ์ดของประเภทที่เลือก (`highlight`)
 *   * เลือก New → การ์ดต่อสัญญาล่าช้าจางลง (ล่าช้าเป็นของ Renew เท่านั้น) · ข้อความ "ล่าช้า" ยังอ่านได้ ไม่พึ่งสีอย่างเดียว
 */
import { cx } from "@/components/ui";

import { formatMoney } from "./salesFormat";
import { NEW_BORDER_L, NEW_RING, RENEW_BORDER_L, RENEW_RING } from "./salesStyle";
import type { SalesView } from "./salesView";

export function SalesKpis({ kpis, highlight }: { kpis: SalesView["kpis"]; highlight: SalesView["highlight"] }) {
  const pct = Math.round(kpis.lateShareOfRenew * 100);
  const base = "rounded-[10px] border border-border border-l-4 bg-surface px-4 py-3.5 shadow-[var(--shadow)]";
  return (
    <div className="mb-3.5 grid grid-cols-4 gap-3 max-[1000px]:grid-cols-2">
      <Card
        className={cx(base, NEW_BORDER_L, highlight === "new" && cx("ring-2", NEW_RING))}
        label="งานใหม่ (New)"
        value={kpis.newCount}
        sub={`มูลค่า ${formatMoney(kpis.newValue)} บาท`}
      />
      <Card
        className={cx(base, RENEW_BORDER_L, highlight === "renew" && cx("ring-2", RENEW_RING))}
        label="ต่อสัญญา (Renew)"
        value={kpis.renewCount}
        sub={`มูลค่า ${formatMoney(kpis.renewValue)} บาท`}
      />
      <Card
        className={cx(base, "border-l-danger bg-danger-soft text-danger", highlight === "new" && "opacity-55")}
        label="ต่อสัญญาล่าช้า"
        value={kpis.lateCount}
        sub={`${pct}% ของ Renew · ${formatMoney(kpis.lateValue)} บาท`}
        subTone="text-danger"
      />
      <Card
        className={cx(base, "border-l-border-strong")}
        label="รวมทั้งหมด"
        value={kpis.newCount + kpis.renewCount}
        sub={`มูลค่า ${formatMoney(kpis.newValue + kpis.renewValue)} บาท`}
      />
    </div>
  );
}

function Card({ className, label, value, sub, subTone = "text-fg-muted" }: { className: string; label: string; value: number; sub: string; subTone?: string }) {
  return (
    <div className={className}>
      <div className="text-[13px] opacity-80">{label}</div>
      <div className="text-[28px] font-bold leading-tight tabular-nums max-[767px]:text-2xl">
        {value.toLocaleString("th-TH")} <small className="text-[14px] font-medium opacity-70">ราย</small>
      </div>
      <div className={cx("text-[13px]", subTone)}>{sub}</div>
    </div>
  );
}
