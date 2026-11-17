import { describe, expect, it } from "vitest";

import { setUnsavedWork, hasUnsavedWork } from "@/components/shell/unsaved-work";

import { isContactDraftDirty } from "./unsavedContact";

const base = { value: "คุณสมชาย", phone: "", label: "" };

describe("isContactDraftDirty", () => {
  it("ไม่ได้เปิดช่องแก้ (original = null) → ไม่ค้าง", () => {
    expect(isContactDraftDirty(null, { value: "x", phone: "y", label: "z" })).toBe(false);
  });

  it("เปิดช่องแล้วยังไม่แก้ → ไม่ค้าง", () => {
    expect(isContactDraftDirty(base, { ...base })).toBe(false);
  });

  it("แก้ชื่อผู้ติดต่อ → ค้าง", () => {
    expect(isContactDraftDirty(base, { ...base, value: "คุณสมหญิง" })).toBe(true);
  });

  it("แก้เบอร์ หรือป้ายเบอร์ → ค้าง", () => {
    const phone = { value: "", phone: "0811111111", label: "มือถือ" };
    expect(isContactDraftDirty(phone, { ...phone, phone: "0822222222" })).toBe(true);
    expect(isContactDraftDirty(phone, { ...phone, label: "ที่ทำงาน" })).toBe(true);
  });

  it("พิมพ์แล้วแก้กลับเป็นค่าเดิม → ไม่ค้าง", () => {
    expect(isContactDraftDirty(base, { ...base, value: "x" })).toBe(true);
    expect(isContactDraftDirty(base, { ...base, value: base.value })).toBe(false);
  });
});

describe("ต่อกับตัวเก็บงานค้างของแถบ M34", () => {
  it("setUnsavedWork(id,true/false) สะท้อนใน hasUnsavedWork", () => {
    expect(hasUnsavedWork()).toBe(false);
    setUnsavedWork("contact-panel", isContactDraftDirty(base, { ...base, value: "x" }));
    expect(hasUnsavedWork()).toBe(true);
    setUnsavedWork("contact-panel", isContactDraftDirty(base, { ...base }));
    expect(hasUnsavedWork()).toBe(false);
  });
});
