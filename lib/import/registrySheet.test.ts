/**
 * เทสตัวแปลงชีททะเบียน + dry-run ด้วยข้อมูลสมมติ (ไม่มีข้อมูลลูกค้าจริง · รันได้ใน CI)
 * โครงชีทจำลองตามทะเบียนเขต 1: หัวตาราง 2 แถว · บางชีทมีคอลัมน์ IC เพิ่ม · บล็อกสรุปท้ายชีท
 */
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { dryRunRegistrySheet } from "./registryDryRun";
import {
  excelSerialToIso,
  parseDateRangeText,
  parseRegistrySheet,
  readRegistryTierSummary,
  type CellValue,
} from "./registrySheet";
import { buildSellerIndex } from "./sellerLookup";
import { columnIndex } from "./xlsx/readXlsx";

/** serial ของ Excel สำหรับวันที่ (ย้อนสูตรของ excelSerialToIso) */
function serial(iso: string): number {
  return (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** แถวหัวแบบชีท "มี IC" (เลขที่สัญญาอยู่แถวบน · New/Renew อยู่แถวล่าง) — ข้อมูลสมมติ */
const TOP_WITH_IC: CellValue[] = ["ลำดับ", "ชื่อลูกค้า", "ที่อยู่ลูกค้า", "เลขที่สัญญา", "เบอร์โทรลูกค้า", "Site plan", null, "ระยะสัญญา", null, "มูลค่าสัญญา", null, "ประเภทลูกค้า", "ประเภทสัญญา"];
const BOTTOM_WITH_IC: CellValue[] = [null, null, null, null, null, "IG", "IC", "เริ่ม", "สิ้นสุด", "1 ปี", "3 ปี", "H = บ้าน /T = ทาวน์โฮม/R=ห้อง", "New", "Renew", "ทีม"];

/** แถวหัวแบบชีท "ไม่มี IC" (เลขที่สัญญาอยู่แถวล่าง · หัว New/Renew เป็น "False") — ข้อมูลสมมติ */
const TOP_NO_IC: CellValue[] = [null, null, null, null, null, "Site plan", "ระยะสัญญา", null, "มูลค่าสัญญา", null, "ประเภทลูกค้า", "ประเภทสัญญา"];
const BOTTOM_NO_IC: CellValue[] = ["ลำดับ", "ชื่อลูกค้า", "ที่อยู่ลูกค้า", "เลขที่สัญญา", "เบอร์โทรลูกค้า", "IG", "เริ่ม", "สิ้นสุด", "1 ปี", "3 ปี", "H = บ้าน /T = ทาวน์โฮม/R=ห้อง", false, false, "ทีม"];

function sheetNoIc(dataRows: CellValue[][]): CellValue[][] {
  return [[], ["  สาขาสมมติ ประจำปี 2569"], [], TOP_NO_IC, BOTTOM_NO_IC, ...dataRows];
}

describe("excelSerialToIso / columnIndex", () => {
  it("แปลง serial ของ Excel เป็นวันที่ (ตัดเศษเวลา)", () => {
    expect(excelSerialToIso(45292)).toBe("2024-01-01");
    expect(excelSerialToIso(45292.75)).toBe("2024-01-01");
    expect(excelSerialToIso(serial("2026-10-31"))).toBe("2026-10-31");
    expect(excelSerialToIso(0)).toBeNull();
  });

  it("แปลงอ้างอิงคอลัมน์เป็น index เริ่ม 0", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AB12")).toBe(27);
    expect(columnIndex("JX5")).toBe(283);
  });
});

describe("parseRegistrySheet", () => {
  it("ชีทมี IC: หัวตาราง 2 แถว เลขที่สัญญาอยู่แถวบน · หาคอลัมน์จากชื่อหัว", () => {
    const grid: CellValue[][] = [
      [], [], [], TOP_WITH_IC, BOTTOM_WITH_IC,
      [1, "ลูกค้าสมมติ", "ที่อยู่สมมติ", "CT26-0000001", "080-000-0000", 6, 0, serial("2026-01-15"), serial("2027-01-14"), 15000, null, "H", true, false, "I"],
    ];
    const res = parseRegistrySheet(grid, "หัวหิน", { sellerPlaceholder: "x" });
    expect(res.headerRows).toEqual([4, 5]);
    expect(res.columns).toMatchObject({ contractNo: 3, startDate: 7, endDate: 8, value1y: 9, value3y: 10, customerType: 11, isNew: 12, isRenew: 13, team: 14 });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      excelRow: 6,
      phoneDigits: "0800000000",
      raw: { เลขที่สัญญา: "CT26-0000001", สาขา: "หัวหิน", ผู้ขาย: "x", เริ่ม: "2026-01-15", สิ้นสุด: "2027-01-14", "1 ปี": "15000", "3 ปี": "", ประเภท: "H", New: "TRUE", Renew: "FALSE", ทีม: "I" },
    });
  });

  it("ชีทไม่มี IC: หัว New/Renew เป็น False → ใช้คอลัมน์ 'ประเภทสัญญา' และคอลัมน์ถัดไป", () => {
    const res = parseRegistrySheet(sheetNoIc([]), "พุทธมณฑล");
    expect(res.headerRows).toEqual([4, 5]);
    expect(res.columns).toMatchObject({ contractNo: 3, startDate: 6, endDate: 7, value1y: 8, value3y: 9, customerType: 10, isNew: 11, isRenew: 12, team: 13 });
  });

  it("วันที่ที่พิมพ์เป็นข้อความ ส่งต่อตามเดิม (ให้ importContracts ตรวจ) · ข้ามแถวว่าง", () => {
    const grid = sheetNoIc([
      [1, "ก", "", "CT23-0000002", "", 6, serial("2023-12-01"), "31/11/2026", null, 70000, "H", false, false, "A"],
      [null, null, null, null, null, null, null, null, null, null, null, false, false, null],
    ]);
    const res = parseRegistrySheet(grid, "พุทธมณฑล");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.raw).toMatchObject({ เริ่ม: "2023-12-01", สิ้นสุด: "31/11/2026", ผู้ขาย: "" });
  });

  it("หัววันที่เขียนเต็ม 'เริ่มสัญญา'/'สิ้นสุดสัญญา' (แบบเขต 9 ปากช่อง) — ข้อมูลสมมติ", () => {
    const top: CellValue[] = ["ลำดับ", "ชื่อลูกค้า", "ที่อยู่ลูกค้า", "เลขที่สัญญา", "เบอร์ติดต่อ", "Site Plan", "Site Plan", "ระยะสัญญา ", null, null, null, "ประเภทลูกค้า", "ประเภทสัญญา"];
    const bottom: CellValue[] = [null, null, null, null, null, "IG", "IC", "เริ่มสัญญา", "สิ้นสุดสัญญา", "1 ปี", "3 ปี", "H = บ้าน /T = ทาวน์โฮม/R=ห้อง", "New", "Renew", "ทีม"];
    const grid: CellValue[][] = [
      [], [], [], top, bottom,
      [1, "สมมติ", "", "CT26-0000009", "", 4, 0, serial("2026-02-01"), serial("2027-01-31"), 20000, null, "H", true, false, "B"],
    ];
    const res = parseRegistrySheet(grid, "ปากช่อง");
    expect(res.headerRows).toEqual([4, 5]);
    expect(res.columns).toMatchObject({ contractNo: 3, startDate: 7, endDate: 8, value1y: 9, value3y: 10, customerType: 11, isNew: 12, isRenew: 13, team: 14 });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.raw).toMatchObject({ เริ่ม: "2026-02-01", สิ้นสุด: "2027-01-31", New: "TRUE" });
  });

  it("หัวตาราง 3 แถว (แบบเขต 9 สระบุรี): แถวที่ 3 เป็นหัวย่อย ไม่ถือเป็นข้อมูล — ข้อมูลสมมติ", () => {
    const r1: CellValue[] = ["ลำดับ", "ชื่อลูกค้า", "ที่อยู่ลูกค้า", "เบอร์โทรลูกค้า", "เลขที่สัญญา", "Site plan", null, "ระยะสัญญา "];
    const r2: CellValue[] = [null, null, null, null, null, "IG", "IC", null, null, "1 ปี", "3 ปี", "ประเภทลูกค้า", "ประเภทสัญญา"];
    const r3: CellValue[] = [null, null, null, null, null, null, null, "เริ่มสัญญา", "สิ้นสุดสัญญา", null, null, "H = บ้าน /T = ทาวน์โฮม/R=ห้อง", "New", "Renew", "ทีม"];
    const grid: CellValue[][] = [
      [], ["  สาขาสมมติ"], r1, r2, r3,
      [1, "สมมติ", "", "0800000000", "CT25-0000010", null, null, serial("2025-03-01"), serial("2026-02-28"), null, 45000, "T", false, true, "C"],
    ];
    const res = parseRegistrySheet(grid, "สระบุรี");
    expect(res.headerRows).toEqual([3, 5]);
    expect(res.columns).toMatchObject({ contractNo: 4, phone: 3, startDate: 7, endDate: 8, value1y: 9, value3y: 10, customerType: 11, isNew: 12, isRenew: 13, team: 14 });
    expect(res.rows.map((r) => r.excelRow)).toEqual([6]);
    expect(res.rows[0]!.raw).toMatchObject({ เลขที่สัญญา: "CT25-0000010", เริ่ม: "2025-03-01", "3 ปี": "45000", ประเภท: "T", Renew: "TRUE", ทีม: "C" });
  });

  it("readDateRangeText (ข้อเสนอ · ปิดไว้): ช่องวันที่ว่าง + ข้อความช่วงวันที่ทางซ้าย → อ่านเป็นวันเริ่ม/สิ้นสุด", () => {
    const top: CellValue[] = ["ลำดับ", "ชื่อลูกค้า", "ที่อยู่ลูกค้า", "เลขที่สัญญา", "เบอร์", "Site plan", null, "ระยะสัญญา ", null, null, null, null, "ประเภทลูกค้า", "ประเภทสัญญา"];
    const bottom: CellValue[] = [null, null, null, null, null, "IG", "IC", null, "เริ่ม", "สิ้นสุด", "1 ปี", "3 ปี", "H = บ้าน /T = ทาวน์โฮม/R=ห้อง", "New", "Renew", "ทีม"];
    const grid: CellValue[][] = [
      [], [], [], top, bottom,
      [1, "สมมติ", "", "CT24-0000001", "", 4, 0, "01/03/2024-28/02/2027", null, null, null, 60000, "H", false, true, "A"],
      [2, "สมมติ", "", "CT24-0000002", "", 4, 0, "15/06/2567 - 14/06/2570", null, null, null, 60000, "H", false, true, "A"],
      [3, "สมมติ", "", "CT24-0000003", "", 4, 0, "1/3/24-28/2/27", null, null, null, 60000, "H", false, true, "A"],
      [4, "สมมติ", "", "CT24-0000004", "", 4, 0, "01/03/2024-28/02/2027", serial("2024-03-05"), serial("2027-03-04"), null, 60000, "H", false, true, "A"],
    ];
    const off = parseRegistrySheet(grid, "นนทบุรี");
    expect(off.rows[0]!.raw).toMatchObject({ เริ่ม: "", สิ้นสุด: "" });
    expect(off.rows.some((r) => r.dateFromRangeText)).toBe(false);

    const on = parseRegistrySheet(grid, "นนทบุรี", { readDateRangeText: true });
    expect(on.rows[0]!.raw).toMatchObject({ เริ่ม: "2024-03-01", สิ้นสุด: "2027-02-28" });
    expect(on.rows[1]!.raw).toMatchObject({ เริ่ม: "2024-06-15", สิ้นสุด: "2027-06-14" }); // พ.ศ. → ค.ศ.
    expect(on.rows[2]!.raw).toMatchObject({ เริ่ม: "", สิ้นสุด: "" }); // ปี 2 หลัก = ไม่อ่าน
    expect(on.rows[3]!.raw).toMatchObject({ เริ่ม: "2024-03-05" }); // มีวันที่อยู่แล้ว = ใช้ช่องวันที่
    expect(on.rows.filter((r) => r.dateFromRangeText).map((r) => r.excelRow)).toEqual([6, 7]);
  });

  it("parseDateRangeText", () => {
    expect(parseDateRangeText("01/03/2024-28/02/2027")).toEqual(["2024-03-01", "2027-02-28"]);
    expect(parseDateRangeText(" 5/1/2568 - 4/1/2571 ")).toEqual(["2025-01-05", "2028-01-04"]);
    expect(parseDateRangeText("01/03/24-28/02/27")).toBeNull();
    expect(parseDateRangeText("03/2024-02/2027")).toBeNull();
    expect(parseDateRangeText("")).toBeNull();
  });

  it("ไม่พบหัวตาราง → throw", () => {
    expect(() => parseRegistrySheet([["อะไรก็ได้"]], "หัวหิน")).toThrow(/หัวตาราง/);
  });
});

describe("readRegistryTierSummary", () => {
  it("อ่านบล็อกสรุปท้ายชีท (ป้าย / จำนวน / มูลค่า)", () => {
    const labels = ["S1 (<30K)", "S3 (<90K)", "M1 (>30-49.9K)", "M3 (>30-49.9K)", "L1 (>50-99.9K)", "L3 (>150-299.9K)", "XL1 (>=100K)", "XL3 (>=300K)"];
    const grid: CellValue[][] = [
      [null, null, "Size.(ปี)", "จำนวน", "มูลค่า"],
      ...labels.map((l, i) => [null, null, l, i, i * 1000] as CellValue[]),
      [null, null, "รวมทั้งสิ้น", 28, 28000],
    ];
    const s = readRegistryTierSummary(grid);
    expect(s).not.toBeNull();
    expect(s!.excelRow).toBe(1);
    expect(s!.counts).toEqual({ s1: 0, s3: 1, m1: 2, m3: 3, l1: 4, l3: 5, xl1: 6, xl3: 7 });
    expect(s!.values.xl3).toBe(7000);
    expect(s!.totalCount).toBe(28);
  });

  it("ไม่มีบล็อก → null", () => {
    expect(readRegistryTierSummary([["a"]])).toBeNull();
  });
});

describe("dryRunRegistrySheet (ข้อมูลสมมติ)", () => {
  // 4 แถวสมมติ: ปกติ 3 ปี · ปกติ 1 ปี · วันสิ้นสุดไม่มีจริง · เริ่มเดือนถัดไป
  const grid = sheetNoIc([
    [1, "ลูกค้า ก", "", "CT24-0000001", "0811111111", 6, serial("2024-11-01"), serial("2027-10-31"), null, 60000, "H", false, true, "A"],
    [2, "ลูกค้า ข", "", "CT26-0000002", "0811111111", 6, serial("2026-01-15"), serial("2027-01-14"), 150000, null, "อาคาร", true, false, "A"],
    [3, "ลูกค้า ค", "", "CT23-0000003", "0822222222", 6, serial("2023-12-01"), "31/11/2026", null, 70000, "H", false, false, "A"],
    [4, "ลูกค้า ก", "", "CT26-0000004", "0833333333", 6, serial("2026-10-05"), serial("2027-10-04"), 20000, null, "บ้านพัก", true, false, "A"],
    [],
  ]);
  const res = dryRunRegistrySheet("พุทธมณฑล", grid, { rules: TIER_RULES, months: ["2026-09", "2026-10"] });

  it("แยก strict (ปัญหาประเภทลูกค้า) กับ lenient (เหลือแค่ปัญหาวันที่/มูลค่า) พร้อมเลขแถว Excel", () => {
    expect(res.contractRows).toBe(4);
    // แถว 6 (H → บ้านเดี่ยว) + แถว 7 (อาคาร → ออฟฟิต) · แถว 9 "บ้านพัก" ไม่อยู่ในตารางแปลง
    expect(res.strict.ready).toBe(2);
    expect(res.strict.errors['ไม่รู้จักประเภท "…"']).toEqual({ count: 1, excelRows: [9] });
    expect(res.lenient.ready).toBe(3);
    expect(res.lenient.errors["วันสิ้นสุด: วันที่ไม่มีจริง (…)"]).toEqual({ count: 1, excelRows: [8] });
  });

  it("strictProblems: ปัญหารายแถว (ชนิด ไม่มีค่าจริง) · ไม่ส่งไฟล์เปิดงาน = ผู้ขายว่างแต่ยังนำเข้าได้", () => {
    expect(res.strictProblems).toEqual([
      { excelRow: 8, kinds: ["วันสิ้นสุด: วันที่ไม่มีจริง (…)"] },
      { excelRow: 9, kinds: ['ไม่รู้จักประเภท "…"'] },
    ]);
    expect(res.sellers).toBeNull();
    // เตือนทุกแถวที่ไม่มีผู้ขาย (ทั้งที่ผ่านและไม่ผ่าน)
    expect(res.strict.warnings["ไม่ทราบผู้ขาย (…)"]?.excelRows.sort()).toEqual([6, 7, 8, 9]);
  });

  it("option branch: ใช้ชื่อสาขาจากตารางชีท (ชื่อชีทสะกดต่าง) · ชื่อปลายทางต้องตรง master เป๊ะ", () => {
    const viaTable = dryRunRegistrySheet("พระราม4", grid, { rules: TIER_RULES, months: ["2026-10"], branch: "พระราม 4" });
    expect(viaTable).toMatchObject({ sheet: "พระราม4", branch: "พระราม 4", area: "เขต 2" });
    expect(viaTable.snapshots["2026-10"]!.lenient.branch).toBe("พระราม 4");
    expect(viaTable.strict.fixes['สาขา "…" → พระราม 4']).toBeUndefined();
    expect(() => dryRunRegistrySheet("พระราม4", grid, { rules: TIER_RULES, months: [], branch: "พระราม4" })).toThrow(/ตรง master/);
  });

  it("customerTypeValues นับค่าประเภทดิบของแถวสัญญา", () => {
    expect(res.customerTypeValues).toEqual({ H: 2, อาคาร: 1, บ้านพัก: 1 });
  });

  it("holdRows: แถวที่ผ่านกฎแต่สั่งกันไว้ → ไม่นับใน strict ready/snapshot · แถวที่ไม่ผ่านอยู่แล้วไม่ซ้ำใน heldRows", () => {
    const held = dryRunRegistrySheet("พุทธมณฑล", grid, {
      rules: TIER_RULES,
      months: ["2026-10"],
      holdRows: [
        { excelRow: 7, reason: "มูลค่าสูงผิดปกติ" },
        { excelRow: 8, reason: "ทดสอบ (ไม่ผ่านอยู่แล้ว)" },
      ],
    });
    expect(held.strict.ready).toBe(1);
    expect(held.strict.held).toEqual([7]);
    expect(held.heldRows).toEqual([{ excelRow: 7, reason: "มูลค่าสูงผิดปกติ" }]);
    expect(held.snapshots["2026-10"]!.strict).toMatchObject({ cust: 1, xl1: 0 });
    // lenient (ตัวเทียบสูตร) ไม่โดน hold
    expect(held.snapshots["2026-10"]!.lenient.xl1).toBe(1);
  });

  it("จับคู่ผู้ขายจากไฟล์เปิดงาน: นับจำนวนเท่านั้น (ตำแหน่ง · ไม่เจอแยกปีสัญญา) ไม่มีชื่อผู้ขายในผลลัพธ์", () => {
    const sellerIndex = buildSellerIndex([
      {
        name: "ม.ค.26",
        rows: [
          ["ลำดับ", "เลขที่สัญญา", "รายชื่อ", "ผู้ขาย", "ตำแหน่ง"],
          [1, "CT26-0000002", "ลูกค้า ข", "ผู้ขายสมมติ ซ", "AM"],
        ],
      },
    ]);
    const withSeller = dryRunRegistrySheet("พุทธมณฑล", grid, { rules: TIER_RULES, months: ["2026-10"], sellerIndex });
    expect(withSeller.sellers).toEqual({
      matched: 1,
      blank: 0,
      conflict: 0,
      noSellerColumn: 0,
      notFound: 1,
      matchedByPosition: { AM: 1 },
      matchedBySource: { "": 1 }, // ดัชนีไฟล์เดียว ไม่มีป้ายไฟล์
      crossSourceConflicts: 0,
      notFoundByContractYear: { "24": 1 },
      saleName: 0,
      amName: 1, // ตำแหน่ง AM → am_name
    });
    expect(withSeller.strict.warnings["ไม่ทราบผู้ขาย (…)"]?.excelRows.sort()).toEqual([6, 8, 9]);
    expect(JSON.stringify(withSeller)).not.toMatch(/ผู้ขายสมมติ/);
  });

  it("snapshot ใช้ lib/rules: เดือน 2026-10 นับครบ · 2026-09 ไม่นับสัญญาที่เริ่ม ต.ค.", () => {
    const oct = res.snapshots["2026-10"]!.lenient;
    expect(oct).toMatchObject({ area: "เขต 1", branch: "พุทธมณฑล", s3: 1, xl1: 1, s1: 1, cust: 3, value: 230000 });
    const sep = res.snapshots["2026-09"]!;
    expect(sep.lenient.cust).toBe(2);
    expect(sep.notCounted).toEqual({ endedBefore: [], startsAfter: [9] });
  });

  it("รายงานลูกค้าซ้ำเป็นเลขแถวเท่านั้น (เบอร์เดียวกันชื่อต่าง · ชื่อเดียวกันหลายแถว)", () => {
    expect(res.duplicates.samePhoneDifferentName).toEqual([[6, 7]]);
    expect(res.duplicates.sameName).toEqual([[6, 9]]);
    expect(JSON.stringify(res)).not.toMatch(/ลูกค้า ก|0811111111/);
  });

  it("วันที่ที่พิมพ์เป็นข้อความ + มูลค่าสูงสุด อ้างเลขแถว", () => {
    expect(res.outliers.textDates).toEqual([8]);
    expect(res.outliers.topAnnual[0]).toMatchObject({ excelRow: 7, annual: 150000 });
  });
});
