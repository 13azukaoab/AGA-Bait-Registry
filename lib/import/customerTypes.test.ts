import { describe, it, expect } from "vitest";
import { CUSTOMER_TYPE_MAPPINGS, CUSTOMER_TYPES, normalizeCustomerType } from "./customerTypes";

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

describe("ตารางแปลงรหัสประเภทจากทะเบียนรายสาขา (DECISIONS 2.70)", () => {
  it("H → บ้านเดี่ยว · T/TH → ทาวน์โฮม / ตึกแถว · R → คอนโด / อพาร์ตเมนต์ / หอพัก (มี fix บอกว่าแปลง)", () => {
    expect(normalizeCustomerType("H")).toMatchObject({ value: "บ้านเดี่ยว" });
    expect(normalizeCustomerType("T").value).toBe("ทาวน์โฮม / ตึกแถว");
    expect(normalizeCustomerType("TH").value).toBe("ทาวน์โฮม / ตึกแถว");
    expect(normalizeCustomerType("R").value).toBe("คอนโด / อพาร์ตเมนต์ / หอพัก");
    expect(normalizeCustomerType("H").fix).toContain("H");
  });

  it("รหัสไม่สนตัวพิมพ์เล็ก/ใหญ่ และช่องว่างหัวท้าย", () => {
    expect(normalizeCustomerType(" h ").value).toBe("บ้านเดี่ยว");
    expect(normalizeCustomerType("th").value).toBe("ทาวน์โฮม / ตึกแถว");
  });

  it("คำสะกดผิดในทะเบียน: ออฟฟิิต → ออฟฟิต · โรงาน → โรงงาน", () => {
    expect(normalizeCustomerType("ออฟฟิิต").value).toBe("ออฟฟิต");
    expect(normalizeCustomerType("โรงาน").value).toBe("โรงงาน");
  });

  it("ศาลเจ้า → สถานที่ทางศาสนา (เจ้าของยืนยัน 17 พ.ย. 2026)", () => {
    expect(normalizeCustomerType("ศาลเจ้า")).toMatchObject({ value: "สถานที่ทางศาสนา" });
  });

  it("ค่าปลายทางทุกตัว (ตารางเดิม + ทะเบียน) ต้องอยู่ใน master — ห้ามสร้างค่าใหม่", () => {
    for (const rule of CUSTOMER_TYPE_MAPPINGS) expect(CUSTOMER_TYPES).toContain(rule.to);
  });

  it("ตารางแปลงระบุที่มาของแต่ละกฎ (ใช้ทำตารางให้เจ้าของตรวจ)", () => {
    const sources = new Set(CUSTOMER_TYPE_MAPPINGS.map((r) => r.source));
    expect(sources).toEqual(new Set(["legacy", "registry"]));
  });
});
