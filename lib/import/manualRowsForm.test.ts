/**
 * แบบฟอร์มกรอกแถวที่นำเข้าไม่ได้ (DECISIONS 2.104) — ตัวอ่าน/ตรวจ + แผน append (ข้อมูลสมมติทั้งหมด · ชื่อ/เบอร์/ที่อยู่/เลขสัญญาเป็นค่าสมมติ)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import { REGISTRY_IMPORT_BATCH_OCT26 } from "./centralRegistrySheets";
import {
  FIXED_NO,
  FIXED_YES,
  FORM_COLUMNS,
  assertFixBatch,
  formHeaders,
  formRowValues,
  manualRowKey,
  parseCsv,
  parseManualListMarkdown,
  planManualRows,
  readManualRowsForm,
  toCsv,
  type FormRow,
} from "./manualRowsForm";
import type { CellValue } from "./registrySheet";
import type { SellerIndex } from "./sellerLookup";

/** แถวแบบฟอร์มสมมติ (ค่าผ่านทุกช่อง) */
function row(over: Partial<FormRow> = {}): FormRow {
  const base = Object.fromEntries(FORM_COLUMNS.map((c) => [c.key, ""])) as FormRow;
  return {
    ...base,
    seq: "1",
    branch: "สาทร",
    file: "ไฟล์สมมติ.xlsx",
    sheet: "สาทร",
    excelRow: "19",
    reason: "เหตุผลสมมติ",
    fixed: FIXED_YES,
    contractNo: "CT26-9000001",
    customerName: "ลูกค้าสมมติ 1",
    customerType: "H",
    startDate: "15/01/2026",
    endDate: "14/01/2027",
    value1y: "15000",
    saleType: "New",
    team: "A",
    phone: "0810000001",
    address: "ที่อยู่สมมติ 1",
    ...over,
  };
}

const grid = (rows: FormRow[], extra: CellValue[][] = []): CellValue[][] => [formHeaders(), ...rows.map(formRowValues), ...extra];
const KNOWN = new Set([manualRowKey("สาทร", 19), manualRowKey("สาทร", 55), manualRowKey("ปทุมวัน", 7), manualRowKey("ปทุมวัน", 8)]);
const FAKE_PII = ["ลูกค้าสมมติ", "0810000001", "ที่อยู่สมมติ", "31/02/2026", "15/01/2569"];

function noPii(reasons: string[]): void {
  for (const r of reasons) for (const p of FAKE_PII) expect(r).not.toContain(p);
}

describe("readManualRowsForm", () => {
  it("รับเฉพาะแถว แก้แล้ว = ใช่ · ไม่/ว่าง = ไม่นำเข้า (ไม่ใช่ข้อผิดพลาด) · นับแยก", () => {
    const res = readManualRowsForm(
      grid([
        row(),
        row({ excelRow: "55", contractNo: "CT26-9000002", fixed: FIXED_NO }),
        row({ branch: "ปทุมวัน", sheet: "ปทุมวัน", excelRow: "7", contractNo: "CT26-9000003", fixed: "" }),
      ]),
      { knownRows: KNOWN },
    );
    expect(res.counts).toMatchObject({ rows: 3, fixedYes: 1, fixedNo: 1, fixedBlank: 1, fixedOther: 0, accepted: 1, invalid: 0 });
    const a = res.accepted[0]!;
    expect(a).toMatchObject({ key: "สาทร|19", branch: "สาทร", area: "เขต 2", excelRow: 19, formRow: 2 });
    expect(a.cleaned).toMatchObject({
      contractNo: "CT26-9000001",
      customerType: "บ้านเดี่ยว",
      startDate: "2026-01-15",
      endDate: "2027-01-14",
      termMonths: 12,
      valueTotal: 15000,
      saleType: "new",
      teams: ["A"],
    });
    expect(a.phones.phones).toEqual([{ phone: "0810000001", label: null }]);
    expect(a.address.address).toBe("ที่อยู่สมมติ 1");
  });

  it("แถวค่าผิดถูกรายงาน (สาขา + แถว + เหตุผล) แล้วข้าม · เหตุผลไม่มีค่าจริง", () => {
    const res = readManualRowsForm(
      grid([
        row({ endDate: "31/02/2026" }),
        row({ excelRow: "55", contractNo: "CT26-9000002", startDate: "15/01/2569" }),
        row({ branch: "ปทุมวัน", sheet: "ปทุมวัน", excelRow: "7", contractNo: "CT26-9000003", value1y: "", value3y: "" }),
        row({ branch: "ปทุมวัน", sheet: "ปทุมวัน", excelRow: "8", contractNo: "CT26-9000004", saleType: "ใหม่" }),
      ]),
      { knownRows: KNOWN },
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.invalid.map((p) => [p.branch, p.excelRow, p.formRow])).toEqual([
      ["สาทร", 19, 2],
      ["สาทร", 55, 3],
      ["ปทุมวัน", 7, 4],
      ["ปทุมวัน", 8, 5],
    ]);
    expect(res.invalid[0]!.reasons.join()).toContain("วันที่ไม่มีจริง");
    expect(res.invalid[1]!.reasons.join()).toContain("ปี พ.ศ.");
    expect(res.invalid[2]!.reasons.join()).toContain("ไม่มีมูลค่าสัญญา");
    expect(res.invalid[3]!.reasons.join()).toContain("New/Renew");
    for (const p of res.invalid) noPii(p.reasons);
  });

  it("ตัวระบุแถว: ไม่อยู่ในรายการ / ซ้ำ / สาขาผิด / ค่าแก้แล้วแปลก = รายงาน", () => {
    const res = readManualRowsForm(
      grid([
        row(),
        row({ contractNo: "CT26-9000009" }), // ซ้ำ สาทร|19
        row({ excelRow: "999", contractNo: "CT26-9000010" }), // ไม่อยู่ในรายการ
        row({ branch: "สาขาสมมติ", excelRow: "1" }),
        row({ excelRow: "55", contractNo: "CT26-9000011", fixed: "Yes" }),
      ]),
      { knownRows: KNOWN },
    );
    expect(res.accepted.map((a) => a.formRow)).toEqual([2]);
    expect(res.invalid.map((p) => [p.formRow, p.reasons[0]])).toEqual([
      [3, expect.stringContaining("แถวซ้ำ")],
      [4, expect.stringContaining("ไม่อยู่ในรายการ")],
      [5, expect.stringContaining("ช่องสาขา")],
      [6, expect.stringContaining("แก้แล้ว")],
    ]);
    expect(res.invalid[2]!.branch).toBe("");
    expect(res.counts.fixedOther).toBe(1);
  });

  it("เลขสัญญาซ้ำกันในแบบฟอร์ม = แถวหลังไม่ผ่าน", () => {
    const res = readManualRowsForm(grid([row(), row({ excelRow: "55" })]), { knownRows: KNOWN });
    expect(res.accepted.map((a) => a.excelRow)).toEqual([19]);
    expect(res.invalid[0]!.reasons.join()).toContain("ซ้ำ");
  });

  it("Custom 5 เดือน: มูลค่าช่อง 1 ปี + จำนวนเดือน 5 (M30 · มูลค่าจริงไม่ขยายต่อปี)", () => {
    const res = readManualRowsForm(grid([row({ startDate: "15/01/2026", endDate: "14/06/2026", value1y: "50000", termMonths: "5" })]));
    expect(res.invalid).toEqual([]);
    expect(res.accepted[0]!.cleaned).toMatchObject({ termMonths: 5, valueTotal: 50000 });
  });

  it("3 ปี: มูลค่าช่อง 3 ปี · วันที่ไม่ใช่ 3 ปี = ไม่ผ่าน", () => {
    const ok = readManualRowsForm(grid([row({ startDate: "01/01/2026", endDate: "31/12/2028", value1y: "", value3y: "150000" })]));
    expect(ok.accepted[0]!.cleaned).toMatchObject({ termMonths: 36, valueTotal: 150000 });
    const bad = readManualRowsForm(grid([row({ startDate: "01/01/2026", endDate: "31/12/2026", value1y: "", value3y: "150000" })]));
    expect(bad.invalid[0]!.reasons.join()).toContain("ช่องมูลค่า 3 ปี แต่วันเริ่ม–วันสิ้นสุดไม่ใช่ 3 ปี");
  });

  it("ค่าที่ Excel เก็บเป็นตัวเลข: วันที่ serial อ่านได้ · มูลค่าตัวเลขอ่านได้ · เบอร์ตัวเลข = ไม่เก็บเบอร์ + เตือน", () => {
    const g = grid([row()]);
    const c = (k: string) => FORM_COLUMNS.findIndex((x) => x.key === k);
    g[1]![c("startDate")] = 46037; // 2026-01-15
    g[1]![c("endDate")] = 46401; // 2027-01-14
    g[1]![c("value1y")] = 15000.5;
    g[1]![c("phone")] = 810000001;
    const res = readManualRowsForm(g);
    expect(res.invalid).toEqual([]);
    const a = res.accepted[0]!;
    expect(a.cleaned).toMatchObject({ startDate: "2026-01-15", endDate: "2027-01-14", valueTotal: 15000.5 });
    expect(a.phones.phones).toEqual([]);
    expect(a.warnings.join()).toContain("เบอร์โทรเป็นตัวเลข");
    noPii(a.warnings);
  });

  it("ชื่อผู้ติดต่อ = ป้ายของเบอร์แรก · ประเภทว่าง = อื่นๆ (ข3) · ตำแหน่ง AM → am_name", () => {
    const res = readManualRowsForm(
      grid([row({ phone: "0810000001 / 020000002", contactLabel: "คุณสมมติ", customerType: "", seller: "ผู้ขายสมมติ", sellerPosition: "AM" })]),
    );
    const a = res.accepted[0]!;
    expect(a.phones.phones).toEqual([
      { phone: "0810000001", label: "คุณสมมติ" },
      { phone: "020000002", label: null },
    ]);
    expect(a.cleaned).toMatchObject({ customerType: "อื่นๆ (ระบุในหมายเหตุ)", amName: "ผู้ขายสมมติ", saleName: null });
  });

  it("ผู้ขายว่าง → จับคู่ไฟล์เปิดงานด้วยเลขสัญญาในฟอร์ม (ตัวที่แก้แล้ว) · มีค่าในฟอร์ม = ใช้ค่าฟอร์ม · ไม่เจอ = ว่าง", () => {
    const entry = (name: string, position: string) => ({ seller: { name, position }, conflict: false, noSellerColumn: false });
    const sellerIndex: SellerIndex = {
      entries: new Map([
        ["CT26-9000001", entry("ผู้ขายสมมติ AM", "AM")],
        ["CT26-9000002", entry("ผู้ขายสมมติ Sale", "Sale")],
      ]),
      contracts: 2,
      sheetsRead: [],
      sheetsWithoutSeller: [],
      sheetsSkipped: [],
      crossSourceConflicts: new Set(),
    };
    const res = readManualRowsForm(
      grid([
        row(), // เลขแก้แล้ว CT26-9000001 · ผู้ขายว่าง → AM
        row({ excelRow: "55", contractNo: "CT26-9000002", seller: "ผู้ขายในฟอร์ม", sellerPosition: "AM" }), // ฟอร์มชนะ
        row({ branch: "ปทุมวัน", sheet: "ปทุมวัน", excelRow: "7", contractNo: "CT26-9000003" }), // ไม่เจอ
      ]),
      { knownRows: KNOWN, sellerIndex },
    );
    expect(res.invalid).toEqual([]);
    expect(res.counts.sellerMatched).toBe(1);
    expect(res.accepted.map((a) => [a.cleaned.saleName, a.cleaned.amName])).toEqual([
      [null, "ผู้ขายสมมติ AM"],
      [null, "ผู้ขายในฟอร์ม"],
      [null, null],
    ]);
  });

  it("หัวคอลัมน์หาย/ถูกแก้ = หยุดทั้งไฟล์", () => {
    const g = grid([row()]);
    g[0] = g[0]!.map((h) => (h === "เบอร์โทร" ? "เบอร์" : h));
    expect(() => readManualRowsForm(g)).toThrow(/ไม่พบหัวคอลัมน์ "เบอร์โทร"/);
    expect(() => readManualRowsForm([["อะไรก็ได้"]])).toThrow(/ไม่พบแถวหัวตาราง/);
  });

  it("CSV: toCsv → parseCsv (มี BOM · ค่ามี , \" และขึ้นบรรทัด) ได้ค่าเดิม แล้วอ่านแบบฟอร์มได้", () => {
    const rows = [formHeaders(), formRowValues(row({ address: "เลขที่ 1, ถนน \"สมมติ\"\nแขวงสมมติ" }))];
    const back = parseCsv(`﻿${toCsv(rows)}`);
    expect(back).toEqual(rows);
    const res = readManualRowsForm(back);
    expect(res.accepted[0]!.address.address).toBe('เลขที่ 1, ถนน "สมมติ" แขวงสมมติ');
  });
});

describe("planManualRows", () => {
  const read = readManualRowsForm(
    grid([
      row(),
      row({ branch: "ปทุมวัน", sheet: "ปทุมวัน", excelRow: "7", contractNo: "CT26-9000003", value1y: "", value3y: "150000", startDate: "01/07/2026", endDate: "30/06/2029", team: "B,C" }),
    ]),
    { knownRows: KNOWN },
  );

  it("แผนรายสาขา + ยอดที่คาด · import_batch = รอบแก้", () => {
    const { plan, skippedExisting } = planManualRows(read.accepted, { rules: TIER_RULES, month: "2026-10", importBatch: "registry-OCT26-fix1" });
    expect(skippedExisting).toEqual([]);
    expect(plan.importBatch).toBe("registry-OCT26-fix1");
    expect(plan.branches.map((b) => [b.branch, b.contracts.length])).toEqual([
      ["สาทร", 1],
      ["ปทุมวัน", 1],
    ]);
    expect(plan.totals).toMatchObject({ contracts: 2, mustFix: 0, held: 0, excluded: 0, withAddress: 2 });
    const pathum = plan.branches[1]!;
    expect(pathum.contracts[0]).toMatchObject({ termMonths: 36, teamCodes: ["B", "C"], status: "active", excelRow: 7 });
    expect(pathum.expected).toMatchObject({ cust: 1, m3: 0, l3: 1, value: 150000 }); // CLAUDE.md: 150,000 / 3 ปี → L3
  });

  it("เลขสัญญาที่มีใน DB แล้ว = ข้าม (รายงานเลขสัญญา + แถว) · ยอดคิดจากแถวที่เหลือ", () => {
    const { plan, skippedExisting } = planManualRows(read.accepted, {
      rules: TIER_RULES,
      month: "2026-10",
      importBatch: "registry-OCT26-fix2",
      skipContractNos: new Set(["CT26-9000001"]),
    });
    expect(skippedExisting).toEqual([{ formRow: 2, branch: "สาทร", excelRow: 19, contractNo: "CT26-9000001" }]);
    expect(plan.branches.map((b) => b.branch)).toEqual(["ปทุมวัน"]);
    expect(plan.totals.contracts).toBe(1);
  });

  it("ชื่อรอบ (batch) บังคับ: ว่าง / รอบแรก / รูปอื่น = หยุด", () => {
    const opts = { rules: TIER_RULES, month: "2026-10" };
    expect(() => planManualRows(read.accepted, { ...opts, importBatch: "" })).toThrow();
    expect(() => planManualRows(read.accepted, { ...opts, importBatch: REGISTRY_IMPORT_BATCH_OCT26 })).toThrow(/fix<เลขรอบ>/);
    expect(() => assertFixBatch(undefined)).toThrow(/--batch/);
    expect(() => assertFixBatch("registry-OCT26-fixA")).toThrow(/fix<เลขรอบ>/);
    expect(assertFixBatch("registry-OCT26-fix12")).toBe("registry-OCT26-fix12");
  });
});

describe("แม่แบบเปล่า docs/templates/manual-rows-form-template.csv", () => {
  it("มีแค่แถวหัว ตรงกับคอลัมน์ในโค้ดทุกตัว (เปลี่ยนคอลัมน์ต้องแก้แม่แบบด้วย)", () => {
    const text = readFileSync(resolve(process.cwd(), "docs/templates/manual-rows-form-template.csv"), "utf8");
    expect(text.startsWith("﻿")).toBe(true);
    expect(parseCsv(text)).toEqual([formHeaders()]);
  });
});

describe("parseManualListMarkdown", () => {
  it("อ่านเฉพาะตาราง สาขา | แถว | เหตุผล (ไม่นับตารางสรุป)", () => {
    const md = ["| สาขา | แถวที่ต้องกรอกมือ |", "|---|---|", "| สาทร | 2 |", "", "| สาขา | แถว | เหตุผล |", "|---|---|---|", "| สาทร | 19 | เหตุผลสมมติ |", "| พระราม 4 | 30 | อีกเหตุผล · ข้อสอง |"].join("\n");
    expect(parseManualListMarkdown(md)).toEqual([
      { branch: "สาทร", excelRow: 19 },
      { branch: "พระราม 4", excelRow: 30 },
    ]);
  });
});
