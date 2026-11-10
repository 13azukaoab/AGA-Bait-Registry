import { describe, it, expect } from "vitest";
import { TIER_RULES } from "../rules/__fixtures__/tierRules";
import {
  buildManualRow,
  buildManualSnapshotRow,
  checkManualInput,
  checkReportTotals,
  checkTierBands,
  type ManualTierInput,
} from "./manualRow";

/** ค่าเริ่มต้น 0 ทั้ง 8 tier — เทสแต่ละข้อค่อย override เฉพาะช่องที่สนใจ */
const EMPTY: ManualTierInput = {
  s1: 0, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
  v_s1: 0, v_s3: 0, v_m1: 0, v_m3: 0, v_l1: 0, v_l3: 0, v_xl1: 0, v_xl3: 0,
};

/** ตัวอย่างกรอกครบ 8 tier (ตัวเลขสมมติ แต่ค่าเฉลี่ยต่อปีอยู่ใน band ของแต่ละ tier) */
const FILLED: ManualTierInput = {
  s1: 2, s3: 3, m1: 1, m3: 2, l1: 1, l3: 1, xl1: 1, xl3: 1,
  v_s1: 40000,    // 20,000/ปี → S
  v_s3: 180000,   // 60,000/สัญญา ÷ 3 = 20,000/ปี → S
  v_m1: 35000,    // 35,000/ปี → M
  v_m3: 240000,   // 120,000/สัญญา ÷ 3 = 40,000/ปี → M
  v_l1: 60000,    // 60,000/ปี → L
  v_l3: 180000,   // 180,000/สัญญา ÷ 3 = 60,000/ปี → L
  v_xl1: 150000,  // 150,000/ปี → XL
  v_xl3: 450000,  // 450,000/สัญญา ÷ 3 = 150,000/ปี → XL
};

describe("buildManualRow — คำนวณแถวจาก 8 tier (SPEC §6.5)", () => {
  it("cust = ผลรวมจำนวนทั้ง 8 tier", () => {
    const row = buildManualRow("ลพบุรี", FILLED);
    expect(row.cust).toBe(12);
  });

  it("vS/vM/vL/vXL = ผลรวมมูลค่าของคู่ 1 ปี + 3 ปี", () => {
    const row = buildManualRow("ลพบุรี", FILLED);
    expect(row.vS).toBe(220000);
    expect(row.vM).toBe(275000);
    expect(row.vL).toBe(240000);
    expect(row.vXL).toBe(600000);
  });

  it("value = ผลรวมมูลค่าทั้ง 8 tier", () => {
    const row = buildManualRow("ลพบุรี", FILLED);
    expect(row.value).toBe(1335000);
  });

  it("ใส่ area ตามรายชื่อมาตรฐาน และคืนครบ 16 ฟิลด์", () => {
    const row = buildManualRow("ลพบุรี", FILLED);
    expect(row.area).toBe("เขต 9");
    expect(row.branch).toBe("ลพบุรี");
    expect(Object.keys(row)).toHaveLength(16);
    expect("value_annual" in row).toBe(false);
  });

  it("คงจำนวนรายtier ไว้ตามที่กรอก", () => {
    const row = buildManualRow("ลพบุรี", FILLED);
    expect([row.s1, row.s3, row.m1, row.m3, row.l1, row.l3, row.xl1, row.xl3])
      .toEqual([2, 3, 1, 2, 1, 1, 1, 1]);
  });

  it("throw เมื่อชื่อสาขาไม่อยู่ในรายชื่อ 43 สาขา", () => {
    expect(() => buildManualRow("ลพบุรีี", FILLED)).toThrow(/ไม่อยู่ในรายชื่อ/);
  });

  it("throw เมื่อเป็นสาขาส่วนกลาง (ต้องมาจาก computed)", () => {
    expect(() => buildManualRow("พุทธมณฑล", FILLED)).toThrow(/ส่วนกลาง/);
  });
});

describe("checkManualInput — ตรวจความสมเหตุสมผลรายช่อง", () => {
  it("ข้อมูลปกติผ่าน ไม่มี error ไม่มีคำเตือน", () => {
    const res = checkManualInput(FILLED);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it("ทุกช่องเป็น 0 ผ่านได้ (สาขาที่ยังไม่มีลูกค้า)", () => {
    expect(checkManualInput(EMPTY).ok).toBe(true);
  });

  it("จำนวนติดลบ = ไม่ผ่าน", () => {
    const res = checkManualInput({ ...EMPTY, s1: -1 });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/S1/);
  });

  it("จำนวนไม่ใช่จำนวนเต็ม = ไม่ผ่าน", () => {
    expect(checkManualInput({ ...EMPTY, m3: 1.5 }).ok).toBe(false);
  });

  it("มูลค่าติดลบ = ไม่ผ่าน", () => {
    expect(checkManualInput({ ...EMPTY, l1: 1, v_l1: -5 }).ok).toBe(false);
  });

  it("จำนวนเป็น 0 แต่มีมูลค่า = ไม่ผ่าน (น่าจะใส่ผิดช่อง)", () => {
    const res = checkManualInput({ ...EMPTY, v_s3: 1000 });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/จำนวนเป็น 0/);
  });

  it("มีจำนวนแต่มูลค่าเป็น 0 = ผ่านแต่เตือน", () => {
    const res = checkManualInput({ ...EMPTY, s1: 3 });
    expect(res.ok).toBe(true);
    expect(res.warnings.join(" ")).toMatch(/มูลค่าเป็น 0/);
  });
});

describe("checkReportTotals — เทียบยอดจากรายงาน (DECISIONS 5.11)", () => {
  const row = buildManualRow("ลพบุรี", FILLED);

  it("ยอดตรงทั้งจำนวนและมูลค่า = ผ่าน ไม่มีคำเตือน", () => {
    const res = checkReportTotals(row, { reportCust: 12, reportValue: 1335000 });
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([]);
  });

  it("จำนวนรายไม่ตรงรายงาน = ไม่ผ่าน", () => {
    const res = checkReportTotals(row, { reportCust: 11, reportValue: 1335000 });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/จำนวนราย/);
  });

  it("มูลค่าไม่ตรงรายงาน = ไม่ผ่าน", () => {
    const res = checkReportTotals(row, { reportCust: 12, reportValue: 1335001 });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/มูลค่ารวม/);
  });

  it("ต่างกันไม่ถึงครึ่งสตางค์ ถือว่าตรง (กันเศษทศนิยมของ JS)", () => {
    const res = checkReportTotals(row, { reportCust: 12, reportValue: 1335000.004 });
    expect(res.ok).toBe(true);
  });

  it("ไม่กรอกยอดเทียบ = ผ่านแต่เตือน 2 เรื่อง", () => {
    const res = checkReportTotals(row);
    expect(res.ok).toBe(true);
    expect(res.warnings).toHaveLength(2);
  });

  it("กรอกแค่มูลค่า = เตือนเฉพาะจำนวนราย", () => {
    const res = checkReportTotals(row, { reportValue: 1335000 });
    expect(res.ok).toBe(true);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/จำนวนราย/);
  });

  it("ส่ง null มา (ค่าว่างจากฐานข้อมูล) ถือว่าไม่กรอก", () => {
    const res = checkReportTotals(row, { reportCust: null, reportValue: null });
    expect(res.ok).toBe(true);
    expect(res.warnings).toHaveLength(2);
  });
});

describe("checkTierBands — เตือนเมื่อค่าเฉลี่ยหลุด band (ใช้ tier_rules ไม่ hardcode)", () => {
  it("ข้อมูลที่อยู่ใน band ของทุก tier ไม่มีคำเตือน", () => {
    expect(checkTierBands(FILLED, TIER_RULES)).toEqual([]);
  });

  it("ใส่มูลค่า XL ในช่อง S1 = เตือน", () => {
    const warnings = checkTierBands({ ...EMPTY, s1: 1, v_s1: 500000 }, TIER_RULES);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/S1/);
    expect(warnings[0]).toMatch(/XL/);
  });

  it("คิดเป็นต่อปีสำหรับสัญญา 3 ปี (150,000 ÷ 3 = 50,000/ปี → L ไม่ใช่ XL)", () => {
    expect(checkTierBands({ ...EMPTY, l3: 1, v_l3: 150000 }, TIER_RULES)).toEqual([]);
    expect(checkTierBands({ ...EMPTY, xl3: 1, v_xl3: 150000 }, TIER_RULES)).toHaveLength(1);
  });

  it("ช่องที่จำนวนหรือมูลค่าเป็น 0 ข้ามไป ไม่เตือน", () => {
    expect(checkTierBands({ ...EMPTY, s1: 2 }, TIER_RULES)).toEqual([]);
  });
});

describe("buildManualSnapshotRow — รวมคำนวณ + ตรวจ", () => {
  it("ข้อมูลถูกต้องและยอดตรง = ok ไม่มี error/warning", () => {
    const res = buildManualSnapshotRow(
      "ลพบุรี", FILLED, { reportCust: 12, reportValue: 1335000 }, TIER_RULES,
    );
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.row.value).toBe(1335000);
  });

  it("ยอดรายงานไม่ตรง = ไม่ผ่าน แต่ยังคืนแถวที่คำนวณได้", () => {
    const res = buildManualSnapshotRow("ลพบุรี", FILLED, { reportCust: 99 });
    expect(res.ok).toBe(false);
    expect(res.row.cust).toBe(12);
  });

  it("ไม่ส่ง tier_rules = ข้ามการตรวจ band", () => {
    const res = buildManualSnapshotRow(
      "ลพบุรี",
      { ...EMPTY, s1: 1, v_s1: 500000 },
      { reportCust: 1, reportValue: 500000 },
    );
    expect(res.warnings).toEqual([]);
    expect(res.ok).toBe(true);
  });
});
