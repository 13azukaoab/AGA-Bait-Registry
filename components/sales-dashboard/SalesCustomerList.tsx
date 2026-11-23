"use client";

/**
 * รายชื่อลูกค้า/สัญญา แบบการ์ด (mockup FINAL ?v=b)
 *
 * Logic summary:
 *   * ชื่อลูกค้ากดได้ → /customers/<id> สร้างด้วย customerDetailHref (จุดเดียวของ URL นี้ · มีแต่ id/enum ไม่มีชื่อ — PDPA)
 *   * ชิป: "ทั้งหมด" และ "ต่อสัญญาล่าช้า" (ซ่อนตอนเลือก New เพราะล่าช้าเป็นของ Renew เท่านั้น)
 *   * ต่อสัญญาล่าช้า: วันที่รับ Mail สีแดง + ไอคอน + ป้ายตัวหนังสือ "ล่าช้า" + tooltip "ต่อสัญญาล่าช้า" (title + โฟกัสได้ ไม่พึ่งสีอย่างเดียว)
 *   * แสดงทีละ 12 รายการ กด "แสดงเพิ่ม" ได้ (รายการมาจากข้อมูลที่โหลดไว้แล้ว ไม่ยิง query เพิ่ม)
 *   * ⚠ PDPA: ข้อมูลลูกค้า ห้าม console.log
 */
import Link from "next/link";
import { useState } from "react";

import { Button, cx } from "@/components/ui";
import { customerDetailHref, customerLinkContexts } from "@/lib/links/customerLink";

import { formatDate, formatMoney } from "./salesFormat";
import { CARD_CLASS, NEW_SOFT, NEW_TEXT, RENEW_SOFT, RENEW_TEXT } from "./salesStyle";
import type { SalesRow } from "./salesTypes";
import type { ListChip } from "./salesView";

const PAGE = 12;

function LateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mr-1 inline align-[-2px]">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export interface SalesCustomerListProps {
  rows: readonly SalesRow[];
  chip: ListChip;
  onChipChange: (c: ListChip) => void;
  showLate: boolean;
}

export function SalesCustomerList({ rows, chip, onChipChange, showLate }: SalesCustomerListProps) {
  // เปลี่ยนตัวกรอง (รายการเปลี่ยน) → เริ่มนับหน้าใหม่ · ใช้ key จากชุดตัวกรองที่ตัวแม่ส่งมาเป็นตัวรีเซ็ต
  const [shown, setShown] = useState(PAGE);
  const visible = rows.slice(0, shown);
  const chips: ReadonlyArray<{ value: ListChip; label: string }> = [
    { value: "all", label: "ทั้งหมด" },
    ...(showLate ? [{ value: "late" as const, label: "ต่อสัญญาล่าช้า" }] : []),
  ];

  return (
    <div className={CARD_CLASS}>
      <h2 className="m-0 text-[15px] font-semibold">รายชื่อลูกค้า</h2>
      <p className="mb-2.5 mt-0.5 text-[12.5px] text-fg-muted">กดชื่อเพื่อเปิดหน้าลูกค้า · {rows.length.toLocaleString("th-TH")} รายการ</p>
      <div role="group" aria-label="กรองรายชื่อ" className="mb-2.5 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={chip === c.value}
            onClick={() => {
              onChipChange(c.value);
              setShown(PAGE);
            }}
            className={cx(
              "min-h-9 rounded-full border px-3 text-[13px] max-[767px]:min-h-11",
              chip === c.value ? "border-accent bg-accent font-semibold text-accent-fg" : "border-border-strong bg-surface text-fg hover:bg-surface-2",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-fg-muted">ไม่พบงานตามตัวกรองนี้ — ลองขยายช่วงเดือน หรือกด &quot;ล้างตัวกรอง&quot;</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 max-[767px]:grid-cols-1">
          {visible.map((r) => {
            const href = customerDetailHref(r.customerId, customerLinkContexts.contract(r.contractId));
            const isNew = r.saleType === "new";
            return (
              <li
                key={r.contractId}
                className={cx(
                  "grid gap-1 rounded-[10px] border px-3 py-2.5",
                  r.isLate ? "border-danger bg-danger-soft" : "border-border bg-surface-2",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  {href ? (
                    <Link href={href} className="min-w-0 break-words font-semibold text-accent no-underline hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                      {r.customerName || "(ไม่มีชื่อ)"}
                    </Link>
                  ) : (
                    <span className="min-w-0 break-words font-semibold">{r.customerName || "(ไม่มีชื่อ)"}</span>
                  )}
                  <span className="flex shrink-0 gap-1">
                    <span className={cx("rounded-full px-2 py-px text-[12px] font-semibold", isNew ? cx(NEW_SOFT, NEW_TEXT) : cx(RENEW_SOFT, RENEW_TEXT))}>
                      {isNew ? "New" : "Renew"}
                    </span>
                    {r.isLate && <span className="rounded-full border border-danger bg-surface px-2 py-px text-[12px] font-semibold text-danger">ล่าช้า</span>}
                  </span>
                </div>
                <div className="text-[13px] text-fg-muted">
                  {r.branchName} · {r.zoneName}
                </div>
                <div className="text-[13px] text-fg-muted">
                  Sale: {r.saleName ?? "-"} · AM: {r.amName ?? "-"}
                </div>
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="text-fg-muted">
                    {r.dateSource === "start" ? "วันเริ่มสัญญา" : "รับ Mail"}{" "}
                    {r.isLate ? (
                      <span tabIndex={0} title="ต่อสัญญาล่าช้า" aria-label={`${formatDate(r.salesDate)} ต่อสัญญาล่าช้า`} className="cursor-help font-bold text-danger">
                        <LateIcon />
                        {formatDate(r.salesDate)}
                      </span>
                    ) : (
                      formatDate(r.salesDate)
                    )}
                  </span>
                  <span className="font-bold tabular-nums text-fg">{formatMoney(r.valueTotal)} บาท</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > shown && (
        <div className="mt-3 flex items-center justify-between gap-2 text-[13px] text-fg-muted">
          <span>
            แสดง {visible.length.toLocaleString("th-TH")} จาก {rows.length.toLocaleString("th-TH")} รายการ
          </span>
          <Button onClick={() => setShown((n) => n + PAGE)}>แสดงเพิ่ม</Button>
        </div>
      )}
    </div>
  );
}
