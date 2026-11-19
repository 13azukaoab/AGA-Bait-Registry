/**
 * เทสตัวอ่านเบอร์โทรจากช่องทะเบียน — เบอร์สมมติทั้งหมด (ไม่มีเบอร์จริง · รันได้ใน CI)
 */
import { describe, expect, it } from "vitest";
import { parseThaiPhones, summarizePhones } from "./phones";

describe("parseThaiPhones", () => {
  it("ว่าง → empty", () => {
    expect(parseThaiPhones(null)).toEqual({ status: "empty", phones: [] });
    expect(parseThaiPhones("   ")).toEqual({ status: "empty", phones: [] });
  });

  it("มือถือ 10 หลัก (06/08/09) · ตัดขีด → ตัวเลขล้วน · ข้อความต่อท้าย = label", () => {
    expect(parseThaiPhones("081-000-0001 คุณสมมติ")).toEqual({ status: "ok", phones: [{ phone: "0810000001", label: "คุณสมมติ" }] });
    expect(parseThaiPhones("090-0000002")).toEqual({ status: "ok", phones: [{ phone: "0900000002", label: null }] });
    expect(parseThaiPhones("061.000.0003")).toEqual({ status: "ok", phones: [{ phone: "0610000003", label: null }] });
  });

  it("เบอร์บ้าน 9 หลัก (02–07) · เลขสั้น (< 7 หลัก) ถือเป็นข้อความ เช่น ต่อ 123", () => {
    expect(parseThaiPhones("02-000-0004 ต่อ 123")).toEqual({ status: "ok", phones: [{ phone: "020000004", label: "ต่อ 123" }] });
    expect(parseThaiPhones("034-000-004#55 สำนักงาน")).toEqual({ status: "ok", phones: [{ phone: "034000004", label: "#55 สำนักงาน" }] });
  });

  it("หลายเบอร์ในช่องเดียว (คั่น / , ;) → แยกเบอร์ · ข้อความหน้าเบอร์แรกเป็น label ของเบอร์แรก", () => {
    expect(parseThaiPhones("081-000-0005 / 089-000-0006")).toEqual({
      status: "ok",
      phones: [{ phone: "0810000005", label: null }, { phone: "0890000006", label: null }],
    });
    expect(parseThaiPhones("บ้าน 02-000-0007, มือถือ 086-000-0008 สมมติ")).toEqual({
      status: "ok",
      phones: [{ phone: "020000007", label: "บ้าน" }, { phone: "0860000008", label: "มือถือ สมมติ" }],
    });
  });

  it("เบอร์ซ้ำในช่องเดียวกัน → เก็บครั้งเดียว", () => {
    expect(parseThaiPhones("081-000-0009 / 0810000009").phones).toEqual([{ phone: "0810000009", label: null }]);
  });

  it("+66 / 66 นำหน้า → 0", () => {
    expect(parseThaiPhones("+66 81-000-0010").phones).toEqual([{ phone: "0810000010", label: null }]);
    expect(parseThaiPhones("6681-000-0011").phones).toEqual([{ phone: "0810000011", label: null }]);
  });

  it("รูปแบบไม่ถูก = invalid ทั้งช่อง (ไม่เดา · ไม่เก็บเบอร์อื่นในช่องเดียวกัน)", () => {
    for (const bad of [
      "081-000-00012 สมมติ", // 11 หลัก
      "081-000-001 สมมติ", // มือถือ 9 หลัก
      "02-000-0001-2", // บ้าน 10 หลัก
      "081/000/0001", // ใช้ / เป็นขีด (กำกวมกับตัวคั่นเบอร์)
      "081-000-0001 / 089-000-002", // เบอร์หลังผิด
      "1234567890",
      "ไม่มีเบอร์",
    ]) {
      expect(parseThaiPhones(bad), bad).toEqual({ status: "invalid", phones: [] });
    }
  });

  it("label ยาวเกิน 40 ตัว → เก็บเบอร์ ไม่เก็บ label", () => {
    const res = parseThaiPhones(`081-000-0012 ${"ก".repeat(41)}`);
    expect(res).toEqual({ status: "ok", phones: [{ phone: "0810000012", label: null }], labelTooLong: 1 });
  });

  it("ตัวเลขจาก Excel (ไม่ใช่ข้อความ) = invalid (เลข 0 หน้าอาจหาย · ไม่เติมให้)", () => {
    expect(parseThaiPhones(810000013)).toEqual({ status: "invalid", phones: [] });
  });
});

describe("summarizePhones", () => {
  it("นับ: แถวที่มีเบอร์ · จำนวนเบอร์ · ว่าง · รูปแบบไม่ถูก · label ยาวเกิน", () => {
    const s = summarizePhones([
      parseThaiPhones("081-000-0001"),
      parseThaiPhones("081-000-0002 / 02-000-0003"),
      parseThaiPhones(""),
      parseThaiPhones("12345678"),
      parseThaiPhones(`081-000-0004 ${"ก".repeat(41)}`),
    ]);
    expect(s).toEqual({ rows: 5, rowsWithPhones: 3, phones: 4, emptyRows: 1, invalidRows: 1, labelTooLong: 1 });
  });
});
