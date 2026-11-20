/**
 * อันดับผู้ขาย (sale_name) และยอดรายสาขา (mockup FINAL ?v=b)
 *
 * Logic summary:
 *   * ข้อมูลเรียงตามมูลค่าของประเภทที่เลือกมาแล้วจาก buildSalesView · แถบกว้างตามสัดส่วนของอันดับ 1
 *   * เลือก "ทั้งหมด" แถบแบ่งสอง (New น้ำเงิน / Renew ม่วง) · เลือกประเภทเดียวแถบเหลือสีเดียวเอง (อีกประเภทเป็น 0)
 *   * ข้อความใต้ชื่อ: ทั้งหมด = "New x / Renew y" · เลือกประเภท = จำนวนของประเภทนั้นอย่างเดียว · ป้ายล่าช้าไม่แสดงตอนเลือก New
 *   * ผู้ขายที่ไม่มีชื่อ (sale_name ว่าง) แสดงเป็น "ไม่ระบุผู้ขาย"
 */
import { cx } from "@/components/ui";

import { formatMoneyShort } from "./salesFormat";
import { CARD_CLASS, NEW_BG, RENEW_BG } from "./salesStyle";
import type { BranchSales, SellerSales } from "./salesTypes";
import type { SalesTypeFilter } from "./salesView";

interface RankItem {
  key: string;
  name: string;
  meta: string;
  late: number;
  newValue: number;
  renewValue: number;
}

function valueOf(i: RankItem) {
  return i.newValue + i.renewValue;
}

function metaFor(type: SalesTypeFilter, t: { newCount: number; renewCount: number }, prefix = ""): string {
  const counts = type === "new" ? `${t.newCount} ราย` : type === "renew" ? `${t.renewCount} ราย` : `New ${t.newCount} / Renew ${t.renewCount}`;
  return `${prefix}${counts}`;
}

function RankCard({ title, hint, items, showLate }: { title: string; hint: string; items: RankItem[]; showLate: boolean }) {
  const max = Math.max(1, ...items.map(valueOf));
  return (
    <div className={CARD_CLASS}>
      <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
      <p className="mb-2.5 mt-0.5 text-[12.5px] text-fg-muted">{hint}</p>
      {items.length === 0 ? (
        <p className="py-6 text-center text-fg-muted">ไม่มีงานตามตัวกรองนี้</p>
      ) : (
        <ol className="m-0 grid list-none gap-2 p-0">
          {items.map((it, idx) => (
            <li key={it.key} className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5">
              <span
                className={cx(
                  "grid size-[26px] place-items-center rounded-full text-[12.5px] font-bold",
                  idx === 0 ? "bg-accent text-accent-fg" : "bg-surface-3 text-fg",
                )}
              >
                {idx + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap justify-between gap-x-2 text-[14px] font-semibold">
                  <span className="min-w-0 break-words">{it.name}</span>
                  <span className="text-[12.5px] font-normal text-fg-muted">
                    {it.meta}
                    {showLate && it.late > 0 && (
                      <>
                        {" · "}
                        <b className="text-danger">ล่าช้า {it.late}</b>
                      </>
                    )}
                  </span>
                </div>
                <div className="mt-0.5 flex h-2 overflow-hidden rounded bg-surface-3" style={{ width: `${Math.max(6, (valueOf(it) / max) * 100)}%` }}>
                  {it.newValue > 0 && <i className={NEW_BG} style={{ flex: it.newValue }} />}
                  {it.renewValue > 0 && <i className={RENEW_BG} style={{ flex: it.renewValue }} />}
                </div>
              </div>
              <div className="text-right text-[14px] font-bold tabular-nums">{formatMoneyShort(valueOf(it))}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const valueText = (t: SalesTypeFilter) => (t === "all" ? "รวม" : t === "new" ? " New" : " Renew");
const barText = (t: SalesTypeFilter) => (t === "all" ? "แถบ = สัดส่วน New / Renew" : "แถบสีเดียว");

export function SellerRank({ sellers, type, showLate }: { sellers: readonly SellerSales[]; type: SalesTypeFilter; showLate: boolean }) {
  const items: RankItem[] = sellers.map((s) => ({
    key: s.name || "__none__",
    name: s.name || "ไม่ระบุผู้ขาย",
    meta: metaFor(type, s),
    late: s.lateCount,
    newValue: s.newValue,
    renewValue: s.renewValue,
  }));
  return <RankCard title="อันดับผู้ขาย" hint={`เรียงตามมูลค่า${valueText(type)} (sale_name) · ${barText(type)}`} items={items} showLate={showLate} />;
}

export function BranchRank({ branches, type, showLate }: { branches: readonly BranchSales[]; type: SalesTypeFilter; showLate: boolean }) {
  const items: RankItem[] = branches.map((b) => ({
    key: b.branchId,
    name: b.branchName,
    meta: metaFor(type, b, `${b.zoneName} · `),
    late: b.lateCount,
    newValue: b.newValue,
    renewValue: b.renewValue,
  }));
  return <RankCard title="ยอดรายสาขา" hint={`เรียงตามมูลค่า${valueText(type)} · ${barText(type)}`} items={items} showLate={showLate} />;
}
