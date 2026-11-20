import { describe, expect, it } from "vitest";

import { csvCell, registryCsv, registryFileName, tierText } from "./registryExport";
import type { RegistryRow } from "./registryTypes";

const row: RegistryRow = {
  contractId: "c1",
  customerId: "u1",
  customerName: 'บริษัท "เอ" จำกัด, สาขา 1',
  customerTypeLabel: "โรงงาน",
  contractNo: "CT26-0000001",
  startDate: "2026-01-15",
  endDate: "2027-01-14",
  termMonths: 12,
  valueTotal: 150000,
  annualValue: 150000,
  tier: "XL",
  branchId: "b1",
  branchName: "พุทธมณฑล",
  zoneName: "เขต 1",
  stationCount: 24,
  dbStatus: "active",
  status: "near_end",
  cursor: { value: "2026-01-15", id: "c1" },
};

describe("registryExport", () => {
  it("ครอบเครื่องหมายคำพูด/คอมมา · กัน formula injection · ตัวเลขไม่แตะ", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+66")).toBe("'+66");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(NaN)).toBe("");
  });

  it("tierText: กลุ่มสีตามระยะ (36 = 3 · อื่น = 1) · ไม่มี Tier = ว่าง", () => {
    expect(tierText({ tier: "L", termMonths: 36 })).toBe("L3");
    expect(tierText({ tier: "S", termMonths: 5 })).toBe("S1");
    expect(tierText({ tier: null, termMonths: 12 })).toBe("");
  });

  it("CSV มี BOM + หัวตาราง + 1 แถว/สัญญา วันที่ DD/MM/YYYY", () => {
    const csv = registryCsv([row]);
    expect(csv.startsWith("﻿#,ชื่อลูกค้า,เลขที่สัญญา")).toBe(true);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('1,"บริษัท ""เอ"" จำกัด, สาขา 1",CT26-0000001,พุทธมณฑล,เขต 1,โรงงาน,15/01/2026,14/01/2027,12,150000,150000,XL1,24,ใกล้หมด');
  });

  it("ชื่อไฟล์มีวันที่", () => {
    expect(registryFileName("2026-11-20")).toBe("AGA-ทะเบียนลูกค้า-สัญญา-2026-11-20.csv");
  });
});
