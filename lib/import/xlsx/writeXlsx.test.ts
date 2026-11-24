/**
 * ตัวเขียน .xlsx: เขียนแล้วอ่านกลับด้วย readXlsx ต้องได้ค่าเดิมทุกเซลล์ (ข้อมูลสมมติทั้งหมด)
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readXlsx } from "./readXlsx";
import { buildXlsx, columnLetter } from "./writeXlsx";

const dir = mkdtempSync(join(tmpdir(), "aga-xlsx-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("buildXlsx", () => {
  it("round-trip: ข้อความไทย · เบอร์ 0 หน้า · วันที่ข้อความ · อักขระพิเศษ XML · ช่องว่าง", () => {
    const rows = [
      ["ลำดับ", "เบอร์โทร", "วันเริ่ม", "หมายเหตุ"],
      ["1", "0810000001 คุณสมมติ", "03/04/2026", "a < b & \"c\""],
      ["2", "", "15/01/2026", "บรรทัด 1\nบรรทัด 2"],
    ];
    const path = join(dir, "t.xlsx");
    writeFileSync(path, buildXlsx([{ name: "แบบฟอร์ม", header: true, rows, columns: [{}, {}, {}, { list: ["ใช่", "ไม่"] }] }, { name: "คำอธิบาย", rows: [["ข้อความสมมติ"]] }]));
    const sheets = readXlsx(path);
    expect(sheets.map((s) => s.name)).toEqual(["แบบฟอร์ม", "คำอธิบาย"]);
    const grid = sheets[0]!.rows.map((r) => r.map((v) => v ?? ""));
    expect(grid).toEqual(rows);
    expect(sheets[1]!.rows[0]).toEqual(["ข้อความสมมติ"]);
  });

  it("ชื่อชีทผิด/ซ้ำ/ไม่มีชีท = throw", () => {
    expect(() => buildXlsx([])).toThrow(/อย่างน้อย 1 ชีท/);
    expect(() => buildXlsx([{ name: "a/b", rows: [] }])).toThrow(/ใช้ไม่ได้/);
    expect(() => buildXlsx([{ name: "a", rows: [] }, { name: "a", rows: [] }])).toThrow(/ซ้ำ/);
  });

  it("columnLetter", () => {
    expect([0, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA"]);
  });
});
