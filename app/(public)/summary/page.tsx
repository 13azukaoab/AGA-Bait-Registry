/**
 * SPEC §8 จอ 13 — Dashboard สรุปมูลค่าทั้งหมด (ส่วน public)
 *
 * - เปิดได้โดยไม่ล็อกอิน (viewer) · แสดงตัวเลขรายสาขา/เขตเท่านั้น ไม่มีข้อมูลรายลูกค้า (PDPA)
 * - อ่านข้อมูลด้วยสิทธิ์ anon จาก v_branch_summary (ดู ./data.ts)
 * - ตารางยังว่าง → แสดงหน้าว่าง "ยังไม่มีข้อมูล" (ไม่มีตัวเลขสมมติ)
 * - ยังไม่ทำ: หัวข้อย่อย internal (สถิติกล่อง AG / สรุปการใช้เหยื่อ / สถานี IG-IC) — รอบถัดไป
 * - dynamic: ดึงข้อมูลสดทุกครั้ง กันแคชผลว่าง/ผิดพลาดค้าง
 */
import type { Metadata } from "next";

import { PublicHeader } from "@/components/summary/PublicHeader";
import { SummaryDashboard } from "@/components/summary/SummaryDashboard";
import { ThemeScript } from "@/components/shell/ThemeScript";
import { Alert } from "@/components/ui/Alert";

import { loadSummaryRows } from "./data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "สรุปมูลค่าระบบเหยื่อ · AGA",
  description: "Dashboard สรุปมูลค่าและจำนวนลูกค้าระบบเหยื่อ รายสาขา/เขต — Advance Group Asia (AGA)",
};

export default async function SummaryPage() {
  const result = await loadSummaryRows();

  return (
    <>
      <ThemeScript />
      <PublicHeader />
      <main id="content" className="mx-auto max-w-[1280px] px-4 pt-5 pb-10 min-[601px]:px-6">
        {!result.ok ? (
          <Alert variant="danger" title="โหลดข้อมูลสรุปไม่สำเร็จ">
            {result.reason === "config"
              ? "ระบบยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล กรุณาแจ้งผู้ดูแลระบบ"
              : "ขณะนี้ดึงข้อมูลสรุปไม่ได้ กรุณาลองรีเฟรชหน้านี้อีกครั้งในอีกสักครู่ หากยังไม่หายให้แจ้งผู้ดูแลระบบ"}
          </Alert>
        ) : result.rows.length === 0 ? (
          <div>
            <h1 className="m-0 text-[22px] font-bold text-fg max-[600px]:text-xl">สรุปมูลค่าระบบเหยื่อ</h1>
            <div className="mt-4 rounded-xl border border-border bg-surface px-6 py-12 text-center shadow-[var(--shadow)]">
              <div
                aria-hidden="true"
                className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-surface-3 text-2xl text-fg-faint"
              >
                ▦
              </div>
              <p className="m-0 text-base font-semibold text-fg">ยังไม่มีข้อมูลเดือนนี้</p>
              <p className="mx-auto mt-1.5 mb-0 max-w-[460px] text-[13px] text-fg-muted">
                ตัวเลขสรุปมูลค่ารายสาขาจะแสดงที่นี่ เมื่อมีการบันทึกและสรุปข้อมูลประจำเดือนเข้าระบบแล้ว
              </p>
            </div>
          </div>
        ) : (
          <SummaryDashboard rows={result.rows} />
        )}
      </main>
    </>
  );
}
