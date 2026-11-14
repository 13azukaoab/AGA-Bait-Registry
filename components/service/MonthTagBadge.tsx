/**
 * ป้าย "New เดือนนี้" / "Renew เดือนนี้" ในรายชื่อลูกค้า (mockup #service FINAL · DECISIONS 2.38 ค)
 * New = ขอบสี accent · Renew = ขอบสีเขียว — ใช้ token ของระบบ ไม่มี hex
 */
import { cx } from "@/components/ui/cx";

import type { ContractMonthTag } from "./types";

export function MonthTagBadge({ tag }: { tag: Exclude<ContractMonthTag, null> }) {
  return (
    <span
      className={cx(
        "mt-0.5 inline-block whitespace-nowrap rounded-[5px] border bg-transparent px-[7px] text-[11px] font-semibold",
        tag === "new" ? "border-accent text-accent-strong" : "border-ok text-ok",
      )}
    >
      {tag === "new" ? "New" : "Renew"} เดือนนี้
    </span>
  );
}
