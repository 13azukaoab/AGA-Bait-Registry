import { describe, expect, it } from "vitest";

import { TIER_RULES } from "@/lib/rules/__fixtures__/tierRules";

import { resolveBranch, suggestBranches, type BranchOption } from "./branchMatch";
import { checkContractNos, isValidContractNo, normalizeContractNo } from "./contractNo";
import {
  buildStoragePath,
  checkCompressed,
  checkFile,
  classifySize,
  isValidReason,
  MB,
  safeFileName,
} from "./fileRules";
import { applyFilters, monthOptions, type FilterableRow, type RowFilters } from "./filters";
import {
  autoEndDate,
  contractDays,
  endDateWarning,
  formatMoney,
  isPlausibleDate,
  monthsOf,
  parseMoney,
  tierFor,
} from "./rowCalc";

describe("contractNo", () => {
  it("ตัดช่องว่าง + พิมพ์ใหญ่", () => {
    expect(normalizeContractNo(" ct26-0021813 ")).toBe("CT26-0021813");
  });
  it("ตรวจรูปแบบ", () => {
    expect(isValidContractNo("CT26-0021813")).toBe(true);
    expect(isValidContractNo("CT26-21813")).toBe(false);
    expect(isValidContractNo("ct26-0021813")).toBe(false); // ต้อง normalize ก่อน
  });
  it("จับเลขซ้ำและรูปแบบผิดต่อแถว", () => {
    const e = checkContractNos(["CT26-0000001", "ct26-0000001 ", "CT26-0000002", "XX", ""]);
    expect(e.get(0)).toMatch(/ซ้ำ/);
    expect(e.get(1)).toMatch(/ซ้ำ/);
    expect(e.has(2)).toBe(false);
    expect(e.get(3)).toMatch(/รูปแบบ/);
    expect(e.has(4)).toBe(false);
  });
});

describe("branchMatch", () => {
  const branches: BranchOption[] = [
    { id: "1", name: "พระราม 2", zoneId: "z2", zoneName: "เขต 2" },
    { id: "2", name: "พระราม 4", zoneId: "z2", zoneName: "เขต 2" },
    { id: "3", name: "นครปฐม", zoneId: "z1", zoneName: "เขต 1" },
  ];
  it("รับเฉพาะชื่อใน master (ไม่สนช่องว่าง)", () => {
    expect(resolveBranch("พระราม2", branches)?.id).toBe("1");
    expect(resolveBranch("นนทบรี", branches)).toBeNull();
    expect(resolveBranch("", branches)).toBeNull();
  });
  it("เดาคำ: ขึ้นต้นก่อน", () => {
    expect(suggestBranches("พระ", branches).map((b) => b.id)).toEqual(["1", "2"]);
    expect(suggestBranches("ปฐม", branches).map((b) => b.id)).toEqual(["3"]);
  });
});

describe("rowCalc", () => {
  it("Tier ตามกรณีบังคับของ SPEC (เกณฑ์รับจาก tier_rules)", () => {
    expect(tierFor(50000, 3, TIER_RULES)?.label).toBe("S3");
    expect(tierFor(150000, 1, TIER_RULES)?.label).toBe("XL1");
    expect(tierFor(150000, 3, TIER_RULES)?.label).toBe("L3");
    expect(tierFor(29999.5, 1, TIER_RULES)?.label).toBe("S1");
    expect(tierFor(150000, 3, TIER_RULES)?.key).toBe("l3");
  });
  it("ข้อมูลไม่ครบ/ไม่มีเกณฑ์ = null", () => {
    expect(tierFor(null, 1, TIER_RULES)).toBeNull();
    expect(tierFor(1000, null, TIER_RULES)).toBeNull();
    expect(tierFor(1000, 1, [])).toBeNull();
  });
  it("วันสิ้นสุดอัตโนมัติ", () => {
    expect(autoEndDate("2026-01-15", 1)).toBe("2027-01-14");
    expect(autoEndDate("2026-04-03", 1)).toBe("2027-04-02");
    expect(autoEndDate("2026-01-01", 3)).toBe("2028-12-31");
    expect(autoEndDate("2026-02-31", 1)).toBeNull();
  });
  it("เดือนบริการ = เดือนเริ่ม + ปี×12", () => {
    const m = monthsOf("2026-01-01", 3);
    expect(m).toHaveLength(36);
    expect(m[0]).toBe("2026-01");
    expect(m[35]).toBe("2028-12");
    expect(monthsOf("2026-04-03", 1)[11]).toBe("2027-03");
  });
  it("คำเตือนวันสิ้นสุด", () => {
    expect(endDateWarning("2026-10-01", "2027-09-30", 1)).toBeNull();
    expect(endDateWarning("2026-10-01", "2027-10-31", 1)).toBe("ระยะ 396 วัน");
    expect(endDateWarning("2026-10-01", "2026-09-01", 1)).toMatch(/ก่อนวันเริ่ม/);
    expect(endDateWarning("2026-10-01", "8202-10-15", 1)).toMatch(/ไม่ถูกต้อง/);
    expect(endDateWarning("2026-10-01", "", 1)).toBeNull();
  });
  it("วันที่/จำนวนวัน", () => {
    expect(isPlausibleDate("8202-10-15")).toBe(false);
    expect(isPlausibleDate("2026-10-15")).toBe(true);
    expect(contractDays("2026-10-01", "2026-10-01")).toBe(1);
  });
  it("มูลค่า", () => {
    expect(parseMoney("33,426.80")).toBe(33426.8);
    expect(parseMoney("0")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(formatMoney(33426.8)).toBe("33,426.80");
  });
});

describe("fileRules", () => {
  it("แบ่งตามขนาด 5 / 10 MB", () => {
    expect(classifySize(5 * MB)).toBe("ok");
    expect(classifySize(5 * MB + 1)).toBe("compress");
    expect(classifySize(10 * MB)).toBe("compress");
    expect(classifySize(10 * MB + 1)).toBe("too_large");
  });
  it("ชนิดไฟล์ตามประเภท", () => {
    expect(checkFile("contract_pdf", { type: "image/png", size: 100 }).ok).toBe(false);
    expect(checkFile("site_plan", { type: "image/png", size: 100 }).ok).toBe(true);
    expect(checkFile("site_plan", { type: "text/plain", size: 100 }).ok).toBe(false);
    expect(checkFile("contract_pdf", { type: "application/pdf", size: 0 }).ok).toBe(false);
    const big = checkFile("contract_pdf", { type: "application/pdf", size: 11 * MB });
    expect(big.ok).toBe(false);
    expect(big.error).toMatch(/ใหญ่เกินไป/);
    expect(checkFile("contract_pdf", { type: "application/pdf", size: 7 * MB }).verdict).toBe("compress");
  });
  it("บีบแล้วต้อง ≤ 5 MB", () => {
    expect(checkCompressed(4 * MB).ok).toBe(true);
    expect(checkCompressed(6 * MB).ok).toBe(false);
  });
  it("ชื่อไฟล์/path ปลอดภัย", () => {
    expect(safeFileName("สัญญา ลูกค้า.PDF")).toBe("file.pdf");
    expect(safeFileName("site plan v2 (final).png")).toBe("site_plan_v2_final.png");
    expect(buildStoragePath("abc", "สัญญา.pdf", "123")).toBe("abc/123-file.pdf");
  });
  it("เหตุผล Site plan ห้ามว่าง", () => {
    expect(isValidReason("  ")).toBe(false);
    expect(isValidReason("แก้ตอนติดตั้ง")).toBe(true);
  });
});

describe("filters", () => {
  const base: FilterableRow = {
    customerName: "บจก. ตัวอย่าง",
    contractNo: "CT26-0000001",
    startDate: "2026-10-05",
    branchId: "b1",
    zoneId: "z1",
    hasPdf: true,
    missing: false,
    warned: false,
  };
  const rows: FilterableRow[] = [
    base,
    { ...base, customerName: "คุณสมชาย", contractNo: "CT26-0000002", startDate: "2026-11-01", hasPdf: false },
    { ...base, contractNo: "CT26-0000003", branchId: "b2", zoneId: "z2", missing: true },
  ];
  const f: RowFilters = { month: "2026-10", zoneId: "", branchId: "", status: "", search: "" };

  it("กรองเดือน/เขต/สาขา", () => {
    expect(applyFilters(rows, f)).toHaveLength(2);
    expect(applyFilters(rows, { ...f, zoneId: "z2" })).toHaveLength(1);
    expect(applyFilters(rows, { ...f, branchId: "b1" })).toHaveLength(1);
  });
  it("ค้นหาเฉพาะเดือนที่เลือก (ชื่อ/เลขที่สัญญา)", () => {
    expect(applyFilters(rows, { ...f, search: "สมชาย" })).toHaveLength(0); // อยู่เดือน พ.ย.
    expect(applyFilters(rows, { ...f, month: "2026-11", search: "สมชาย" })).toHaveLength(1);
    expect(applyFilters(rows, { ...f, search: "ct26-0000003" })).toHaveLength(1);
  });
  it("กรองสถานะ", () => {
    expect(applyFilters(rows, { ...f, month: "", status: "nofile" })).toHaveLength(1);
    expect(applyFilters(rows, { ...f, month: "", status: "miss" })).toHaveLength(1);
    expect(applyFilters(rows, { ...f, month: "", status: "ok" })).toHaveLength(1);
  });
  it("ตัวเลือกเดือน ใหม่→เก่า ไม่ซ้ำ", () => {
    expect(monthOptions(["2026-10-05", "2026-11-01", "2026-10-20", ""])).toEqual(["2026-11", "2026-10"]);
  });
});
