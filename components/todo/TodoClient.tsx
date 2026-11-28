"use client";

/**
 * TodoClient — หน้า "สถานะทะเบียนบริการ" (/todo · SPEC §8 ข้อ 2 · mockup FINAL `#todo`)
 *
 * Logic summary:
 *   * รับข้อมูลที่ server โหลดแล้ว (data.ts) · ส่วนที่ต้องโต้ตอบ = กล่องตกบริการ (ไม่ชดเชย / เปิดเรื่องกลับ) + กล่องเตือนเดือนค้าง
 *   * แต่ละกล่องใน data เป็น Section (ok / ไม่ ok) — กล่องที่โหลดไม่สำเร็จแสดง "โหลดส่วนนี้ไม่สำเร็จ ลองรีเฟรช" เฉพาะกล่องนั้น ไม่แสดงเป็น 0
 *   * หลังบันทึกสำเร็จ → router.refresh() ให้ server อ่านตัวเลขใหม่จากฐานข้อมูล (ไม่บวก/ลบตัวเลขเอง)
 *   * ข้อความผิดพลาดแปลเป็นไทยที่ logic.ts (describeTodoError) · สิทธิ์จริงบังคับที่ฐานข้อมูล
 *   * กล่องเตือนเดือนค้างแสดงครั้งเดียวต่อการเปิดหน้านี้ (state ในหน้า ไม่ใช้ storage) · ไม่เปิดขณะบทสอนทำงาน — เปิดเมื่อบทสอนจบ/ถูกข้าม
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/service/ConfirmDialog";
import { useTutorial } from "@/components/tutorial";
import { Alert, Toast } from "@/components/ui";
import type { UserRole } from "@/lib/db/types";
import { monthLabel } from "@/lib/service/months";
import { createClient } from "@/lib/supabase/client";

import type { TodoData } from "./data";
import { shouldShowMonthAlert, type ClosedMissed, type PendingMissed } from "./logic";
import { MissedBox } from "./MissedBox";
import { MonthAlert } from "./MonthAlert";
import { reopenMissedService, waiveMissedService } from "./rpc";
import { AgList, FailedCard, ListCard, ProgressCard, StatCards, UnfilledList } from "./SummaryCards";
import { WaiveDialog } from "./WaiveDialog";

export function TodoClient({ data, role }: { data: TodoData; role: UserRole }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [waiving, setWaiving] = useState<PendingMissed | null>(null);
  const [reopening, setReopening] = useState<ClosedMissed | null>(null);
  const [toast, setToast] = useState("");
  // alertDismissed = ผู้ใช้กด "ไว้ทีหลัง" แล้ว · กล่องจริงจะเปิดเมื่อบทสอนไม่ทำงาน (เหตุผล: ดู shouldShowMonthAlert)
  // สถานะบทสอนอ่านจาก TutorialProvider (อยู่ใน AppShell ครอบทุกหน้า) ไม่ต้องเพิ่มช่องทางใหม่
  const [alertDismissed, setAlertDismissed] = useState(false);
  const { snapshot: tour } = useTutorial();
  const alertOpen = shouldShowMonthAlert({ isBehind: data.isBehind, dismissed: alertDismissed, tourRunning: tour.running });
  const [reopenError, setReopenError] = useState<string | null>(null);
  // null = กล่องนั้นโหลดไม่สำเร็จ
  const progress = data.progress.ok ? data.progress.value.progress : null;
  const unfilled = data.progress.ok ? data.progress.value.unfilled : null;
  const pending = data.pending.ok ? data.pending.value : null;
  const closed = data.closed.ok ? data.closed.value : null;
  const agPending = data.agPending.ok ? data.agPending.value : null;
  const collect = data.collect.ok ? data.collect.value : null;

  async function submitWaive(reason: string, file: File | null): Promise<string | null> {
    if (!waiving) return "ไม่พบรายการ";
    const r = await waiveMissedService(supabase, {
      contractId: waiving.contractId,
      missedMonth: waiving.missedMonth,
      reason,
      file,
    });
    if (!r.ok) return r.error.message;
    setToast(`บันทึก “ไม่ชดเชย” ${monthLabel(waiving.missedMonth)} แล้ว`);
    setWaiving(null);
    router.refresh();
    return null;
  }

  async function confirmReopen() {
    if (!reopening) return;
    const target = reopening;
    const r = await reopenMissedService(supabase, { contractId: target.contractId, missedMonth: target.missedMonth });
    setReopening(null);
    if (!r.ok) {
      setReopenError(r.error.message);
      return;
    }
    setReopenError(null);
    setToast(`เปิดเรื่องกลับแล้ว — ${target.customerName} ตกบริการ ${monthLabel(target.missedMonth)} กลับเป็นรอตัดสิน`);
    router.refresh();
  }

  return (
    <div className="p-4 max-[640px]:p-3">
      <header className="mb-4">
        <h1 className="m-0 text-xl font-bold">สถานะทะเบียนบริการ</h1>
        <p className="m-0 mt-1 text-[13px] text-fg-muted">
          งานที่ต้องทำของเดือน — ความคืบหน้าการกรอกผล เรื่องตกบริการที่ต้องตัดสิน และกล่องเหยื่อรอถอด · สรุปรายทีมและลูกค้าใกล้หมดสัญญา ดูที่{" "}
          <Link href="/material" className="text-accent underline">
            หน้าสรุปงานบริการรายเดือน →
          </Link>
        </p>
      </header>

      {data.truncated ? (
        <Alert variant="warn" title="ตัวเลขความคืบหน้าอาจไม่ครบ" className="mb-4">
          มีสาขาที่มีสัญญามากเกินกว่าที่หน้านี้อ่านได้ในครั้งเดียว ตัวเลข “กรอกผลแล้ว / ทั้งหมด” อาจต่ำกว่าจริง — แจ้งผู้ดูแลระบบ
        </Alert>
      ) : null}
      {reopenError ? (
        <Alert variant="danger" title="เปิดเรื่องกลับไม่สำเร็จ" className="mb-4">
          {reopenError}
        </Alert>
      ) : null}

      {progress ? (
        <ProgressCard month={data.month} progress={progress} />
      ) : (
        <FailedCard title={`สถานะงานกรอกผล · ${monthLabel(data.month)}`} className="mb-4" />
      )}
      <StatCards missedCount={pending?.length ?? null} collect={collect} agPendingCount={agPending?.length ?? null} />
      <MissedBox pending={pending} closed={closed} role={role} currentMonth={data.currentMonth} onWaive={setWaiving} onReopen={(c) => setReopening(c)} />

      <div className="grid gap-4 md:grid-cols-2">
        <ListCard
          title="ยังไม่มีข้อมูล (ยังไม่กรอก)"
          count={progress?.remaining ?? 0}
          failed={!progress}
          tone="danger"
          empty="กรอกผลครบทุกรายแล้ว"
          footerHref={`/service?month=${data.month}`}
          footerLabel="เปิดหน้ากรอกผลบริการ →"
          note={(progress?.remaining ?? 0) > 10 ? "แสดง 10 รายแรก (เรียงตามชื่อ) · ดูทั้งหมดที่หน้ากรอกผลบริการ" : undefined}
        >
          <UnfilledList items={unfilled ?? []} role={role} />
        </ListCard>
        <ListCard
          title="กล่องเหยื่อรอถอด"
          count={agPending?.length ?? 0}
          failed={!agPending}
          tone="accent"
          empty="ไม่มีกล่องเหยื่อรอถอด"
          footerHref="/bait"
          footerLabel="ดูกล่องติดตามผลทั้งหมด →"
          note={(agPending?.length ?? 0) > 10 ? "แสดง 10 รายการแรก · ดูทั้งหมดที่หน้ากล่อง AG" : undefined}
        >
          <AgList items={agPending ?? []} role={role} />
        </ListCard>
      </div>

      {waiving ? (
        <WaiveDialog item={waiving} monthText={monthLabel(waiving.missedMonth)} onClose={() => setWaiving(null)} onSubmit={submitWaive} />
      ) : null}
      {reopening ? (
        <ConfirmDialog
          title={`เปิดเรื่องกลับ — ตกบริการ ${monthLabel(reopening.missedMonth)}`}
          message={`${reopening.customerName} · สัญญา ${reopening.contractNo} · เรื่องนี้ปิดไว้เป็น “ไม่ชดเชย” (เหตุผล: ${reopening.reason ?? "-"}) · เปิดกลับแล้วจะเป็นรอตัดสิน และขึ้นแถว “รอชดเชย” ในหน้าลงข้อมูลบริการอีกครั้ง · บันทึกลงประวัติการแก้ไข`}
          confirmLabel="ยืนยัน เปิดเรื่องกลับ"
          cancelLabel="ยกเลิก"
          danger
          onConfirm={confirmReopen}
          onCancel={() => setReopening(null)}
        />
      ) : null}
      {alertOpen ? (
        <MonthAlert
          month={data.month}
          currentMonth={data.currentMonth}
          unfilled={progress?.remaining ?? null}
          pending={pending?.length ?? null}
          onClose={() => setAlertDismissed(true)}
        />
      ) : null}
      <Toast message={toast} onClose={() => setToast("")} />
    </div>
  );
}
