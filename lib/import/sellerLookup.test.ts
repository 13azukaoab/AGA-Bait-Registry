/**
 * เทสตัวจับคู่ผู้ขายจากไฟล์เปิดงาน — ข้อมูลสมมติทั้งหมด (ไม่มีข้อมูลจริง · รันได้ใน CI)
 * โครงชีทจำลองตาม "รายชื่อลูกค้าเปิดงาน ปี2569.xlsx": ชีทรายเดือน · หัวตาราง 1 หรือ 2 แถว · ชีทอื่นที่ไม่ใช่ข้อมูลงาน
 */
import { describe, expect, it } from "vitest";
import type { CellValue } from "./registrySheet";
import { buildSellerIndex, lookupSeller } from "./sellerLookup";

/** ชีทหัว 1 แถว (แบบ พ.ค.26 เป็นต้นไป) · หัว "ผู้ขาย " มีช่องว่างท้าย */
const ONE_ROW_HEADER: CellValue[][] = [
  ["สรุปงานเปิดใหม่ (สมมติ)"],
  [],
  ["ลำดับ", "เลขที่สัญญา", "รายชื่อ", "เบิกด่วน", "New", "Renew", "ผู้ขาย ", "ตำแหน่ง", "สาขา"],
  [1, "CT26-0000001", "ลูกค้าสมมติ 1", false, true, false, "ผู้ขายสมมติ ก", "Sale", "สาทร"],
  [2, " ct26-0000002 ", "ลูกค้าสมมติ 2", false, true, false, "ผู้ขายสมมติ ข", "AM", "สาทร"],
  [3, "CT26-0000003", "ลูกค้าสมมติ 3", false, true, false, null, null, "สาทร"],
  [null, "จำนวน", null, null, null, null, null, null, null],
];

/** ชีทหัว 2 แถว (แบบ ม.ค.26) · ป้ายผู้ขาย/ตำแหน่งอยู่แถวล่าง */
const TWO_ROW_HEADER: CellValue[][] = [
  [],
  ["ลำดับ", "เลขที่สัญญา", "รายชื่อ", "เบิกด่วน", "New", "Renew", null, null, "สาขา"],
  [null, null, null, null, null, null, "ผู้ขาย", "ตำแหน่ง", null],
  [1, "CT26-0000004", "ลูกค้าสมมติ 4", false, false, true, "ผู้ขายสมมติ ค", "Sale", "หัวหิน"],
  // เลขเดียวกับชีทแรก แต่ชื่อผู้ขายต่าง → ขัดกัน
  [2, "CT26-0000001", "ลูกค้าสมมติ 1", false, false, true, "ผู้ขายสมมติ ง", "Sale", "หัวหิน"],
  // เลขเดียวกับชีทแรก ชื่อเดียวกัน (เว้นวรรคต่าง) → ไม่ถือว่าขัด
  [3, "CT26-0000002", "ลูกค้าสมมติ 2", false, false, true, "ผู้ขายสมมติ  ข", "AM", "หัวหิน"],
];

const SHEETS = [
  { name: "Reference", rows: [["รหัส", "ความหมาย"], ["A", "ทีม A"]] as CellValue[][] },
  { name: "รายชื่อเซลล์", rows: [["ชื่อ", "ตำแหน่ง"], ["ผู้ขายสมมติ ก", "Sale"]] as CellValue[][] },
  { name: "ม.ค.26", rows: TWO_ROW_HEADER },
  { name: "พ.ค.26", rows: ONE_ROW_HEADER },
];

describe("buildSellerIndex", () => {
  const idx = buildSellerIndex(SHEETS);

  it("อ่านเฉพาะชีทที่มีคอลัมน์เลขที่สัญญา + ผู้ขาย · ชีทอื่นบันทึกว่าข้าม", () => {
    expect(idx.sheetsRead).toEqual(["ม.ค.26", "พ.ค.26"]);
    expect(idx.sheetsSkipped).toEqual(["Reference", "รายชื่อเซลล์"]);
  });

  it("หัว 2 แถว: ป้ายผู้ขายอยู่แถวล่าง ก็หาเจอ", () => {
    expect(lookupSeller(idx, "CT26-0000004")).toEqual({ status: "matched", seller: { name: "ผู้ขายสมมติ ค", position: "Sale" } });
  });

  it("เลขที่สัญญาล้างแบบเดียวกับ importContracts (ตัวพิมพ์ · ช่องว่าง) ทั้ง 2 ฝั่ง", () => {
    expect(lookupSeller(idx, "ct26-0000002 ").status).toBe("matched");
  });

  it("เลขเดียวกันหลายชีท ชื่อเดียวกัน (ต่างแค่ช่องว่าง) = จับคู่ได้", () => {
    expect(lookupSeller(idx, "CT26-0000002")).toMatchObject({ status: "matched", seller: { position: "AM" } });
  });

  it("เลขเดียวกันแต่ชื่อผู้ขายต่างกัน = ขัดกัน → ไม่ใส่ผู้ขาย", () => {
    expect(lookupSeller(idx, "CT26-0000001")).toEqual({ status: "conflict" });
  });

  it("เจอเลขสัญญาแต่ช่องผู้ขายว่าง = blank", () => {
    expect(lookupSeller(idx, "CT26-0000003")).toEqual({ status: "blank" });
  });

  it("ไม่เจอเลขสัญญา = notFound · แถวสรุป (ไม่ใช่เลขสัญญา) ไม่ถูกนับ", () => {
    expect(lookupSeller(idx, "CT25-0000009")).toEqual({ status: "notFound" });
    expect(idx.contracts).toBe(4);
  });

  it("ชีทที่ไม่มีหัวตาราง (ข้อมูลว่างเยอะ) ไม่ throw", () => {
    const big: CellValue[][] = [];
    for (let i = 0; i < 50_000; i++) big.push([]);
    expect(() => buildSellerIndex([{ name: "ว่าง", rows: big }])).not.toThrow();
  });
});
