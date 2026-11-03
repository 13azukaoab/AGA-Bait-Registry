import { describe, it, expect } from "vitest";
import { CUSTOMER_TYPES, normalizeCustomerType } from "./customerTypes";

describe("customer types master (14 ค่า 4 หมวด)", () => {
  it("มีครบ 14 ค่า", () => {
    expect(CUSTOMER_TYPES.length).toBe(14);
  });

  it("มีค่าหลักที่กำหนด", () => {
    expect(CUSTOMER_TYPES).toContain("บ้านเดี่ยว");
    expect(CUSTOMER_TYPES).toContain("ออฟฟิต");
    expect(CUSTOMER_TYPES).toContain("ห้าง / ร้านค้า");
    expect(CUSTOMER_TYPES).toContain("อื่นๆ (ระบุในหมายเหตุ)");
  });
});

describe("normalizeCustomerType", () => {
  it("ค่า canonical → ไม่มี fix", () => {
    const r = normalizeCustomerType("ออฟฟิต");
    expect(r.value).toBe("ออฟฟิต");
    expect(r.fix).toBeUndefined();
  });

  it("แปลงค่าเก่า → ใหม่ (มี fix): บ้าน → บ้านเดี่ยว", () => {
    const r = normalizeCustomerType("บ้าน");
    expect(r.value).toBe("บ้านเดี่ยว");
    expect(r.fix).toContain("บ้าน");
  });

  it("อาคาร/สำนักงาน/ออฟฟิศ → ออฟฟิต", () => {
    expect(normalizeCustomerType("อาคาร").value).toBe("ออฟฟิต");
    expect(normalizeCustomerType("สำนักงาน").value).toBe("ออฟฟิต");
    expect(normalizeCustomerType("ออฟฟิศ").value).toBe("ออฟฟิต");
  });

  it("ทาวโฮม (ขาด น์) → ทาวน์โฮม / ตึกแถว", () => {
    expect(normalizeCustomerType("ทาวโฮม").value).toBe("ทาวน์โฮม / ตึกแถว");
  });

  it("วัง/สวนลอยฟ้า → สถานที่สำคัญ", () => {
    expect(normalizeCustomerType("วัง").value).toBe("สถานที่สำคัญ");
    expect(normalizeCustomerType("สวนลอยฟ้า").value).toBe("สถานที่สำคัญ");
  });

  it("รีสอร์ท/โรงแรม → โรงแรม/รีสอร์ท", () => {
    expect(normalizeCustomerType("รีสอร์ท").value).toBe("โรงแรม/รีสอร์ท");
    expect(normalizeCustomerType("โรงแรม").value).toBe("โรงแรม/รีสอร์ท");
  });

  it("ไม่รู้จัก → error", () => {
    const r = normalizeCustomerType("o");
    expect(r.value).toBeNull();
    expect(r.error).toBeDefined();
  });

  it("ว่าง → error ไม่มีประเภท", () => {
    const r = normalizeCustomerType("");
    expect(r.value).toBeNull();
    expect(r.error).toBeDefined();
  });
});
