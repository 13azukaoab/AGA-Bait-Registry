/**
 * ตรรกะสถานะของกล่องแจ้ง "มีเวอร์ชันใหม่" (M34 · DECISIONS 2.56) — pure function ไม่แตะ DOM/SW
 * เพื่อให้เทสได้ง่าย (update-banner-state.test.ts) · component อยู่ที่ UpdateBanner.tsx
 *
 * สถานะ:
 *  - waiting    มี service worker ตัวใหม่รออยู่
 *  - dismissed  ผู้ใช้กด "ภายหลัง" (ซ่อนรอบนี้ ไม่เก็บถาวร)
 *  - confirming กำลังถามยืนยันเพราะมีงานกรอกค้าง
 *  - applying   ผู้ใช้สั่งอัปเดตแล้ว (component ส่ง SKIP_WAITING แล้วรอรีโหลด)
 *
 * กติกา: กด "อัปเดตตอนนี้" แล้วมีงานค้าง → ต้องผ่านขั้นยืนยันก่อนเสมอ
 */

export type UpdateBannerState = {
  waiting: boolean;
  dismissed: boolean;
  confirming: boolean;
  applying: boolean;
};

export type UpdateBannerEvent =
  | { type: "waiting" }
  | { type: "later" }
  | { type: "update-click"; hasUnsavedWork: boolean }
  | { type: "confirm" }
  | { type: "cancel" };

export const INITIAL_UPDATE_BANNER_STATE: UpdateBannerState = {
  waiting: false,
  dismissed: false,
  confirming: false,
  applying: false,
};

export function updateBannerReducer(
  state: UpdateBannerState,
  event: UpdateBannerEvent,
): UpdateBannerState {
  switch (event.type) {
    case "waiting":
      return state.waiting ? state : { ...state, waiting: true };
    case "later":
      return { ...state, dismissed: true };
    case "update-click":
      if (state.applying || !state.waiting) return state;
      return event.hasUnsavedWork
        ? { ...state, confirming: true }
        : { ...state, confirming: false, applying: true };
    case "confirm":
      if (!state.confirming) return state;
      return { ...state, confirming: false, applying: true };
    case "cancel":
      return state.confirming ? { ...state, confirming: false } : state;
  }
}

/** แสดงกล่องหรือไม่: มี SW ใหม่รออยู่ · ยังไม่กด "ภายหลัง" · ยังไม่เริ่มอัปเดต */
export function isBannerVisible(state: UpdateBannerState): boolean {
  return state.waiting && !state.dismissed && !state.applying;
}
