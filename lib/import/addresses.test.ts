/**
 * เทสตัวล้างช่อง "ที่อยู่ลูกค้า" (ที่อยู่ทั้งหมดในไฟล์นี้เป็นข้อมูลสมมติ · รันได้ใน CI)
 */
import { describe, expect, it } from "vitest";
import { cleanAddress, summarizeAddresses } from "./addresses";

describe("cleanAddress", () => {
  it("ตัดช่องว่างหัวท้าย · ช่องว่างซ้อน/แท็บ/NBSP/ขึ้นบรรทัดใหม่ → ช่องว่าง 1 ตัว (ที่อยู่สมมติ)", () => {
    expect(cleanAddress("  99/1  หมู่ 2 \t ถนนสมมติ ")).toEqual({ status: "ok", address: "99/1 หมู่ 2 ถนนสมมติ" });
    expect(cleanAddress("ซอยสมมติ  แขวงสมมติ")).toEqual({ status: "ok", address: "ซอยสมมติ แขวงสมมติ" });
    expect(cleanAddress("บ้านสมมติ\r\nเขตสมมติ")).toEqual({ status: "ok", address: "บ้านสมมติ เขตสมมติ" });
  });

  it("ไม่แก้/ไม่เดาเนื้อหา: ตัวสะกด เครื่องหมาย และ '-' คงเดิม", () => {
    expect(cleanAddress("-")).toEqual({ status: "ok", address: "-" });
    expect(cleanAddress("ม.สมมติ ต.สมมติ, อ.สมมติ")).toEqual({ status: "ok", address: "ม.สมมติ ต.สมมติ, อ.สมมติ" });
  });

  it("ว่าง / มีแต่ช่องว่าง / null = ไม่มีที่อยู่ (NULL)", () => {
    for (const v of [null, undefined, "", "   ", " \n"]) expect(cleanAddress(v)).toEqual({ status: "empty", address: null });
  });

  it("ตัวเลข Excel = เก็บเป็นข้อความตามค่า (นับแยก) · true/false = ไม่ใช่ที่อยู่ → NULL (นับแยก)", () => {
    expect(cleanAddress(123)).toEqual({ status: "numeric", address: "123" });
    expect(cleanAddress(true)).toEqual({ status: "nonText", address: null });
    expect(cleanAddress(false)).toEqual({ status: "nonText", address: null });
  });

  it("ตัวอักษรควบคุม (เช่น \\u0000 ที่ PostgreSQL text รับไม่ได้) = ไม่เก็บ นับแยกไว้รายงาน · ไม่ลบเอง", () => {
    expect(cleanAddress("บ้านสมมติ\u0000")).toEqual({ status: "controlChar", address: null });
  });
});

describe("summarizeAddresses", () => {
  it("นับจำนวนเท่านั้น (ไม่มีค่าที่อยู่ในผลลัพธ์)", () => {
    const sum = summarizeAddresses(["ที่อยู่สมมติ 1", "", 7, true, "x\u0001", "ที่อยู่สมมติ 2"].map(cleanAddress));
    expect(sum).toEqual({ rows: 6, withAddress: 3, emptyRows: 1, numericRows: 1, nonTextRows: 1, controlCharRows: 1 });
    expect(JSON.stringify(sum)).not.toContain("สมมติ");
  });
});
