import { describe, expect, it } from "vitest";
import { computeBannerBottom, type Rect } from "./update-banner-lift";

const VH = 800;
const banner = { left: 12, right: 363 }; // มือถือ 375px
const bar = (top: number, extra: Partial<Rect> = {}): Rect => ({
  top,
  bottom: VH,
  left: 0,
  right: 375,
  ...extra,
});

describe("computeBannerBottom", () => {
  it("ไม่มีแถบ → null (อยู่ตำแหน่งเดิม)", () => {
    expect(computeBannerBottom([], banner, VH, 12)).toBeNull();
  });

  it("แถบติดล่างสูง 100 → ยกเหนือแถบ + ช่องว่าง 8", () => {
    expect(computeBannerBottom([bar(700)], banner, VH, 12)).toBe(108);
  });

  it("แถบเลื่อนพ้นจอ (อยู่ต่ำกว่าขอบล่าง) → ไม่นับ", () => {
    expect(computeBannerBottom([bar(900, { bottom: 1000 })], banner, VH, 12)).toBeNull();
  });

  it("แถบเลื่อนพ้นจอด้านบน → ไม่นับ", () => {
    expect(computeBannerBottom([bar(-200, { bottom: -10 })], banner, VH, 12)).toBeNull();
  });

  it("จอคอม: แถบอยู่ซ้ายไม่ซ้อนกล่องขวา → null", () => {
    const desktopBanner = { left: 980, right: 1380 };
    expect(computeBannerBottom([bar(740, { left: 260, right: 900 })], desktopBanner, VH, 16)).toBeNull();
  });

  it("จอคอม: แถบกว้างซ้อนกล่อง → ยกขึ้น", () => {
    const desktopBanner = { left: 980, right: 1380 };
    expect(computeBannerBottom([bar(740, { left: 260, right: 1200 })], desktopBanner, VH, 16)).toBe(68);
  });

  it("แถบเตี้ยจนกล่องในตำแหน่งเดิมไม่ทับ (needed <= ตำแหน่งเดิม) → null", () => {
    expect(computeBannerBottom([bar(795, { bottom: 800 })], banner, VH, 20)).toBeNull();
  });

  it("หลายแถบ → ใช้ค่าที่สูงสุด", () => {
    expect(computeBannerBottom([bar(750), bar(680)], banner, VH, 12)).toBe(128);
  });
});
