/**
 * กราฟ 2 ตัวของหน้า Dashboard งานขาย — ทำด้วย HTML/CSS ล้วน (ไม่เพิ่ม dependency · ตัวหนังสือจริง ≥12px ทุกขนาดจอ)
 *
 *   * MonthlyChart: แท่งซ้อนรายเดือน (จำนวนราย) New ล่าง / Renew บน · ตัวเลขรวมเหนือแท่ง
 *   * ZoneChart: แท่งแนวนอนซ้อนแยกเขต (มูลค่า) · ตัวเลขมูลค่าท้ายแท่ง
 *   * ประเภทที่ไม่ได้เลือก (type) จะไม่ถูกวาดและหายจาก legend — ข้อมูลที่ส่งมาถูกกรองประเภทแล้วจาก buildSalesView
 *   * เข้าถึงได้: ทุกแท่งมี title + มีตารางข้อมูลซ่อน (sr-only) ให้โปรแกรมอ่านหน้าจอ
 */
import { cx } from "@/components/ui";

import { formatMoney, formatMoneyShort, monthName } from "./salesFormat";
import { CARD_CLASS, NEW_BG, RENEW_BG } from "./salesStyle";
import type { MonthSales, ZoneSales } from "./salesTypes";
import type { SalesTypeFilter } from "./salesView";

function Legend({ type }: { type: SalesTypeFilter }) {
  return (
    <div className="mb-2 flex flex-wrap gap-3.5 text-[13px] text-fg-muted">
      {type !== "renew" && (
        <span>
          <i className={cx("mr-1.5 inline-block size-[11px] rounded-[3px] align-[-1px]", NEW_BG)} />
          New
        </span>
      )}
      {type !== "new" && (
        <span>
          <i className={cx("mr-1.5 inline-block size-[11px] rounded-[3px] align-[-1px]", RENEW_BG)} />
          Renew
        </span>
      )}
    </div>
  );
}

const typeText = (t: SalesTypeFilter) => (t === "all" ? "New กับ Renew" : t === "new" ? "New" : "Renew");

export function MonthlyChart({ months, type }: { months: readonly MonthSales[]; type: SalesTypeFilter }) {
  const totals = months.map((m) => m.newCount + m.renewCount);
  const max = Math.max(1, ...totals);
  const dense = months.length > 6;
  return (
    <div className={CARD_CLASS}>
      <h2 className="m-0 text-[15px] font-semibold">แนวโน้มรายเดือน</h2>
      <p className="mb-2.5 mt-0.5 text-[12.5px] text-fg-muted">จำนวนราย {typeText(type)} · นับตามเดือนที่รับ Mail</p>
      <Legend type={type} />
      <div className="flex h-[230px] items-end gap-1.5 border-b border-border pt-6" role="img" aria-label={`กราฟแท่งแนวโน้มรายเดือน จำนวนราย ${typeText(type)}`}>
        {months.map((m, i) => (
          <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="text-center text-[12px] font-semibold tabular-nums text-fg">{totals[i] || ""}</div>
            <div className="flex w-full flex-col justify-end" style={{ height: `${(totals[i]! / max) * 82}%` }}>
              {type !== "new" && m.renewCount > 0 && (
                <div className={cx("w-full rounded-t-[3px]", RENEW_BG)} style={{ flex: m.renewCount }} title={`Renew ${m.renewCount} ราย`} />
              )}
              {type !== "renew" && m.newCount > 0 && (
                <div className={cx("w-full", NEW_BG, type === "new" && "rounded-t-[3px]")} style={{ flex: m.newCount }} title={`New ${m.newCount} ราย`} />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-[12px] text-fg-muted">
        {months.map((m) => (
          <div key={m.month} className="min-w-0 flex-1 text-center leading-tight">
            {monthName(m.month)}
            {(!dense || m.month.endsWith("-01")) && <div className="text-[12px]">{m.month.slice(0, 4)}</div>}
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>จำนวนราย รายเดือน</caption>
        <thead>
          <tr>
            <th>เดือน</th>
            <th>New</th>
            <th>Renew</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <td>{m.month}</td>
              <td>{m.newCount}</td>
              <td>{m.renewCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ZoneChart({ zones, type }: { zones: readonly ZoneSales[]; type: SalesTypeFilter }) {
  const totalOf = (z: ZoneSales) => (type === "new" ? z.newValue : type === "renew" ? z.renewValue : z.newValue + z.renewValue);
  const max = Math.max(1, ...zones.map(totalOf));
  return (
    <div className={CARD_CLASS}>
      <h2 className="m-0 text-[15px] font-semibold">แยกตามเขต</h2>
      <p className="mb-2.5 mt-0.5 text-[12.5px] text-fg-muted">มูลค่า (บาท) {typeText(type)}</p>
      <Legend type={type} />
      {zones.length === 0 ? (
        <p className="py-6 text-center text-fg-muted">ไม่มีงานตามตัวกรองนี้</p>
      ) : (
        <ul className="m-0 grid list-none gap-2.5 p-0" aria-label={`มูลค่าแยกตามเขต ${typeText(type)}`}>
          {zones.map((z) => (
            <li key={z.zoneId} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]">
              <span className="text-fg-muted">{z.zoneName}</span>
              <div className="flex h-6 overflow-hidden rounded-[3px] bg-surface-3" style={{ width: `${Math.max(4, (totalOf(z) / max) * 100)}%` }}>
                {type !== "renew" && z.newValue > 0 && <div className={NEW_BG} style={{ flex: z.newValue }} title={`New ${formatMoney(z.newValue)} บาท`} />}
                {type !== "new" && z.renewValue > 0 && <div className={RENEW_BG} style={{ flex: z.renewValue }} title={`Renew ${formatMoney(z.renewValue)} บาท`} />}
              </div>
              <span className="font-semibold tabular-nums">{formatMoneyShort(totalOf(z))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
