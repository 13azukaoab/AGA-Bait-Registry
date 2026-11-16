/**
 * กฎ Renew ของหน้าเปิดงาน (M28 · DECISIONS 2.51) — pure function เทสได้ ไม่แตะ DB
 *
 * Logic summary:
 *   * Renew ที่ผูกสัญญาเก่า: วันเริ่มสัญญาใหม่ต้องอยู่ในช่วง "เดือนจบสัญญาเก่า + 2 เดือน" และหลังวันเริ่มสัญญาเก่า
 *     → ตัดสินด้วย `renewalGapOk` / `latestRenewStartMonth` ของ `lib/rules` (ห้ามเขียนสูตรซ้ำที่นี่)
 *     เกินช่วง = ล็อก Renew (บล็อกการบันทึก + ปิดตัวเลือกในกล่องค้นสัญญาเก่า) แล้วบอกให้เปิดเป็น New
 *   * Renew ที่ไม่ผูกสัญญาเก่า: เปิดได้เฉพาะช่วงแรกหลังเปิดระบบ (`RenewPolicy.unlinkedOpen` จาก RPC
 *     `unlinked_renew_open()`) และ **ต้องมีเหตุผล** — หลังพ้นช่วง = ต้องผูกสัญญาเก่า หรือเปิดเป็น New
 *   * โหมดแก้: ไม่ตรวจกฎเปิดใหม่ซ้ำ (แถวเดิมที่เปิดไว้ก่อนหน้าแก้ช่องอื่นต่อได้ — DB ก็ยกเว้นให้) · ตัวบังคับจริงคือ DB
 *     (AG010–AG014) หน้านี้ตรวจก่อนเพื่อไม่ให้ผู้ใช้เสียเวลากดบันทึกแล้วเพิ่งรู้
 */
import { latestRenewStartMonth, renewalGapOk } from "@/lib/rules";
import { monthLabel } from "@/lib/service/months";

import type { DraftRow, RenewalLink, RenewPolicy } from "./types";

/** ข้อความผิดพลาดของช่อง Renew (ว่าง = ผ่าน) */
export interface RenewErrors {
  /** ช่องผูกสัญญาเก่า / ช่วงเวลา Renew */
  renewLink?: string;
  /** ช่องเหตุผล (Renew ไม่ผูก) */
  renewReason?: string;
}

/** นโยบายเริ่มต้นของเทส/โค้ดที่ไม่ส่งมา — เปิด (ไม่บล็อกเอง · DB ตัดสินซ้ำ) */
export const DEFAULT_RENEW_POLICY: RenewPolicy = { unlinkedOpen: true, unlinkedUntil: null };

/**
 * สัญญาเก่าใบนี้ต่อเป็น Renew ได้ไหมเมื่อสัญญาใหม่เริ่ม `startDate`
 * คืนข้อความเหตุผล (ไทยสั้นๆ) ถ้าต่อไม่ได้ · null = ต่อได้ / ตรวจไม่ได้ (ไม่มีวันที่สัญญาเก่า หรือยังไม่ใส่วันเริ่ม)
 */
export function renewGapBlockReason(link: RenewalLink, startDate: string): string | null {
  if (!link.oldDates || !startDate) return null;
  if (renewalGapOk(link.oldDates, startDate)) return null;
  if (startDate.slice(0, 10) <= link.oldDates.startDate.slice(0, 10)) {
    return "วันเริ่มสัญญาใหม่ต้องอยู่หลังวันเริ่มสัญญาเก่า — ตรวจวันที่ หรือเปิดเป็น New";
  }
  return `เริ่มเกิน 2 เดือนหลังสัญญาเก่าจบ (Renew ได้ถึง ${monthLabel(latestRenewStartMonth(link.oldDates))}) — ต้องเปิดเป็น New`;
}

/** ตรวจช่อง Renew ของแถว · `isEdit` = แถวที่บันทึกแล้ว (ไม่ตรวจกฎเปิดใหม่) */
export function checkRenewDraft(
  draft: Pick<DraftRow, "saleType" | "renewal" | "renewUnlinkedReason" | "startDate">,
  policy: RenewPolicy,
  isEdit: boolean,
): RenewErrors {
  if (draft.saleType !== "renew" || isEdit) return {};

  if (draft.renewal) {
    const reason = renewGapBlockReason(draft.renewal, draft.startDate);
    return reason ? { renewLink: reason } : {};
  }

  // Renew ไม่ผูกสัญญาเก่า
  if (!policy.unlinkedOpen) {
    return { renewLink: "ต้องผูกสัญญาเก่า (ช่วงเปิด Renew แบบไม่ผูกสิ้นสุดแล้ว) หรือเปิดเป็น New" };
  }
  if (draft.renewUnlinkedReason.trim() === "") {
    return { renewReason: "ใส่เหตุผลที่ไม่ผูกสัญญาเก่า" };
  }
  return {};
}

/**
 * แปลงผลของ RPC สองตัวเป็น `RenewPolicy` — อ่านไม่ได้/รูปแบบแปลก = ปิด (fail-closed · DB ตัดสินซ้ำตอนบันทึก)
 * ใช้ `unlinked_renew_open()` ตัดสิน (นาฬิกาเดียวกับที่ DB ใช้ตอนบันทึก) · วันกำหนดใช้แสดงข้อความอย่างเดียว
 */
export function parseRenewPolicy(
  open: { data: unknown; error: unknown },
  until: { data: unknown; error: unknown },
): RenewPolicy {
  const untilDate =
    !until.error && typeof until.data === "string" && /^\d{4}-\d{2}-\d{2}/.test(until.data)
      ? until.data.slice(0, 10)
      : null;
  return { unlinkedOpen: !open.error && open.data === true, unlinkedUntil: untilDate };
}
