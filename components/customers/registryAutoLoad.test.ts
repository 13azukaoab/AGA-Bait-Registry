import { describe, expect, it } from "vitest";

import { AUTO_LOAD_CAP, capText, decideAutoLoad, progressText } from "./registryAutoLoad";

const base = { post: true, hasNext: true, scanned: 1000, limit: AUTO_LOAD_CAP, hasError: false };

describe("decideAutoLoad", () => {
  it("มีตัวกรองฝั่งหน้า + ยังมีต่อ → โหลดต่อ", () => {
    expect(decideAutoLoad(base)).toEqual({ continue: true });
  });
  it("ตรวจครบแล้ว → หยุด (done)", () => {
    expect(decideAutoLoad({ ...base, hasNext: false })).toEqual({ continue: false, reason: "done" });
  });
  it("ไม่มีตัวกรองฝั่งหน้า → ไม่โหลดต่อเอง", () => {
    expect(decideAutoLoad({ ...base, post: false })).toEqual({ continue: false, reason: "no_post_filter" });
  });
  it("ถึงเพดาน → หยุด (cap) · ต่ำกว่าเพดาน 1 แถวยังไปต่อ", () => {
    expect(decideAutoLoad({ ...base, scanned: AUTO_LOAD_CAP })).toEqual({ continue: false, reason: "cap" });
    expect(decideAutoLoad({ ...base, scanned: AUTO_LOAD_CAP - 1 })).toEqual({ continue: true });
  });
  it("เพดานที่เลื่อนแล้ว (ผู้ใช้กดต่อ) → โหลดต่อได้อีก", () => {
    expect(decideAutoLoad({ ...base, scanned: AUTO_LOAD_CAP, limit: AUTO_LOAD_CAP * 2 })).toEqual({ continue: true });
  });
  it("error → หยุด ไม่วนซ้ำ แม้ยังมีต่อ", () => {
    expect(decideAutoLoad({ ...base, hasError: true })).toEqual({ continue: false, reason: "error" });
  });
});

describe("ข้อความ", () => {
  it("ความคืบหน้า", () => {
    expect(progressText(2000, 2369, 3)).toBe("กำลังตรวจ 2,000 / 2,369… (พบ 3 รายการ)");
    expect(progressText(200, null, 0)).toBe("กำลังตรวจ 200… (พบ 0 รายการ)");
  });
  it("ถึงเพดาน", () => {
    expect(capText(10000, 12000)).toContain("10,000 จาก 12,000");
  });
});
