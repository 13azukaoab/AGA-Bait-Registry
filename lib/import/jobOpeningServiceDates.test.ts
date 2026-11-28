import { describe, expect, it } from "vitest";

import { buildJobOpeningIndex, findJobColumns, parseJobDate, parseJobTime, type JobSheetInput } from "./jobOpeningServiceDates";

/** serial ของ Excel จาก y-m-d (ค.ศ. หรือปีใดก็ได้) */
function serial(y: number, m: number, d: number): number {
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

describe("parseJobDate", () => {
  it("serial ของ Excel → ISO", () => {
    expect(parseJobDate(serial(2026, 10, 5))).toEqual({ iso: "2026-10-05" });
    expect(parseJobDate(serial(2026, 10, 5) + 0.5)).toEqual({ iso: "2026-10-05" });
  });

  it("serial ที่ปีเป็น พ.ศ. (พิมพ์ 5/10/2569 ใน Excel) → ลบ 543", () => {
    expect(parseJobDate(serial(2569, 10, 5))).toEqual({ iso: "2026-10-05", buddhistYear: true });
  });

  it("ข้อความ วว/ดด/ปปปป ทั้ง ค.ศ. และ พ.ศ. · ตัวคั่น - และ .", () => {
    expect(parseJobDate("5/10/2026")).toEqual({ iso: "2026-10-05", fromText: true });
    expect(parseJobDate("05/10/2569")).toEqual({ iso: "2026-10-05", buddhistYear: true, fromText: true });
    expect(parseJobDate("5-10-2026").iso).toBe("2026-10-05");
    expect(parseJobDate("5.10.2026").iso).toBe("2026-10-05");
    expect(parseJobDate("2026-10-05").iso).toBe("2026-10-05");
  });

  it("ว่าง = null ไม่มีปัญหา", () => {
    expect(parseJobDate(null)).toEqual({ iso: null });
    expect(parseJobDate("  ")).toEqual({ iso: null });
    expect(parseJobDate(undefined)).toEqual({ iso: null });
  });

  it("ปี 2 หลัก = ปัญหา (ไม่เดา)", () => {
    expect(parseJobDate("5/10/26")).toMatchObject({ iso: null, problem: "twoDigitYear" });
  });

  it("หลายวันในช่องเดียว = ปัญหา (ไม่เดา)", () => {
    expect(parseJobDate("12,13/01/26").problem).toBe("multiDay");
    expect(parseJobDate("12-13/1/2026").problem).toBe("multiDay");
    expect(parseJobDate("12/1-13/1/2026").problem).toBe("multiDay");
  });

  it("ปีนอกช่วง 2023–2027 = ปัญหา (serial ปีเก่า / พิมพ์ปีผิด)", () => {
    expect(parseJobDate(serial(2009, 1, 1)).problem).toBe("yearOutOfRange");
    expect(parseJobDate("1/1/2030").problem).toBe("yearOutOfRange");
    expect(parseJobDate("1/1/2030", { minYear: 2023, maxYear: 2030 }).iso).toBe("2030-01-01");
  });

  it("วันไม่มีจริง / อ่านไม่ออก / ปี 5 หลัก = ปัญหา", () => {
    expect(parseJobDate("31/11/2026").problem).toBe("notRealDate");
    expect(parseJobDate("เดือนหน้า").problem).toBe("unreadable");
    expect(parseJobDate("12/10/20266").problem).toBe("unreadable");
    expect(parseJobDate(0).problem).toBe("unreadable");
  });
});

describe("parseJobTime", () => {
  it("เศษของวัน → HH:MM (ปัดเป็นนาที)", () => {
    expect(parseJobTime(0.375)).toEqual({ value: "09:00" });
    expect(parseJobTime(13.5 / 24)).toEqual({ value: "13:30" });
    expect(parseJobTime(0)).toEqual({ value: "00:00" });
  });

  it("ข้อความ HH.MM น. / HH:MM / H.MM", () => {
    expect(parseJobTime("09.30 น.")).toEqual({ value: "09:30" });
    expect(parseJobTime("13.00น.")).toEqual({ value: "13:00" });
    expect(parseJobTime("13.00น")).toEqual({ value: "13:00" });
    expect(parseJobTime("9:05")).toEqual({ value: "09:05" });
    expect(parseJobTime("10.00  น.")).toEqual({ value: "10:00" });
  });

  it("ช่วงเวลา → ใช้เวลาเริ่ม + ป้าย range", () => {
    expect(parseJobTime("09.00-10.00 น.")).toEqual({ value: "09:00", range: true });
    expect(parseJobTime("13.00/15.00 น.")).toEqual({ value: "13:00", range: true });
  });

  it("ว่าง = null · คำว่า เช้า/บ่าย = ปัญหา (ไม่เดา)", () => {
    expect(parseJobTime(null)).toEqual({ value: null });
    expect(parseJobTime("")).toEqual({ value: null });
    expect(parseJobTime("ช่วงเช้า").problem).toBe("wordTime");
    expect(parseJobTime("บ่าย").problem).toBe("wordTime");
    expect(parseJobTime("เย็น").problem).toBe("wordTime");
  });

  it("วันที่อยู่ในช่องเวลา / เวลาเกิน / อ่านไม่ออก = ปัญหา", () => {
    expect(parseJobTime(46000).problem).toBe("dateInTimeCell");
    expect(parseJobTime("25.00").problem).toBe("outOfRange");
    expect(parseJobTime("9.75").problem).toBe("outOfRange");
    expect(parseJobTime("ตามนัด").problem).toBe("unreadable");
  });
});

// ---------------------------------------------------------------------
// ชีทสมมติ (ข้อมูลสมมติทั้งหมด · ไม่มีข้อมูลลูกค้าจริง)
// ---------------------------------------------------------------------

/** หัวแบบ พ.ค. 26 ขึ้นไป: หัวอยู่แถว 3 (index 2) · mail=10 service=11 time=12 */
const HEAD_NEW = ["ลำดับ", "เลขที่สัญญา", "รายชื่อ", "เบิกด่วน", "New", "Renew", "ผู้ขาย", "ตำแหน่ง", "สาขา", "เขต", "วันที่รับ Mail", "วันที่บริการ", "เวลาบริการ"];
/** หัวแบบ ม.ค.–เม.ย. 26: หัวอยู่แถว 2 (index 1) · mail=9 service=10 time=11 */
const HEAD_OLD = ["ลำดับ", "เลขที่สัญญา", "รายชื่อ", "เบิกด่วน", "New", "Renew", null, null, "สาขา", "วันที่รับ Mail", "วันที่บริการ", "เวลาบริการ"];

function rowNew(ct: string, mail: unknown, svc: unknown, time: unknown, branch = "สาทร"): unknown[] {
  return [1, ct, "ลูกค้าสมมติ", null, "x", null, "ผู้ขายสมมติ", "Sale", branch, "2", mail, svc, time];
}
function rowOld(ct: string, mail: unknown, svc: unknown, time: unknown, branch = "สาทร"): unknown[] {
  return [1, ct, "ลูกค้าสมมติ", null, "x", null, null, null, branch, mail, svc, time];
}

const sheetNew = (name: string, rows: unknown[][]): JobSheetInput => ({
  name,
  rows: [["หัวเรื่อง"], [], HEAD_NEW, ...rows] as JobSheetInput["rows"],
});
const sheetOld = (name: string, rows: unknown[][]): JobSheetInput => ({
  name,
  rows: [["หัวเรื่อง"], HEAD_OLD, ...rows] as JobSheetInput["rows"],
});

describe("findJobColumns", () => {
  it("หาหัวจากป้าย ไม่ fix แถว/คอลัมน์", () => {
    expect(findJobColumns(sheetNew("x", []).rows)).toMatchObject({ headerRow: 2, mail: 10, service: 11, time: 12, branch: 8 });
    expect(findJobColumns(sheetOld("x", []).rows)).toMatchObject({ headerRow: 1, mail: 9, service: 10, time: 11, branch: 8 });
  });

  it("ไม่มีป้ายครบ = null (ชีท Reference / รายชื่อเซลล์)", () => {
    expect(findJobColumns([["ชื่อ", "เบอร์"]])).toBeNull();
    expect(findJobColumns([["เลขที่สัญญา", "สาขา"]])).toBeNull();
  });
});

describe("buildJobOpeningIndex", () => {
  const d = serial(2026, 10, 3);
  const s = serial(2026, 10, 7);

  it("อ่านหลายชีท หัวต่างตำแหน่ง · นับรายชีท · ข้ามชีทที่ไม่ใช่งาน · ไม่นับบล็อกสรุป", () => {
    const idx = buildJobOpeningIndex([
      {
        label: "2569",
        sheets: [
          { name: "Reference", rows: [["ข้อมูลอ้างอิง"]] },
          sheetOld("ม.ค.26", [rowOld("CT26-0000001", serial(2026, 1, 3), serial(2026, 1, 5), "09.30 น.")]),
          sheetNew("ต.ค.26", [
            rowNew("ct26-0000002 ", d, s, 0.375),
            rowNew("CT26-0000003", d, null, null),
            [null, null, null],
            [null, "จำนวน", null, null, null, null, null, null, null, null, null, null, null],
            [null, "", null, null, null, null, null, null, "สาทร", null, d, null, null],
          ]),
        ],
      },
    ]);
    expect(idx.sheetsSkipped).toEqual([{ source: "2569", sheet: "Reference" }]);
    expect(idx.sheets.map((x) => [x.sheet, x.headerRow, x.contractRows, x.withMail, x.withService, x.withTime])).toEqual([
      ["ม.ค.26", 2, 1, 1, 1, 1],
      ["ต.ค.26", 3, 2, 2, 1, 1],
    ]);
    const oct = idx.sheets[1]!;
    expect(oct.nonContractRows).toBe(2);
    expect(oct.malformedContractRows).toEqual([8]); // แถวที่มีวันรับ Mail แต่ไม่มีเลขสัญญา (Excel แถว 8)
    expect(idx.entries.get("CT26-0000002")).toMatchObject({
      mail: { value: "2026-10-03", conflict: false },
      service: { value: "2026-10-07", conflict: false },
      time: { value: "09:00", conflict: false },
      occurrences: [{ source: "2569", sheet: "ต.ค.26", excelRow: 4 }],
    });
    expect(idx.entries.get("CT26-0000001")!.time.value).toBe("09:30");
    expect(idx.entries.get("CT26-0000003")!.service).toEqual({ value: null, conflict: false, hadProblem: false });
  });

  it("ปัญหา: เก็บชนิด + เลขแถว (ไม่เก็บค่าในเซลล์)", () => {
    const idx = buildJobOpeningIndex([
      { label: "2569", sheets: [sheetNew("ต.ค.26", [rowNew("CT26-0000010", "3/10/26", "12,13/10/2026", "บ่าย")])] },
    ]);
    expect(idx.problems).toEqual([
      { source: "2569", sheet: "ต.ค.26", excelRow: 4, contractNo: "CT26-0000010", field: "mail", kind: "twoDigitYear" },
      { source: "2569", sheet: "ต.ค.26", excelRow: 4, contractNo: "CT26-0000010", field: "service", kind: "multiDay" },
      { source: "2569", sheet: "ต.ค.26", excelRow: 4, contractNo: "CT26-0000010", field: "time", kind: "wordTime" },
    ]);
    const e = idx.entries.get("CT26-0000010")!;
    expect(e.mail).toEqual({ value: null, conflict: false, hadProblem: true });
    expect(JSON.stringify(idx)).not.toContain("สมมติ");
  });

  it("เลขซ้ำ ค่าตรงกัน/อีกแถวว่าง = ใช้ได้ · ค่าต่างกัน = conflict (ไม่เลือกเอง)", () => {
    const idx = buildJobOpeningIndex([
      {
        label: "2569",
        sheets: [
          sheetNew("ก.ย.26", [rowNew("CT26-0000020", d, s, 0.375), rowNew("CT26-0000021", d, s, 0.375)]),
          sheetNew("ต.ค.26", [rowNew("CT26-0000020", d, null, null), rowNew("CT26-0000021", d + 1, s + 1, 0.375)]),
        ],
      },
    ]);
    const same = idx.entries.get("CT26-0000020")!;
    expect([same.mail.value, same.service.value, same.time.value]).toEqual(["2026-10-03", "2026-10-07", "09:00"]);
    const diff = idx.entries.get("CT26-0000021")!;
    expect(diff.mail).toMatchObject({ value: null, conflict: true });
    expect(diff.service).toMatchObject({ value: null, conflict: true });
    // เวลาเท่ากัน แต่วันที่บริการ conflict → เวลาใช้ไม่ได้ด้วย
    expect(diff.time).toMatchObject({ value: null, conflict: true });
    expect(idx.duplicates.map((x) => [x.contractNo, x.occurrences.length, x.conflictFields])).toEqual([
      ["CT26-0000020", 2, []],
      ["CT26-0000021", 2, ["mail", "service", "time"]],
    ]);
  });

  it("หลายไฟล์: เจอเลขเดียวกันทั้ง 2 ไฟล์ค่าต่างกัน = conflict เหมือนกัน", () => {
    const idx = buildJobOpeningIndex([
      { label: "2569", sheets: [sheetNew("ม.ค.26", [rowNew("CT25-0000030", d, null, null)])] },
      { label: "2568", sheets: [sheetNew("ธ.ค.", [rowNew("CT25-0000030", d - 40, null, null)])] },
    ]);
    expect(idx.entries.get("CT25-0000030")!.mail.conflict).toBe(true);
  });

  it("ปี พ.ศ. / ข้อความ / ช่วงเวลา นับในสถิติชีท", () => {
    const idx = buildJobOpeningIndex([
      { label: "2569", sheets: [sheetNew("ต.ค.26", [rowNew("CT26-0000040", serial(2569, 10, 3), "7/10/2026", "09.00-10.00 น.")])] },
    ]);
    expect(idx.sheets[0]).toMatchObject({ buddhistYearFixes: 1, textDates: 1, timeRanges: 1, problems: 0 });
    expect(idx.entries.get("CT26-0000040")).toMatchObject({ timeFromRange: true, time: { value: "09:00" } });
  });
});
