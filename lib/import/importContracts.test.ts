import { describe, it, expect } from "vitest";
import { importContracts, importFromTsv } from "./importContracts";
import { SOURCE_COLUMNS } from "./types";

/** ข้อมูลเดโม 8 แถวจาก mockup (admin-add-customer.html impSample)
 *  คาดผล: พร้อมนำเข้า 3 · ต้องแก้เอง 4 · ข้าม 1 */
const DEMO: string[][] = [
  ["1", "CT26-9100001", "บจก. ลูกค้าตัวอย่าง 21", "", "", "TRUE", "พนักงานขาย 05", "AM", "สุขุมวิท", "C6", "11/09/2026", "14/10/2026", "13:00:00", "H", "บ้าน", "16/10/2026", "15/10/2027", "33426.80", "", ""],
  ["2", "CT26-9100002 ", "คุณลูกค้า สิบสาม", "", "TRUE", "", "พนักงานขาย 11", "Sale", "สาทร", "C2", "12/09/2026", "16/10/2026", "09.00 น.", "sup", "ทาวโฮม", "01/10/2026", "30/09/2027", "15890", "", ""],
  ["3", "ct26-9100003", "บจก. ลูกค้าตัวอย่าง 22", "", "", "TRUE", "พนักงานขาย 02", "AM", "นนทบรี", "นนทบรี", "14/09/2026", "20/10/2026", "10.30 น.", "E", "อาคาร", "01/10/2026", "30/09/2029", "", "64200", ""],
  ["4", "CT26-9100004", "คุณลูกค้า สิบสี่", "", "TRUE", "", "พนักงานขาย 20", "AM", "รามอินทรา", "C3", "15/09/2026", "17/09/2026", "2026-10-20", "11:30:00", "o", "05/10/2026", "04/10/2027", "16000", "", ""],
  ["5", "CT26-9100005", "บจก. ลูกค้าตัวอย่าง 23", "", "TRUE", "", "พนักงานขาย 07", "Sale", "ประชาชื่น", "C4", "16/09/2026", "26/01/1900", "14.30 น.", "L", "บ้าน", "01/10/2026", "30/09/2027", "21400", "", ""],
  ["6", "CT26-9100006", "บจก. ลูกค้าตัวอย่าง 24", "", "", "TRUE", "พนักงานขาย 03", "AM", "ประชาชื่น", "C4", "18/09/2026", "28/10/2026", "09:00:00", "หลายทีม", "วัง", "01/10/2026", "30/09/2029", "", "252828", ""],
  ["7", "CT26-9100001", "บจก. ลูกค้าตัวอย่าง 25", "", "TRUE", "", "พนักงานขาย 09", "AM", "พัฒนาการ", "C4", "20/09/2026", "22/10/2026", "10:00:00", "I", "โรงงาน", "01/10/2026", "30/09/2027", "99510", "", ""],
  ["", "จำนวน", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "17", "34", ""],
];

describe("importContracts — เดโม 8 แถว", () => {
  const res = importContracts(DEMO);

  it("แบ่งกลุ่มถูก: พร้อม 3 · ต้องแก้ 4 · ข้าม 1", () => {
    expect(res.summary.ready).toBe(3);
    expect(res.summary.mustFix).toBe(4);
    expect(res.summary.skipped).toBe(1);
    expect(res.summary.total).toBe(8);
  });

  it("แถว 1–3 พร้อมนำเข้า", () => {
    expect(res.ready.map((r) => r.contractNo)).toEqual([
      "CT26-9100001",
      "CT26-9100002",
      "CT26-9100003",
    ]);
  });

  it("แถว 1: แปลงประเภท+เวลา เป็น fix · วันบริการก่อนวันเริ่ม = warning", () => {
    const r = res.ready.find((x) => x.rowIndex === 1)!;
    expect(r.customerType).toBe("บ้านเดี่ยว");
    expect(r.serviceTime).toBe("13:00");
    expect(r.saleType).toBe("renew");
    expect(r.zone).toBe("เขต 6");
    expect(r.fixes.join(" ")).toMatch(/ประเภท/);
    expect(r.fixes.join(" ")).toMatch(/เวลา/);
    expect(r.warnings.join(" ")).toMatch(/ก่อนวันเริ่ม/);
  });

  it("แถว 2: trim เลขสัญญา + sup→Sup + ทาวโฮม + 09.00 น. เป็น fix รวม 4", () => {
    const r = res.ready.find((x) => x.rowIndex === 2)!;
    expect(r.teams).toEqual(["Sup"]);
    expect(r.customerType).toBe("ทาวน์โฮม / ตึกแถว");
    expect(r.serviceTime).toBe("09:00");
    expect(r.fixes.length).toBe(4);
  });

  it("แถว 3: ct→CT + สะกดสาขา + อาคาร→ออฟฟิต + เวลา · term=3", () => {
    const r = res.ready.find((x) => x.rowIndex === 3)!;
    expect(r.branch).toBe("นนทบุรี");
    expect(r.zone).toBe("เขต 2");
    expect(r.customerType).toBe("ออฟฟิต");
    expect(r.termYears).toBe(3);
    expect(r.valueTotal).toBe(64200);
  });

  it("แถว 4: คอลัมน์เลื่อนทั้งแถว → ต้องแก้เอง", () => {
    const r = res.mustFix.find((x) => x.rowIndex === 4)!;
    expect(r.errors.join(" ")).toMatch(/เลื่อน/);
  });

  it("แถว 5: ปีผิดปกติ (1900) → ต้องแก้เอง", () => {
    const r = res.mustFix.find((x) => x.rowIndex === 5)!;
    expect(r.errors.join(" ")).toMatch(/ปี/);
  });

  it('แถว 6: "หลายทีม" → ต้องแก้เอง', () => {
    const r = res.mustFix.find((x) => x.rowIndex === 6)!;
    expect(r.errors.join(" ")).toMatch(/หลายทีม/);
  });

  it("แถว 7: เลขสัญญาซ้ำกับแถว 1 → ต้องแก้เอง", () => {
    const r = res.mustFix.find((x) => x.rowIndex === 7)!;
    expect(r.errors.join(" ")).toMatch(/ซ้ำ/);
  });

  it("แถว 8: แถวสรุป (จำนวน) → ข้าม", () => {
    expect(res.skipped[0]!.rowIndex).toBe(8);
  });
});

describe("importContracts — เคสเฉพาะกฎ", () => {
  function row(over: Partial<Record<number, string>>): string[] {
    // แถวฐานที่ผ่านทุกกฎ แล้ว override เฉพาะช่องที่ทดสอบ
    const base = [
      "1", "CT26-0000001", "ลูกค้าทดสอบ", "", "TRUE", "", "ผู้ขาย", "AM",
      "สาทร", "", "", "", "", "A", "ออฟฟิต", "01/01/2026", "31/12/2026",
      "100000", "", "",
    ];
    for (const k of Object.keys(over)) base[+k] = over[+k as unknown as number]!;
    return base;
  }

  it("เลขสัญญาไม่ครบ 7 หลัก → ต้องแก้เอง", () => {
    const res = importContracts([row({ 1: "CT26-123" })]);
    expect(res.summary.mustFix).toBe(1);
    expect(res.mustFix[0]!.errors.join(" ")).toMatch(/7 หลัก/);
  });

  it("ไม่มีผู้ขาย → ต้องแก้เอง", () => {
    const res = importContracts([row({ 6: "" })]);
    expect(res.mustFix[0]!.errors.join(" ")).toMatch(/ผู้ขาย/);
  });

  it("วันสิ้นสุดก่อนวันเริ่ม → ต้องแก้เอง", () => {
    const res = importContracts([row({ 15: "01/06/2026", 16: "01/01/2026" })]);
    expect(res.mustFix[0]!.errors.join(" ")).toMatch(/สิ้นสุด/);
  });

  it("ระยะต่างจาก term เล็กน้อย (396 วัน) → เตือน แต่นำเข้าได้", () => {
    // 1 ปีควรจบ 31/12/2026 แต่ใส่ 31/01/2027 (+31 วัน)
    const res = importContracts([row({ 16: "31/01/2027" })]);
    expect(res.summary.ready).toBe(1);
    expect(res.ready[0]!.warnings.join(" ")).toMatch(/ระยะ/);
  });

  it("ระยะต่างจาก term มาก (151 วัน) → ต้องแก้เอง", () => {
    const res = importContracts([row({ 16: "31/05/2026" })]);
    expect(res.summary.mustFix).toBe(1);
    expect(res.mustFix[0]!.errors.join(" ")).toMatch(/ระยะ/);
  });

  it("ระยะตรงเป๊ะ → ไม่มี warning เรื่องระยะ", () => {
    const res = importContracts([row({})]);
    expect(res.summary.ready).toBe(1);
    expect(res.ready[0]!.warnings.join(" ")).not.toMatch(/ระยะ/);
  });

  it("entryMonth: วันบริการนอกเดือน → เตือน", () => {
    const res = importContracts([row({ 11: "15/03/2026" })], {
      entryMonth: "2026-01",
    });
    expect(res.ready[0]!.warnings.join(" ")).toMatch(/นอกเดือน/);
  });
});

describe("importContracts — รับ input แบบ object (key หัวคอลัมน์ไทย)", () => {
  it("map จากชื่อหัวคอลัมน์ได้", () => {
    const obj: Record<string, string> = {};
    const cells = [
      "1", "CT26-0000009", "ลูกค้า object", "", "TRUE", "", "ผู้ขาย", "AM",
      "สาทร", "", "", "", "", "A", "ออฟฟิต", "01/01/2026", "31/12/2026",
      "100000", "", "",
    ];
    SOURCE_COLUMNS.forEach((c, i) => (obj[c] = cells[i]!));
    const res = importContracts([obj]);
    expect(res.summary.ready).toBe(1);
    expect(res.ready[0]!.contractNo).toBe("CT26-0000009");
  });
});

describe("importFromTsv", () => {
  it("แยกแท็บ/บรรทัด แล้วประมวลผลเหมือน importContracts", () => {
    const tsv = DEMO.map((r) => r.join("\t")).join("\n");
    const res = importFromTsv(tsv);
    expect(res.summary.ready).toBe(3);
    expect(res.summary.mustFix).toBe(4);
    expect(res.summary.skipped).toBe(1);
  });
});
