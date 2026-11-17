import { describe, expect, it } from "vitest";
import { createDraft } from "./draftRow";
import { hasUnsavedCustomers } from "./unsavedWork";

describe("hasUnsavedCustomers (M34)", () => {
  it("ไม่มีแถวเลย → ไม่ค้าง", () => {
    expect(hasUnsavedCustomers([], {})).toBe(false);
  });
  it("แถวใหม่เปล่า → ไม่ค้าง", () => {
    expect(hasUnsavedCustomers([createDraft()], {})).toBe(false);
  });
  it("แถวใหม่ที่เริ่มกรอก → ค้าง", () => {
    expect(hasUnsavedCustomers([{ ...createDraft(), customerName: "ทดสอบ" }], {})).toBe(true);
  });
  it("saveError อย่างเดียวไม่นับเป็นข้อมูลที่กรอก", () => {
    expect(hasUnsavedCustomers([{ ...createDraft(), saveError: "ผิดพลาด" }], {})).toBe(false);
  });
  it("เปิดแก้แถวที่บันทึกแล้วแต่ไม่เปลี่ยนอะไร → ไม่ค้าง", () => {
    const d = createDraft();
    expect(hasUnsavedCustomers([], { a: { draft: d, original: d } })).toBe(false);
  });
  it("แก้แถวที่บันทึกแล้ว → ค้าง", () => {
    const d = createDraft();
    expect(hasUnsavedCustomers([], { a: { draft: { ...d, note: "แก้" }, original: d } })).toBe(true);
  });
});

import { hasUnsavedWork, setUnsavedWork } from "@/components/shell/unsaved-work";

describe("สถานะค้างส่งถึงแถบแจ้งเวอร์ชัน (ผ่านตัวเก็บกลางที่ useUnsavedWork ใช้)", () => {
  it("หน้ามีแถวที่กรอกค้าง → แถบเห็น · บันทึกแล้ว/ถอดหน้า → แถบไม่เห็น", () => {
    const touched = [{ ...createDraft(), customerName: "ทดสอบ" }];
    setUnsavedWork("customers-new", hasUnsavedCustomers(touched, {}));
    expect(hasUnsavedWork()).toBe(true);
    setUnsavedWork("customers-new", hasUnsavedCustomers([], {}));
    expect(hasUnsavedWork()).toBe(false);
  });
});
