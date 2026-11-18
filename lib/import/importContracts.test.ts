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

describe("importContracts — flagMalformedContractWithValue (ทะเบียนรายสาขา · ค1)", () => {
  const malformed = (no: string) =>
    ["9", no, "ลูกค้าสมมติ", "", "TRUE", "", "", "", "สุขุมวิท", "", "", "", "", "A", "บ้าน", "01/10/2026", "30/09/2027", "20000", "", ""];

  it("ไม่เปิด = ข้ามเหมือนเดิม", () => {
    const res = importContracts([malformed(".CT26-9100009")]);
    expect(res.summary).toMatchObject({ skipped: 1, mustFix: 0 });
  });

  it("เปิด: เลขผิดรูป/ว่าง + มีมูลค่า + มีวันที่ → ต้องแก้ · แถวสรุป (มีตัวเลขแต่ไม่มีวันที่) ยังข้าม", () => {
    const res = importContracts([malformed(".CT26-9100009"), malformed(""), DEMO[7]!], {
      flagMalformedContractWithValue: true,
    });
    expect(res.summary).toMatchObject({ mustFix: 2, skipped: 1, ready: 0 });
    expect(res.mustFix[0]!.errors[0]).toMatch(/เลขที่สัญญาผิดรูปหรือว่าง .* แต่มีมูลค่า/);
    expect(res.mustFix[1]!.errors[0]).toContain('"ว่าง"');
  });
});

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
    expect(r.termMonths).toBe(36);
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

  it("allowMissingSeller (นำเข้าจากทะเบียน · 2.70 ฉ): ไม่มีผู้ขาย → นำเข้าได้ ผู้ขายว่าง + เตือน", () => {
    const res = importContracts([row({ 6: "" })], { allowMissingSeller: true });
    expect(res.summary.ready).toBe(1);
    expect(res.ready[0]!.seller).toBe("");
    expect(res.ready[0]!.warnings.join(" ")).toMatch(/ไม่ทราบผู้ขาย/);
  });

  it("allowMissingSeller ไม่กระทบแถวที่มีผู้ขาย (ไม่เตือน)", () => {
    const res = importContracts([row({})], { allowMissingSeller: true });
    expect(res.ready[0]!.seller).toBe("ผู้ขาย");
    expect(res.ready[0]!.warnings.join(" ")).not.toMatch(/ผู้ขาย/);
  });

  it("รหัสประเภททะเบียน H → บ้านเดี่ยว (fix)", () => {
    const res = importContracts([row({ 14: "H" })]);
    expect(res.ready[0]!.customerType).toBe("บ้านเดี่ยว");
  });

  it("ศาลเจ้า → สถานที่ทางศาสนา (เจ้าของยืนยัน)", () => {
    expect(importContracts([row({ 14: "ศาลเจ้า" })]).ready[0]!.customerType).toBe("สถานที่ทางศาสนา");
  });

  it("ผู้ขายลงช่องตามตำแหน่ง: AM → amName · Sale/อื่นๆ → saleName · ไม่มีชื่อ → ว่างทั้งคู่", () => {
    expect(importContracts([row({})]).ready[0]).toMatchObject({ saleName: null, amName: "ผู้ขาย" });
    expect(importContracts([row({ 7: "Sale" })]).ready[0]).toMatchObject({ saleName: "ผู้ขาย", amName: null });
    expect(importContracts([row({ 7: "ไม่พบชื่อ" })]).ready[0]).toMatchObject({ saleName: "ผู้ขาย", amName: null });
    const none = importContracts([row({ 6: "" })], { allowMissingSeller: true }).ready[0]!;
    expect(none).toMatchObject({ saleName: null, amName: null });
  });

  it("ตำแหน่ง AM ไม่ทำให้ช่อง New/Renew เปลี่ยน (ไม่อนุมาน)", () => {
    const r = importContracts([row({ 4: "", 5: "", 7: "AM" })]).ready[0]!;
    expect(r.saleType).toBeNull();
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

  // M30: เดิมใช้ 31/05/2026 (= 5 เดือนพอดี → ตอนนี้อนุมานเป็นสัญญาสั้น 5 เดือน) จึงเปลี่ยนเป็นวันที่ไม่ตรงเดือนใด
  it("ระยะต่างจาก term มาก (199 วัน · ไม่ตรงสัญญาสั้นใดๆ) → ต้องแก้เอง", () => {
    const res = importContracts([row({ 16: "15/06/2026" })]);
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

describe("importContracts — ระยะสัญญาเป็นเดือน (M30 · ข้อมูลสมมติ)", () => {
  /** แถวสมมติ: สาขา สาทร ทีม A · กำหนดวันเริ่ม/สิ้นสุด/มูลค่า/จำนวนเดือนได้ */
  const row = (start: string, end: string, v1: string, v3: string, months?: string): string[] => {
    const r = [
      "1", "CT26-0000010", "ลูกค้าสมมติ", "", "TRUE", "", "ผู้ขายสมมติ", "AM",
      "สาทร", "", "", "", "", "A", "ออฟฟิต", start, end, v1, v3, "",
    ];
    if (months !== undefined) r.push(months);
    return r;
  };

  it("คอลัมน์ 'จำนวนเดือน' อยู่ท้ายสุด (ไม่เลื่อนคอลัมน์เดิม)", () => {
    expect(SOURCE_COLUMNS[20]).toBe("จำนวนเดือน");
    expect(SOURCE_COLUMNS.length).toBe(21);
  });

  it("ไม่มีคอลัมน์เดือน + วันที่ครบ 12 เดือน → 12 (เหมือนเดิม)", () => {
    const r = importContracts([row("01/01/2026", "31/12/2026", "24000", "")]).ready[0]!;
    expect(r.termMonths).toBe(12);
    expect(r.warnings.join(" ")).not.toMatch(/เดือน \(Custom\)/);
  });

  it("ไม่มีคอลัมน์เดือน + ช่อง 1 ปี + วันที่ 9 เดือนพอดี → 9 เดือน (Custom) พร้อมเตือน", () => {
    const res = importContracts([row("01/03/2026", "30/11/2026", "18000", "")]);
    const r = res.ready[0]!;
    expect(r.termMonths).toBe(9);
    expect(r.valueTotal).toBe(18000);
    expect(r.warnings.join(" ")).toMatch(/9 เดือน \(Custom\)/);
  });

  it("อนุมานยอมคลาด ±3 วัน (5 เดือน: 15/01 → 14/06 · ใส่ 16/06 ได้)", () => {
    const r = importContracts([row("15/01/2026", "16/06/2026", "20000", "")]).ready[0]!;
    expect(r.termMonths).toBe(5);
  });

  it("ช่อง 1 ปี + วันที่ 11 เดือน → 11 (ไม่ใช่ 12 ที่คลาด 30 วัน)", () => {
    const r = importContracts([row("01/01/2026", "30/11/2026", "20000", "")]).ready[0]!;
    expect(r.termMonths).toBe(11);
  });

  it("ช่อง 3 ปี ไม่อนุมานเป็นเดือน — วันที่ 12 เดือน = ต้องแก้เอง (เหมือนเดิม)", () => {
    const res = importContracts([row("01/01/2026", "31/12/2026", "", "60000")]);
    expect(res.summary.mustFix).toBe(1);
    expect(res.mustFix[0]!.errors.join(" ")).toMatch(/ไม่ใช่ 3 ปี/);
  });

  it("ช่อง 1 ปี + วันที่ 18 เดือน (ไม่มีคอลัมน์เดือน) = ต้องแก้เอง (Custom ≥ 12 ต้องระบุจำนวนเดือน)", () => {
    const res = importContracts([row("01/01/2026", "30/06/2027", "30000", "")]);
    expect(res.summary.mustFix).toBe(1);
    expect(res.mustFix[0]!.errors.join(" ")).toMatch(/ไม่ใช่ 1 ปี/);
  });

  it("มีคอลัมน์เดือน = 18 → 18 เดือน · ตรวจวันที่กับ 18 เดือน", () => {
    const ok = importContracts([row("01/01/2026", "30/06/2027", "30000", "", "18")]).ready[0]!;
    expect(ok.termMonths).toBe(18);
    const bad = importContracts([row("01/01/2026", "31/12/2026", "30000", "", "18")]);
    expect(bad.mustFix[0]!.errors.join(" ")).toMatch(/ไม่ใช่ 18 เดือน/);
  });

  it("คอลัมน์เดือนชนะการอนุมาน · 24 เดือนในช่อง 1 ปี ได้ · 12 ในช่อง 3 ปี = เตือนไม่ตรงช่อง", () => {
    const r = importContracts([row("01/01/2026", "31/12/2027", "50000", "", "24")]).ready[0]!;
    expect(r.termMonths).toBe(24);
    const w = importContracts([row("01/01/2026", "31/12/2026", "", "50000", "12")]).ready[0]!;
    expect(w.termMonths).toBe(12);
    expect(w.warnings.join(" ")).toMatch(/ไม่ตรงช่องมูลค่า/);
  });

  it("คอลัมน์เดือนผิด (0 / 37) = ต้องแก้เอง", () => {
    for (const m of ["0", "37"]) {
      const res = importContracts([row("01/01/2026", "31/12/2026", "24000", "", m)]);
      expect(res.mustFix[0]!.errors.join(" ")).toMatch(/1–36/);
    }
  });

  it("สัญญาสั้น: วันสิ้นสุดคลาดเกิน 7 วัน = ต้องแก้เอง (ไม่ใช้เกณฑ์ 45 วันของ 1/3 ปี)", () => {
    const warn = importContracts([row("01/03/2026", "05/12/2026", "18000", "", "9")]);
    expect(warn.ready[0]!.warnings.join(" ")).toMatch(/ไม่ตรงวันที่/);
    const bad = importContracts([row("01/03/2026", "20/12/2026", "18000", "", "9")]);
    expect(bad.mustFix[0]!.errors.join(" ")).toMatch(/ไม่ใช่ 9 เดือน/);
  });
});
