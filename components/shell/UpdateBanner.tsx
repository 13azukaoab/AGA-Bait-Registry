"use client";

/**
 * UpdateBanner — กล่องลอยมุมล่างขวา "มีเวอร์ชันใหม่ กดเพื่ออัปเดต" (M34 · DECISIONS 2.56 · เจ้าของเลือกแบบ ข)
 *
 * ตาม mockup: docs/mockup/_shell/update-banner.{css,html,js}
 *  - แสดงเมื่อมี service worker ตัวใหม่รออยู่ (useServiceWorkerUpdate)
 *  - "อัปเดตตอนนี้" = ส่ง SKIP_WAITING แล้วรีโหลด · "ภายหลัง" = ซ่อนรอบนี้
 *  - มีงานกรอกค้าง (unsaved-work.ts) → ขึ้นกล่องยืนยันก่อน โฟกัสเริ่มที่ "ยกเลิก"
 *  - กรอบนอกเป็น role="status" ที่อยู่ใน DOM ตลอด เพื่อให้ screen reader อ่านตอนข้อความโผล่
 * ตรรกะสถานะอยู่ใน update-banner-state.ts (pure function · มีเทส)
 */
import { useEffect, useReducer, useRef } from "react";
import { Button } from "@/components/ui/Button";
import {
  INITIAL_UPDATE_BANNER_STATE,
  isBannerVisible,
  updateBannerReducer,
} from "./update-banner-state";
import { hasUnsavedWork } from "./unsaved-work";
import { useServiceWorkerUpdate } from "./useServiceWorkerUpdate";

export function UpdateBanner() {
  const { hasWaiting, apply } = useServiceWorkerUpdate();
  const [state, dispatch] = useReducer(updateBannerReducer, INITIAL_UPDATE_BANNER_STATE);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (hasWaiting) dispatch({ type: "waiting" });
  }, [hasWaiting]);

  // ผู้ใช้สั่งอัปเดตแล้ว (ผ่านขั้นยืนยันถ้ามีงานค้าง) → ส่ง SKIP_WAITING
  useEffect(() => {
    if (state.applying) apply();
  }, [state.applying, apply]);

  // เปิด/ปิดกล่องยืนยันตาม state.confirming
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (state.confirming && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!state.confirming && dialog.open) {
      dialog.close();
    }
  }, [state.confirming]);

  const visible = isBannerVisible(state);

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 w-[min(400px,calc(100vw-32px))] max-[600px]:inset-x-3 max-[600px]:w-auto max-[600px]:bottom-[calc(12px+env(safe-area-inset-bottom,0px))]"
      >
        {visible ? (
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-border border-l-4 border-l-accent bg-surface px-4 py-3.5 text-sm leading-normal text-fg shadow-xl">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-5 flex-none fill-none stroke-accent stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
            <div className="min-w-0 flex-1">
              <b className="block font-semibold">มีเวอร์ชันใหม่ กดเพื่ออัปเดต</b>
              <span className="block text-xs text-fg-muted">
                ระบบจะโหลดหน้าใหม่ · เลือกจังหวะอัปเดตเองได้
              </span>
            </div>
            <div className="flex w-full items-center justify-end gap-2 max-[600px]:[&>button]:flex-1">
              <Button
                className="min-h-11 whitespace-nowrap"
                onClick={() => dispatch({ type: "later" })}
              >
                ภายหลัง
              </Button>
              <Button
                variant="primary"
                className="min-h-11 whitespace-nowrap"
                onClick={() =>
                  dispatch({ type: "update-click", hasUnsavedWork: hasUnsavedWork() })
                }
              >
                อัปเดตตอนนี้
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="update-banner-dlg-title"
        aria-describedby="update-banner-dlg-desc"
        onClose={() => dispatch({ type: "cancel" })}
        className="m-auto w-[min(420px,calc(100vw-32px))] rounded-xl border border-border bg-surface p-5 text-fg backdrop:bg-black/50"
      >
        <h2 id="update-banner-dlg-title" className="mb-1.5 text-base font-semibold">
          มีข้อมูลที่ยังไม่บันทึก
        </h2>
        <p id="update-banner-dlg-desc" className="mb-4 text-sm text-fg-muted">
          มีข้อมูลที่ยังไม่บันทึก จะหายถ้าอัปเดตตอนนี้
        </p>
        <div className="flex justify-end gap-2 max-[600px]:flex-col-reverse">
          <Button
            ref={cancelRef}
            className="min-h-11 max-[600px]:w-full"
            onClick={() => dispatch({ type: "cancel" })}
          >
            ยกเลิก
          </Button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-danger bg-danger px-3.5 py-2 text-[13px] font-medium text-accent-fg transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger max-[600px]:w-full"
            onClick={() => dispatch({ type: "confirm" })}
          >
            ยืนยัน อัปเดตเลย
          </button>
        </div>
      </dialog>
    </>
  );
}
