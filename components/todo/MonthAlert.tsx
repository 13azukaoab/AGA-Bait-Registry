"use client";

/**
 * MonthAlert — กล่องเตือน "เข้าเดือนใหม่แล้วแต่ยังปิดงานเดือนก่อนไม่เสร็จ" (เจ้าของสั่ง 14 พ.ย. 2026)
 * แสดงครั้งเดียวต่อการเปิดหน้านี้ (state ใน TodoClient) · ปุ่ม "ไปกรอกข้อมูลต่อ" พาไป /service ของเดือนที่ค้าง
 */
import Link from "next/link";
import { useId } from "react";

import { Button } from "@/components/ui";
import { monthLabel } from "@/lib/service/months";

import { Dialog } from "./Dialog";

export function MonthAlert({
  month,
  currentMonth,
  unfilled,
  pending,
  onClose,
}: {
  month: string;
  currentMonth: string;
  unfilled: number;
  pending: number;
  onClose: () => void;
}) {
  const id = useId();
  return (
    <Dialog titleId={`${id}-t`} onClose={onClose}>
      <div className="px-4 py-3">
        <h2 id={`${id}-t`} className="m-0 flex items-center gap-2 text-base font-semibold text-warn">
          <svg viewBox="0 0 24 24" aria-hidden className="size-5 shrink-0 fill-none stroke-current stroke-2">
            <path d="M12 3l10 18H2L12 3z" />
            <path d="M12 10v5M12 18h.01" />
          </svg>
          ยังปิดงานเดือน {monthLabel(month)} ไม่เสร็จ
        </h2>
        <p className="m-0 mt-2 text-[13px]">
          ตอนนี้เข้าเดือน <b>{monthLabel(currentMonth)}</b> แล้ว แต่เดือน <b>{monthLabel(month)}</b> ยังไม่ได้ปิด หน้านี้จึงยังแสดงข้อมูลของเดือน {monthLabel(month)}
        </p>
        <ul className="m-0 mt-2 pl-5 text-[13px]">
          <li>
            ยังไม่กรอกข้อมูล <b>{unfilled}</b> ราย
          </li>
          <li>
            ตกบริการรอตัดสิน <b>{pending}</b> ราย
          </li>
        </ul>
        <p className="m-0 mt-2 text-xs text-fg-muted">กรอกให้ครบแล้วปิดเดือน หน้านี้จะเลื่อนไปเดือนถัดไปเอง</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Link href="/admin/closure" className="mr-auto inline-flex min-h-11 items-center text-[13px] text-accent underline md:min-h-10">
          ไปหน้าปิดเดือน
        </Link>
        <Button className="max-md:min-h-11" onClick={onClose}>
          ไว้ทีหลัง
        </Button>
        <Link
          href={`/service?month=${month}`}
          onClick={onClose}
          className="inline-flex min-h-10 items-center rounded-md border border-accent bg-accent px-3.5 py-2 text-[13px] text-accent-fg hover:bg-accent-strong max-md:min-h-11"
        >
          ไปกรอกข้อมูลต่อ
        </Link>
      </div>
    </Dialog>
  );
}
