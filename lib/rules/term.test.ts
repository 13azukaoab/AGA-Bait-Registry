import { describe, it, expect } from "vitest";
import {
  TERM_MONTHS_MAX,
  TERM_MONTHS_MIN,
  annualValueForTerm,
  colorGroup,
  defaultEndDateForTerm,
  isCustomTerm,
  isValidTermMonths,
  serviceMonthsForTerm,
  termMonthsFromYears,
  tierKey,
} from "./term";
import { addMonthsMinusDay, addYearsMinusDay } from "./date";
import { annualValue, tierOf } from "./tier";
import { defaultEndDate, serviceMonths } from "./serviceMonths";
import { TIER_RULES } from "./__fixtures__/tierRules";

/**
 * M30 (DECISIONS 2.53): ระยะสัญญาเป็นเดือน 1–36 · 12 / 36 = มาตรฐาน · อื่น = Custom
 * กรณีบังคับจาก brief M30 ข้อ 1–9 (ข้อ 6–7 อยู่ใน snapshot / missedResolution / renewalGap test)
 */

/** สูตรเดิมก่อน M30 (Date.UTC ล้นเดือน) — ใช้เทียบว่า 12/36 เดือนให้ผลเหมือนเดิมทุกวัน */
function legacyAddYearsMinusDay(startIso: string, years: number): string {
  const y = Number(startIso.slice(0, 4));
  const m = Number(startIso.slice(5, 7));
  const d = Number(startIso.slice(8, 10));
  const end = new Date(Date.UTC(y + years, m - 1, d) - 24 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${end.getUTCFullYear()}-${p(end.getUTCMonth() + 1)}-${p(end.getUTCDate())}`;
}

function everyDay(fromYear: number, toYear: number): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(fromYear, 0, 1); t <= Date.UTC(toYear, 11, 31); t += 24 * 60 * 60 * 1000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

describe("ช่วงระยะสัญญา (term_months 1–36)", () => {
  it("รับ 1–36 · ปฏิเสธ 0, 37, ทศนิยม", () => {
    expect(TERM_MONTHS_MIN).toBe(1);
    expect(TERM_MONTHS_MAX).toBe(36);
    expect(isValidTermMonths(1)).toBe(true);
    expect(isValidTermMonths(24)).toBe(true);
    expect(isValidTermMonths(36)).toBe(true);
    expect(isValidTermMonths(0)).toBe(false);
    expect(isValidTermMonths(37)).toBe(false);
    expect(isValidTermMonths(5.5)).toBe(false);
    expect(isValidTermMonths(Number.NaN)).toBe(false);
  });

  it("isCustomTerm: ไม่ใช่ 12 และไม่ใช่ 36", () => {
    expect(isCustomTerm(12)).toBe(false);
    expect(isCustomTerm(36)).toBe(false);
    expect(isCustomTerm(1)).toBe(true);
    expect(isCustomTerm(5)).toBe(true);
    expect(isCustomTerm(11)).toBe(true);
    expect(isCustomTerm(24)).toBe(true);
    expect(isCustomTerm(35)).toBe(true);
  });

  it("colorGroup: 36 → '3' · อื่นทั้งหมด → '1' (Custom นับกลุ่ม 1 ปี)", () => {
    expect(colorGroup(36)).toBe("3");
    expect(colorGroup(12)).toBe("1");
    expect(colorGroup(5)).toBe("1");
    expect(colorGroup(24)).toBe("1");
    expect(colorGroup(35)).toBe("1");
  });

  it("tierKey = tier + colorGroup (รูปแบบคีย์ Dashboard เดิม)", () => {
    expect(tierKey("S", 36)).toBe("s3");
    expect(tierKey("XL", 12)).toBe("xl1");
    expect(tierKey("L", 5)).toBe("l1");
    expect(tierKey("M", 24)).toBe("m1");
  });

  it("termMonthsFromYears: 1 → 12 · 3 → 36", () => {
    expect(termMonthsFromYears(1)).toBe(12);
    expect(termMonthsFromYears(3)).toBe(36);
  });
});

describe("serviceMonthsForTerm = เดือนเริ่ม ต่อเนื่อง m เดือน", () => {
  it("ข้อ 1: 15/01/2026, 5 เดือน → ม.ค.–พ.ค. 2026", () => {
    expect(serviceMonthsForTerm("2026-01-15", 5)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
    ]);
  });
  it("ข้อ 2: 03/04/2026, 1 เดือน → เม.ย. 2026", () => {
    expect(serviceMonthsForTerm("2026-04-03", 1)).toEqual(["2026-04"]);
  });
  it("ข้อ 3: 01/01/2026, 11 เดือน → ม.ค.–พ.ย. 2026", () => {
    const months = serviceMonthsForTerm("2026-01-01", 11);
    expect(months).toHaveLength(11);
    expect(months[0]).toBe("2026-01");
    expect(months.at(-1)).toBe("2026-11");
  });
  it("กรณีบังคับเดิม (CLAUDE.md) ผ่านด้วยเดือน", () => {
    expect(serviceMonthsForTerm("2026-01-15", 12).at(-1)).toBe("2026-12");
    expect(serviceMonthsForTerm("2026-04-03", 12)).toEqual([
      "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
      "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03",
    ]);
    const three = serviceMonthsForTerm("2026-01-01", 36);
    expect(three).toHaveLength(36);
    expect(three.at(-1)).toBe("2028-12");
  });
  it("ระยะนอก 1–36 → throw (ห้ามคำนวณเงียบๆ)", () => {
    expect(() => serviceMonthsForTerm("2026-01-01", 0)).toThrow();
    expect(() => serviceMonthsForTerm("2026-01-01", 37)).toThrow();
  });
});

describe("defaultEndDateForTerm = เริ่ม + m เดือน − 1 วัน (ชนปลายเดือน)", () => {
  it("ข้อ 1–3: วันสิ้นสุด", () => {
    expect(defaultEndDateForTerm("2026-01-15", 5)).toBe("2026-06-14");
    expect(defaultEndDateForTerm("2026-04-03", 1)).toBe("2026-05-02");
    expect(defaultEndDateForTerm("2026-01-01", 11)).toBe("2026-11-30");
  });
  it("ข้อ 9: 31/01 + 1 เดือน → 28/02 (เดือนปลายทางสั้นกว่า = วันสุดท้ายของเดือน)", () => {
    expect(defaultEndDateForTerm("2026-01-31", 1)).toBe("2026-02-28");
    expect(defaultEndDateForTerm("2028-01-31", 1)).toBe("2028-02-29"); // ปีอธิกสุรทิน
    expect(defaultEndDateForTerm("2026-01-30", 1)).toBe("2026-02-28");
    expect(defaultEndDateForTerm("2026-01-29", 1)).toBe("2026-02-28");
    expect(defaultEndDateForTerm("2026-01-28", 1)).toBe("2026-02-27");
    expect(defaultEndDateForTerm("2026-03-31", 1)).toBe("2026-04-30");
    expect(defaultEndDateForTerm("2026-08-31", 6)).toBe("2027-02-28");
  });
  it("ข้อ 9: 29/02/2028 + 12 เดือน → 28/02/2029 · + 36 → 28/02/2031 · + 48 ไม่มี (เกิน 36)", () => {
    expect(defaultEndDateForTerm("2028-02-29", 12)).toBe("2029-02-28");
    expect(defaultEndDateForTerm("2028-02-29", 36)).toBe("2031-02-28");
    expect(defaultEndDateForTerm("2028-02-29", 1)).toBe("2028-03-28");
  });
  it("กรณีบังคับเดิม (CLAUDE.md)", () => {
    expect(defaultEndDateForTerm("2026-01-01", 12)).toBe("2026-12-31");
    expect(defaultEndDateForTerm("2026-01-15", 12)).toBe("2027-01-14");
    expect(defaultEndDateForTerm("2026-01-01", 36)).toBe("2028-12-31");
  });
  it("ข้อ 5: ทุกวันในปี 2024–2031 — 12 เดือน ≡ สูตร 1 ปีเดิม · 36 เดือน ≡ สูตร 3 ปีเดิม", () => {
    for (const day of everyDay(2024, 2031)) {
      expect(defaultEndDateForTerm(day, 12)).toBe(legacyAddYearsMinusDay(day, 1));
      expect(defaultEndDateForTerm(day, 36)).toBe(legacyAddYearsMinusDay(day, 3));
    }
  });
  it("addMonthsMinusDay = ตัวช่วยเดียวกัน · addYearsMinusDay (เดิม) = addMonthsMinusDay(ปี × 12)", () => {
    expect(addMonthsMinusDay("2026-01-31", 1)).toBe("2026-02-28");
    expect(addYearsMinusDay("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYearsMinusDay("2026-04-03", 3)).toBe(addMonthsMinusDay("2026-04-03", 36));
  });
});

describe("annualValueForTerm (มูลค่าจัด Tier)", () => {
  it("≥ 12 เดือน = มูลค่า ÷ (เดือน/12) · < 12 เดือน = มูลค่าจริง ไม่ขยายเป็นต่อปี", () => {
    expect(annualValueForTerm(50000, 12)).toBe(50000);
    expect(annualValueForTerm(150000, 36)).toBe(50000);
    expect(annualValueForTerm(50000, 24)).toBe(25000); // ข้อ 8
    expect(annualValueForTerm(30000, 18)).toBe(20000);
    expect(annualValueForTerm(20000, 5)).toBe(20000);
    expect(annualValueForTerm(29999.5, 3)).toBe(29999.5);
  });
  it("ข้อ 4: 50,000 / 5 เดือน → L1 (ไม่ใช่ XL) · 29,999.50 / 3 เดือน → S1", () => {
    const a = annualValueForTerm(50000, 5);
    expect(tierKey(tierOf(a, TIER_RULES), 5)).toBe("l1");
    const b = annualValueForTerm(29999.5, 3);
    expect(tierKey(tierOf(b, TIER_RULES), 3)).toBe("s1");
  });
  it("กรณีบังคับเดิม (CLAUDE.md) ผ่านด้วยเดือน", () => {
    const k = (v: number, m: number) => tierKey(tierOf(annualValueForTerm(v, m), TIER_RULES), m);
    expect(k(50000, 36)).toBe("s3");
    expect(k(150000, 12)).toBe("xl1");
    expect(k(150000, 36)).toBe("l3");
    expect(k(29999.5, 12)).toBe("s1");
  });
  it("ข้อ 5: 12 ≡ 1 ปี · 36 ≡ 3 ปี (ค่าเท่ากันทุกตัว)", () => {
    for (const v of [1, 29999.5, 50000, 99999.99, 150000, 1234567.89]) {
      expect(annualValueForTerm(v, 12)).toBe(annualValue(v, 1));
      expect(annualValueForTerm(v, 36)).toBe(annualValue(v, 3));
    }
    expect(serviceMonthsForTerm("2026-04-03", 12)).toEqual(serviceMonths("2026-04-03", 1));
    expect(serviceMonthsForTerm("2026-04-03", 36)).toEqual(serviceMonths("2026-04-03", 3));
    expect(defaultEndDateForTerm("2026-04-03", 36)).toBe(defaultEndDate("2026-04-03", 3));
  });
  it("Custom 13–35 เดือนไม่เพี้ยนใต้เส้นเกณฑ์ (ทศนิยม)", () => {
    expect(annualValueForTerm(35000, 14)).toBe(30000);
    expect(annualValueForTerm(62500, 25)).toBe(30000);
    expect(annualValueForTerm(70000, 28)).toBe(30000);
    expect(tierOf(annualValueForTerm(35000, 14), TIER_RULES)).toBe("M");
    for (let m = 13; m <= 35; m++) {
      expect(annualValueForTerm(50000 * (m / 12), m)).toBeCloseTo(50000, 6);
    }
  });
  it("ระยะนอก 1–36 → throw", () => {
    expect(() => annualValueForTerm(1000, 0)).toThrow();
    expect(() => annualValueForTerm(1000, 37)).toThrow();
  });
});
