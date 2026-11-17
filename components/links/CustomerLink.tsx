"use client";

/**
 * CustomerLink — ชื่อลูกค้าที่กดไปหน้ารายละเอียด `/customers/<id>` (ใช้ใน /todo · /service · /customers/new)
 *
 * Logic summary:
 *   * URL สร้างจาก lib/links/customerLink.ts จุดเดียว (query มีแค่ id/enum — ไม่มีชื่อ/เบอร์/ที่อยู่)
 *   * ไม่ให้ลิงก์ (แสดงเป็นข้อความธรรมดา) เมื่อ: role ส่งมาแล้วเข้า /customers ไม่ได้ · customerId ไม่ใช่ UUID
 *   * กันข้อมูลที่กรอกค้างหาย: คลิกธรรมดาแล้ว `hasUnsavedWork()` (ตัวเก็บกลาง M34) เป็นจริง → ยกเลิกการไปก่อน
 *     แล้วถามยืนยัน — ถ้าหน้ามีกล่องยืนยันของตัวเอง ส่ง `guardLeave` มาใช้ (เช่น /service) · ไม่ส่ง = `window.confirm`
 *     (ค่าเริ่มต้นปลอดภัย = ไม่ออก)
 *   * พื้นที่กดบนมือถือ ≥ 44px: เพิ่ม padding แนวตั้งแล้วหัก margin ออก (แถวไม่สูงขึ้น) — ชื่อในรายการยาวใช้ className truncate · ctrl/⌘/ชิฟต์-คลิก, คลิกกลาง, target อื่น = เปิดแท็บใหม่ หน้านี้ไม่หาย ไม่ต้องถาม
 *   * ชื่อลูกค้าอยู่ใน data-clarity-mask="True" (M36 · ไม่ให้ session replay เห็นข้อมูลลูกค้า)
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

import { hasUnsavedWork } from "@/components/shell/unsaved-work";
import { canAccessPath } from "@/lib/auth/access";
import type { UserRole } from "@/lib/db/types";
import { customerDetailHref, type CustomerLinkContext } from "@/lib/links/customerLink";

export const LEAVE_CONFIRM_TEXT = "มีข้อมูลที่กรอกไว้แต่ยังไม่ได้บันทึก ถ้าไปหน้ารายละเอียดลูกค้าตอนนี้ข้อมูลที่กรอกไว้จะหายไป — ไปต่อไหม?";

export function CustomerLink({
  customerId,
  context,
  role,
  guardLeave,
  className,
  children,
}: {
  customerId: string | null | undefined;
  context?: CustomerLinkContext;
  /** ตำแหน่งผู้ใช้ — ส่งมาเพื่อซ่อนลิงก์ของ role ที่เข้า /customers ไม่ได้ (ไม่ส่ง = ผู้เรียกรับรองสิทธิ์เอง) */
  role?: UserRole;
  /** กล่องยืนยันของหน้านั้น: เรียก `go()` เมื่อผู้ใช้ยืนยันว่าจะออก */
  guardLeave?: (go: () => void) => void;
  /** เช่น "max-w-full truncate align-bottom" ในรายการที่ต้องตัดชื่อยาว */
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const href = customerDetailHref(customerId, context);
  const allowed = role === undefined || canAccessPath(role, "/customers");

  if (!href || !allowed) {
    return (
      <span className={className} data-clarity-mask="True">
        {children}
      </span>
    );
  }

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    // เปิดแท็บใหม่/คลิกกลาง = หน้านี้ยังอยู่ ไม่เสียข้อมูล
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!hasUnsavedWork()) return;
    e.preventDefault();
    const go = () => router.push(href as string);
    if (guardLeave) guardLeave(go);
    else if (window.confirm(LEAVE_CONFIRM_TEXT)) go();
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      data-clarity-mask="True"
      title="ดูรายละเอียดลูกค้า"
      className={`inline-block rounded-sm text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent max-md:-my-3 max-md:py-3 ${className ?? ""}`}
    >
      {children}
    </Link>
  );
}
