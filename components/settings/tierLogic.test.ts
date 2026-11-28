import { describe, expect, it } from "vitest";

import {
  CONFIRM_PHRASE,
  buildSavePayload,
  classify,
  effectiveMonthOptions,
  endMonthOf,
  buildPreviewRules,
  groupRuleSets,
  parseOptionalMoney,
  rulesFromThresholds,
  summarizeImpact,
  isDraftValid,
  parseMoney,
  rangeEnds,
  setForMonth,
  shiftMonthKey,
  statusOf,
  validateSaveForm,
  validateTierDraft,
  type TierRuleDbRow,
} from "./tierLogic";

// ค่าทดสอบสมมติ (ไม่ใช่เกณฑ์จริงของระบบ — เกณฑ์จริงอ่านจาก tier_rules เสมอ)
const T = { m: 30_000, l: 50_000, xl: 100_000, xxl: null as number | null };
const TX = { ...T, xxl: 300_000 };

function rows(month: string, t: { m: number; l: number; xl: number; xxl: number | null } = T, reason: string | null = null): TierRuleDbRow[] {
  const xxl: TierRuleDbRow[] =
    t.xxl === null ? [] : [{ tier: "XXL", min_annual: t.xxl, effective_month: `${month}-01`, change_reason: reason }];
  return [
    { tier: "S", min_annual: 0, effective_month: `${month}-01`, change_reason: reason },
    { tier: "M", min_annual: t.m, effective_month: `${month}-01`, change_reason: reason },
    { tier: "L", min_annual: t.l, effective_month: `${month}-01`, change_reason: reason },
    { tier: "XL", min_annual: t.xl, effective_month: `${month}-01`, change_reason: reason },
    ...xxl,
  ];
}

describe("parseMoney", () => {
  it("รับ 30,000 / 30000.5 / มีช่องว่าง · ปฏิเสธข้อความ/ว่าง/ติดลบ", () => {
    expect(parseMoney("30,000")).toBe(30000);
    expect(parseMoney(" 29 999.99 ")).toBe(29999.99);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("1.2.3")).toBeNull();
  });
});

describe("validateTierDraft", () => {
  it("ชุดปกติผ่าน", () => {
    expect(validateTierDraft(T)).toEqual({});
    expect(isDraftValid(T)).toBe(true);
  });
  it("ว่าง / ติดศูนย์ / ทศนิยมเกิน 2 ตำแหน่ง", () => {
    expect(validateTierDraft({ ...T, m: null }).m).toBeTruthy();
    expect(validateTierDraft({ ...T, m: 0 }).m).toBeTruthy();
    expect(validateTierDraft({ ...T, l: 50_000.123 }).l).toContain("ทศนิยม");
  });
  it("ต้องเรียง M < L < XL และห่างอย่างน้อย 0.02", () => {
    expect(validateTierDraft({ m: 50_000, l: 50_000, xl: 100_000, xxl: null }).l).toBeTruthy();
    expect(validateTierDraft({ m: 30_000, l: 50_000, xl: 40_000, xxl: null }).xl).toBeTruthy();
    expect(validateTierDraft({ m: 30_000, l: 30_000.01, xl: 100_000, xxl: null }).l).toBeTruthy();
    expect(validateTierDraft({ m: 30_000, l: 30_000.02, xl: 100_000, xxl: null })).toEqual({});
  });
  it("ค่ามากเกิน 9,999,999,999.99", () => {
    expect(validateTierDraft({ m: 1, l: 2, xl: 10_000_000_000, xxl: null }).xl).toBeTruthy();
  });
});

describe("rangeEnds", () => {
  it("ปลายช่วง = จุดเริ่มถัดไป − 0.01", () => {
    expect(rangeEnds(T)).toEqual({ s: 29_999.99, m: 49_999.99, l: 99_999.99, xl: null });
    expect(rangeEnds(TX)).toEqual({ s: 29_999.99, m: 49_999.99, l: 99_999.99, xl: 299_999.99 });
  });
});

describe("classify (ใช้ tierOf + annualValueForTerm ของ lib/rules)", () => {
  it("ตัวอย่างบังคับจาก CLAUDE.md ตามเกณฑ์ 30k/50k/100k", () => {
    expect(classify(50_000, 36, T)).toMatchObject({ tier: "S" }); // 50,000 ÷ 3 ปี = 16,667
    expect(classify(150_000, 12, T)).toMatchObject({ tier: "XL" });
    expect(classify(150_000, 36, T)).toMatchObject({ tier: "L" }); // 150,000 ÷ 3 = 50,000
    expect(classify(29_999.5, 12, T)).toMatchObject({ tier: "S" });
  });
  it("เกณฑ์เปลี่ยน ผลเปลี่ยนตาม (ไม่มีค่าตายตัว)", () => {
    expect(classify(40_000, 12, T).tier).toBe("M");
    expect(classify(40_000, 12, { m: 45_000, l: 60_000, xl: 120_000, xxl: null }).tier).toBe("S");
  });
  it("สัญญาสั้นกว่า 12 เดือน ใช้มูลค่าจริง (ไม่ขยายต่อปี)", () => {
    expect(classify(50_000, 5, T)).toMatchObject({ tier: "L", annual: 50_000 });
  });
});

describe("groupRuleSets / setForMonth / statusOf / endMonthOf", () => {
  const all = [
    ...rows("2000-01", T, null),
    ...rows("2026-12", { m: 35_000, l: 55_000, xl: 110_000, xxl: null }, "ปรับตามต้นทุน"),
  ];
  const sets = groupRuleSets(all);
  it("จัดกลุ่มเป็น 2 ชุด ชุดแรกเป็น baseline", () => {
    expect(sets.map((s) => [s.month, s.isBaseline])).toEqual([
      ["2000-01", true],
      ["2026-12", false],
    ]);
    expect(sets[1]?.reason).toBe("ปรับตามต้นทุน");
    expect(sets[1]?.thresholds).toEqual({ m: 35_000, l: 55_000, xl: 110_000, xxl: null });
  });
  it("เลือกชุดตามเดือน: ก่อนชุดใหม่ใช้ชุดเก่า", () => {
    expect(setForMonth(sets, "2026-11")?.month).toBe("2000-01");
    expect(setForMonth(sets, "2026-12")?.month).toBe("2026-12");
    expect(setForMonth(sets, "1999-01")).toBeNull();
  });
  it("สถานะและช่วงสิ้นสุด", () => {
    expect(statusOf(sets[0]!, sets, "2026-11")).toBe("current");
    expect(statusOf(sets[1]!, sets, "2026-11")).toBe("upcoming");
    expect(statusOf(sets[0]!, sets, "2027-01")).toBe("past");
    expect(endMonthOf(sets[0]!, sets)).toBe("2026-11");
    expect(endMonthOf(sets[1]!, sets)).toBeNull();
  });
  it("ชุดที่ไม่ครบ M/L/XL ถูกข้าม", () => {
    expect(groupRuleSets(rows("2026-12").filter((r) => r.tier !== "XL"))).toEqual([]);
  });
});

describe("effectiveMonthOptions", () => {
  it("เริ่มที่เดือนปัจจุบันเมื่อไม่มีข้อจำกัดอื่น", () => {
    const o = effectiveMonthOptions({ currentMonth: "2026-11", goLiveMonth: "2026-10", lastClosedMonth: null, baselineMonth: "2000-01", count: 3 });
    expect(o).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
  it("เดือนที่ปิดล่าสุด ≥ เดือนปัจจุบัน → เริ่มเดือนถัดจากเดือนที่ปิด", () => {
    expect(effectiveMonthOptions({ currentMonth: "2026-11", goLiveMonth: null, lastClosedMonth: "2026-11", baselineMonth: null, count: 2 })).toEqual(["2026-12", "2027-01"]);
  });
  it("go-live ในอนาคต → เริ่มที่ go-live · ข้ามปีได้", () => {
    expect(effectiveMonthOptions({ currentMonth: "2026-11", goLiveMonth: "2027-02", lastClosedMonth: null, baselineMonth: null, count: 2 })).toEqual(["2027-02", "2027-03"]);
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });
});

describe("validateSaveForm / buildSavePayload", () => {
  const options = ["2026-11", "2026-12"];
  it("ผ่านเมื่อเดือนอยู่ในตัวเลือก + เหตุผล ≥ 5 ตัว + พิมพ์ยืนยันตรง", () => {
    expect(validateSaveForm({ month: "2026-12", options, reason: "ปรับตามต้นทุน", confirm: CONFIRM_PHRASE })).toEqual({});
  });
  it("ตัวเลือกผิด / เหตุผลสั้น / ยืนยันผิด", () => {
    const e = validateSaveForm({ month: "2026-01", options, reason: "สั้น", confirm: "ok" });
    expect(Object.keys(e).sort()).toEqual(["confirm", "month", "reason"]);
  });
  it("payload ค่าเงินเป็น number และตัดช่องว่างของเหตุผล", () => {
    const p = buildSavePayload(T, "2026-12", "  เหตุผล  ");
    expect(p).toEqual({ effective_month: "2026-12", min_m: 30000, min_l: 50000, min_xl: 100000, min_xxl: null, reason: "เหตุผล" });
    expect(typeof p.min_m).toBe("number");
  });
});

describe("Tier XXL (DECISIONS 2.112 / 2.115)", () => {
  it("parseOptionalMoney: ว่าง = null (ไม่มี XXL) · ตัวเลข = ค่า · ข้อความ = invalid", () => {
    expect(parseOptionalMoney("")).toBeNull();
    expect(parseOptionalMoney("  ")).toBeNull();
    expect(parseOptionalMoney("300,000")).toBe(300000);
    expect(parseOptionalMoney("abc")).toBe("invalid");
  });

  it("validation min_xxl: ว่างผ่าน · ต้อง > XL (ห่าง ≥ 0.02) · ทศนิยม ≤ 2 · เพดาน · ไม่ใช่ตัวเลข", () => {
    const d = { m: 30_000, l: 50_000, xl: 100_000 };
    expect(validateTierDraft({ ...d, xxl: null })).toEqual({});
    expect(validateTierDraft({ ...d, xxl: 300_000 })).toEqual({});
    expect(validateTierDraft({ ...d, xxl: 100_000 }).xxl).toContain("มากกว่า XL");
    expect(validateTierDraft({ ...d, xxl: 90_000 }).xxl).toBeTruthy();
    expect(validateTierDraft({ ...d, xxl: 100_000.01 }).xxl).toBeTruthy();
    expect(validateTierDraft({ ...d, xxl: 100_000.02 })).toEqual({});
    expect(validateTierDraft({ ...d, xxl: 300_000.123 }).xxl).toContain("ทศนิยม");
    expect(validateTierDraft({ ...d, xxl: 10_000_000_000 }).xxl).toBeTruthy();
    expect(validateTierDraft({ ...d, xxl: "invalid" }).xxl).toBeTruthy();
    expect(isDraftValid({ ...d, xxl: "invalid" })).toBe(false);
    expect(isDraftValid({ ...d, xxl: null })).toBe(true);
  });

  it("groupRuleSets: ชุดมี XXL (5 แถว) / ไม่มี XXL (4 แถว) ถูกแยกถูก", () => {
    const sets = groupRuleSets([...rows("2000-01", T), ...rows("2026-12", TX, "เพิ่ม XXL")]);
    expect(sets[0]?.thresholds.xxl).toBeNull();
    expect(sets[1]?.thresholds).toEqual({ m: 30_000, l: 50_000, xl: 100_000, xxl: 300_000 });
  });

  it("tierOf ผ่าน classify: มี XXL → 400,000/1 ปี = XXL · ไม่มี XXL → XL (นับรวม XL)", () => {
    expect(classify(400_000, 12, TX)).toMatchObject({ tier: "XXL" });
    expect(classify(299_999.99, 12, TX)).toMatchObject({ tier: "XL" });
    expect(classify(900_000, 36, TX)).toMatchObject({ tier: "XXL" }); // 300,000/ปี พอดี
    expect(classify(400_000, 12, T)).toMatchObject({ tier: "XL" });
    expect(rulesFromThresholds(TX).map((r) => r.tier)).toEqual(["S", "M", "L", "XL", "XXL"]);
    expect(rulesFromThresholds(T).map((r) => r.tier)).toEqual(["S", "M", "L", "XL"]);
  });

  it("บันทึกเกณฑ์ไม่ลบ XXL: payload ส่ง min_xxl ทุกครั้ง (ชุดที่มี XXL = ค่าเดิม · ไม่มี = null)", () => {
    // ผู้ใช้แก้แค่ M แล้วบันทึก: ร่างเริ่มจากชุดที่บันทึกไว้ (รวม XXL) → payload ต้องยังมี min_xxl เดิม
    const saved = groupRuleSets(rows("2026-12", TX))[0]!.thresholds;
    const edited = { ...saved, m: 35_000 };
    const p = buildSavePayload(edited, "2027-01", "แก้ M");
    expect(p).toMatchObject({ min_m: 35_000, min_xxl: 300_000 });
    expect(Object.keys(p)).toContain("min_xxl");
    expect(buildSavePayload(T, "2027-01", "ไม่มี XXL").min_xxl).toBeNull();
    expect(buildPreviewRules(TX)).toEqual({ min_m: 30_000, min_l: 50_000, min_xl: 100_000, min_xxl: 300_000 });
  });

  it("summarizeImpact: แถว XXL แสดงเมื่อมีสัญญา XXL ก่อน/หลังเท่านั้น", () => {
    const none = summarizeImpact([{ from: "XL", to: "XL", termGroup: "1", count: 3 }]);
    expect(none.perTier.map((r) => r.tier)).toEqual(["S", "M", "L", "XL"]);
    const some = summarizeImpact([{ from: "XL", to: "XXL", termGroup: "1", count: 2 }]);
    expect(some.perTier.map((r) => r.tier)).toEqual(["S", "M", "L", "XL", "XXL"]);
    expect(some.perTier.at(-1)).toEqual({ tier: "XXL", before: 0, after: 2, diff: 2 });
    expect(some.moves).toEqual([{ from: "XL", to: "XXL", y1: 2, y3: 0, total: 2 }]);
  });
});
