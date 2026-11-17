"use client";

/**
 * useBannerLift — วัดแถบบันทึกที่ติดขอบล่าง แล้วคืนค่า bottom (px) ที่ทำให้กล่องแจ้งเวอร์ชันลอยเหนือแถบ
 * (คืน null = ไม่มีแถบทับ ใช้ตำแหน่งตาม CSS เดิม) · ตรรกะคำนวณอยู่ update-banner-lift.ts (pure · มีเทส)
 *
 * แถบที่ถูกนับ: element ที่มี `data-sticky-savebar` หรือ class `sticky bottom-0`
 * อัปเดตเมื่อ: เลื่อนหน้า, ปรับขนาดจอ, แถบเปลี่ยนความสูง (ResizeObserver), แถบโผล่/หายจาก DOM (MutationObserver)
 * ล้าง listener/observer ทั้งหมดตอน enabled เปลี่ยนเป็น false หรือ unmount
 */
import { useEffect, useState, type RefObject } from "react";
import { computeBannerBottom } from "./update-banner-lift";

const BAR_SELECTOR = "[data-sticky-savebar], .sticky.bottom-0";
const MOBILE_QUERY = "(max-width: 600px)";
/** bottom เดิมของกล่อง: มือถือ 12px (บวก safe-area ที่แถบครอบคลุมอยู่แล้ว) · จอใหญ่ 16px */
const DEFAULT_BOTTOM_MOBILE = 12;
const DEFAULT_BOTTOM_DESKTOP = 16;

export function useBannerLift(
  boxRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): number | null {
  const [bottom, setBottom] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setBottom(null);
      return;
    }
    let frame = 0;
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => schedule()) : null;
    const observed = new Set<Element>();

    function measure() {
      frame = 0;
      const box = boxRef.current;
      if (!box) return;
      const bars = Array.from(document.querySelectorAll(BAR_SELECTOR));
      // ติดตามขนาดของแถบใหม่ + เลิกติดตามแถบที่หายไป
      for (const el of bars) {
        if (!observed.has(el)) {
          observed.add(el);
          resizeObserver?.observe(el);
        }
      }
      for (const el of Array.from(observed)) {
        if (!bars.includes(el)) {
          observed.delete(el);
          resizeObserver?.unobserve(el);
        }
      }
      const boxRect = box.getBoundingClientRect();
      const defaultBottom = window.matchMedia(MOBILE_QUERY).matches
        ? DEFAULT_BOTTOM_MOBILE
        : DEFAULT_BOTTOM_DESKTOP;
      const next = computeBannerBottom(
        bars.map((el) => el.getBoundingClientRect()),
        { left: boxRect.left, right: boxRect.right },
        window.innerHeight,
        defaultBottom,
      );
      setBottom((prev) => (prev === next ? prev : next));
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    measure();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [boxRef, enabled]);

  return bottom;
}
