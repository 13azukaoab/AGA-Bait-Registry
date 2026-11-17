/**
 * เทสตรรกะสถานะกล่องแจ้งเวอร์ชันใหม่ (M34) + ตัวเก็บสถานะงานค้าง
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  INITIAL_UPDATE_BANNER_STATE as INIT,
  isBannerVisible,
  updateBannerReducer as reduce,
  type UpdateBannerEvent,
  type UpdateBannerState,
} from "./update-banner-state";
import { hasUnsavedWork, setUnsavedWork } from "./unsaved-work";

const run = (events: UpdateBannerEvent[], from: UpdateBannerState = INIT) =>
  events.reduce(reduce, from);

describe("แสดงกล่อง", () => {
  it("ยังไม่มี SW ใหม่ → ไม่แสดง", () => {
    expect(isBannerVisible(INIT)).toBe(false);
  });
  it("มี SW ใหม่รออยู่ → แสดง", () => {
    expect(isBannerVisible(run([{ type: "waiting" }]))).toBe(true);
  });
  it("กด 'ภายหลัง' → ซ่อน", () => {
    expect(isBannerVisible(run([{ type: "waiting" }, { type: "later" }]))).toBe(false);
  });
});

describe("กด 'อัปเดตตอนนี้'", () => {
  it("ไม่มีงานค้าง → อัปเดตเลย ไม่ถาม", () => {
    const s = run([{ type: "waiting" }, { type: "update-click", hasUnsavedWork: false }]);
    expect(s.applying).toBe(true);
    expect(s.confirming).toBe(false);
    expect(isBannerVisible(s)).toBe(false);
  });
  it("มีงานค้าง → ต้องยืนยันก่อน ยังไม่อัปเดต", () => {
    const s = run([{ type: "waiting" }, { type: "update-click", hasUnsavedWork: true }]);
    expect(s.confirming).toBe(true);
    expect(s.applying).toBe(false);
  });
  it("มีงานค้าง → ยกเลิก = กลับมาที่กล่อง ไม่อัปเดต", () => {
    const s = run([
      { type: "waiting" },
      { type: "update-click", hasUnsavedWork: true },
      { type: "cancel" },
    ]);
    expect(s.confirming).toBe(false);
    expect(s.applying).toBe(false);
    expect(isBannerVisible(s)).toBe(true);
  });
  it("มีงานค้าง → ยืนยัน = อัปเดต", () => {
    const s = run([
      { type: "waiting" },
      { type: "update-click", hasUnsavedWork: true },
      { type: "confirm" },
    ]);
    expect(s.applying).toBe(true);
    expect(s.confirming).toBe(false);
  });
  it("ไม่ผ่านขั้นยืนยัน (confirm โดยไม่ได้ถาม) → ไม่อัปเดต", () => {
    expect(run([{ type: "waiting" }, { type: "confirm" }]).applying).toBe(false);
  });
  it("ยังไม่มี SW ใหม่ → กดอัปเดตไม่มีผล", () => {
    expect(run([{ type: "update-click", hasUnsavedWork: false }]).applying).toBe(false);
  });
});

describe("สถานะงานค้างระดับแอป", () => {
  beforeEach(() => {
    setUnsavedWork("a", false);
    setUnsavedWork("b", false);
  });
  it("ไม่มีฟอร์มค้าง → false", () => {
    expect(hasUnsavedWork()).toBe(false);
  });
  it("มีฟอร์มใดค้าง → true · ถอนครบ → false", () => {
    setUnsavedWork("a", true);
    setUnsavedWork("b", true);
    expect(hasUnsavedWork()).toBe(true);
    setUnsavedWork("a", false);
    expect(hasUnsavedWork()).toBe(true);
    setUnsavedWork("b", false);
    expect(hasUnsavedWork()).toBe(false);
  });
});
