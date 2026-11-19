import { describe, expect, it } from "vitest";

import type { TierRule } from "@/lib/rules/types";

import {
  applyPasteToDraft,
  buildUpsertPayload,
  draftFromState,
  emptyInput,
  evalDraft,
  isDraftDirty,
  parsePaste,
  portErrorMessage,
  resolveBranchState,
  round2,
  tierBandTexts,
  toTableRow,
  filterRows,
  summarizeRows,
  type Draft,
  type SnapRow,
} from "./portLogic";

const BR = "ตาก";

function snap(month: string, source: SnapRow["source"], over: Partial<SnapRow> = {}): SnapRow {
  return {
    month_key: month, branch_id: "b1", source,
    s1: 8, s3: 29, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    v_s1: 143688.73, v_s3: 1175706.72, v_m1: 0, v_m3: 0, v_l1: 0, v_l3: 0, v_xl1: 0, v_xl3: 0,
    report_cust: null, report_value: null, confirmed_at: null, confirmed_by: null,
    ...over,
  };
}

function ctx(strict = false, rules: TierRule[] | null = null) {
  return { branchName: BR, month: "2026-10", rules, strictValues: strict };
}

function draftOf(rows: Array<[string, string]>, report: [string, string] = ["", ""]): Draft {
  const tiers = Array.from({ length: 8 }, (_, k) => ({ count: rows[k]?.[0] ?? "0", value: rows[k]?.[1] ?? "0.00" }));
  return { tiers, reportCust: report[0], reportValue: report[1] };
}

describe("portErrorMessage", () => {
  it.each(["SN001", "SN002", "SN003", "SN004", "23514", "42501"])("แปลง %s เป็นข้อความไทย", (code) => {
    const msg = portErrorMessage(code);
    expect(msg).toMatch(/[ก-๙]/);
    expect(msg).not.toContain(code);
  });
  it("42501 บอกว่าใช้ได้เฉพาะ OM/PM", () => {
    expect(portErrorMessage("42501")).toContain("OM/PM");
  });
  it("code แปลก/ว่าง = ข้อความทั่วไปภาษาไทย ไม่โชว์ข้อความดิบ", () => {
    expect(portErrorMessage("XX999")).toMatch(/บันทึกไม่สำเร็จ/);
    expect(portErrorMessage(null)).toMatch(/บันทึกไม่สำเร็จ/);
  });
});

describe("round2", () => {
  it("ปัด 2 ตำแหน่ง (1.005 → 1.01)", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.005)).toBe(0.01);
    expect(round2(143688.734)).toBe(143688.73);
  });
});

describe("resolveBranchState — ยกค่า / legacy (2.85 Q1)", () => {
  it("เดือนก่อนเป็น manual → ยกค่าได้ + ปุ่มยืนยันค่าเดิมแสดง (5.12a)", () => {
    const s = resolveBranchState([snap("2026-09", "manual", { confirmed_at: "x" })], "2026-10");
    expect(s.kind).toBe("carried");
    expect(s.canKeepSame).toBe(true);
    expect(s.updated).toBe(false);
    expect(s.input.s3).toBe(29);
    expect(s.from).toBe("2026-09");
  });

  it("เดือนก่อนเป็น legacy → ปิดปุ่มยืนยันค่าเดิม + ฟอร์มว่าง + ต้องกรอกมูลค่า", () => {
    const s = resolveBranchState([snap("2026-09", "legacy", { v_s1: 0, v_s3: 0 })], "2026-10");
    expect(s.kind).toBe("legacy-carry");
    expect(s.canKeepSame).toBe(false);
    expect(s.strictValues).toBe(true);
    expect(s.input).toEqual(emptyInput());
  });

  it("ใช้แถวล่าสุดก่อนเดือนที่เลือก ไม่ใช่แค่เดือน−1", () => {
    const s = resolveBranchState([snap("2026-07", "manual"), snap("2026-05", "legacy")], "2026-10");
    expect(s.kind).toBe("carried");
    expect(s.from).toBe("2026-07");
    expect(s.prevCents).toBeNull(); // ไม่มีแถว 2026-09 → ไม่มีส่วนต่าง
  });

  it("ไม่มีข้อมูลก่อนหน้า → empty ยืนยันค่าเดิมไม่ได้", () => {
    const s = resolveBranchState([], "2026-10");
    expect(s.kind).toBe("empty");
    expect(s.canKeepSame).toBe(false);
  });

  it("เดือนนี้มีแถว manual ยืนยันแล้ว → saved/updated", () => {
    const s = resolveBranchState([snap("2026-10", "manual", { confirmed_at: "2026-11-02T01:00:00Z", confirmed_by: "u1" })], "2026-10");
    expect(s.kind).toBe("saved");
    expect(s.updated).toBe(true);
    expect(s.confirmedBy).toBe("u1");
  });

  it("เดือนนี้มีแถว manual แต่ confirmed_at ว่าง → ยังไม่อัปเดต", () => {
    const s = resolveBranchState([snap("2026-10", "manual")], "2026-10");
    expect(s.kind).toBe("saved");
    expect(s.updated).toBe(false);
  });

  it("เดือนนี้เป็นแถว legacy → อ่านอย่างเดียว", () => {
    const s = resolveBranchState([snap("2026-10", "legacy")], "2026-10");
    expect(s.kind).toBe("readonly");
    expect(s.updated).toBe(false);
  });

  it("คำนวณมูลค่าเดือนก่อนเป็นสตางค์", () => {
    const s = resolveBranchState([snap("2026-09", "manual")], "2026-10");
    expect(s.prevCents).toBe(Math.round((143688.73 + 1175706.72) * 100));
  });
});

describe("evalDraft", () => {
  const ok = draftOf([["8", "143,688.73"], ["29", "1,175,706.72"]]);

  it("ผลรวมถูก + บันทึกได้เมื่อไม่ใส่ยอดรายงาน", () => {
    const e = evalDraft(ok, ctx());
    expect(e.total.n).toBe(37);
    expect(e.total.cents).toBe(131939545);
    expect(e.reportState).toBe("none");
    expect(e.canSave).toBe(true);
    expect(e.row?.cust).toBe(37);
  });

  it("ยอดรายงานตรง → บันทึกได้", () => {
    const e = evalDraft({ ...ok, reportCust: "37", reportValue: "1,319,395.45" }, ctx());
    expect(e.reportState).toBe("ok");
    expect(e.match).toBe(true);
    expect(e.canSave).toBe(true);
  });

  it("ยอดรายงานไม่ตรง → บันทึกไม่ได้ (5.11)", () => {
    const e = evalDraft({ ...ok, reportCust: "38", reportValue: "1,319,395.45" }, ctx());
    expect(e.match).toBe(false);
    expect(e.dn).toBe(-1);
    expect(e.canSave).toBe(false);
    expect(e.errors.join(" ")).toMatch(/ไม่ตรงรายงาน/);
  });

  it("มูลค่าไม่ตรงรายงานแม้ 1 สตางค์ → บันทึกไม่ได้", () => {
    const e = evalDraft({ ...ok, reportCust: "37", reportValue: "1,319,395.46" }, ctx());
    expect(e.match).toBe(false);
    expect(e.canSave).toBe(false);
  });

  it("กรอกยอดรายงานไม่ครบคู่ → บันทึกไม่ได้", () => {
    const e = evalDraft({ ...ok, reportCust: "37", reportValue: "" }, ctx());
    expect(e.reportState).toBe("partial");
    expect(e.canSave).toBe(false);
  });

  it("จำนวนติดลบ/ทศนิยม/ตัวอักษร → error รายแถว", () => {
    const e = evalDraft(draftOf([["-1", "0"], ["1.5", "0"], ["x", "0"]]), ctx());
    expect(e.rowErrors[0]).toMatch(/จำนวนเต็ม/);
    expect(e.rowErrors[1]).toMatch(/จำนวนเต็ม/);
    expect(e.rowErrors[2]).toMatch(/จำนวนเต็ม/);
    expect(e.canSave).toBe(false);
  });

  it("มูลค่าทศนิยมเกิน 2 ตำแหน่งที่พิมพ์มา → error", () => {
    const e = evalDraft(draftOf([["1", "100.123"]]), ctx());
    expect(e.rowErrors[0]).toMatch(/2 ตำแหน่ง/);
  });

  it("จำนวน 0 แต่มีมูลค่า → error (ขอบ 0.005 ถูกปัดเป็น 0.01 แล้วชน)", () => {
    const e = evalDraft(draftOf([["0", "100"]]), ctx());
    expect(e.rowErrors[0]).toMatch(/จำนวนเป็น 0/);
    expect(e.canSave).toBe(false);
  });

  it("มีจำนวนแต่มูลค่า 0 (ปกติ) → เตือน ไม่บล็อก", () => {
    const e = evalDraft(draftOf([["3", "0"]]), ctx(false));
    expect(e.rowWarns[0]).toMatch(/มูลค่าเป็น 0/);
    expect(e.canSave).toBe(true);
  });

  it("legacy/empty: มีจำนวนแต่ไม่มีมูลค่า → บล็อก (กัน Dashboard ตกเป็น 0)", () => {
    const e = evalDraft(draftOf([["3", "0"]]), ctx(true));
    expect(e.rowErrors[0]).toMatch(/ยังไม่ได้กรอกมูลค่า/);
    expect(e.canSave).toBe(false);
  });

  it("legacy/empty: ฟอร์มว่างทั้งหมด → บล็อก", () => {
    const e = evalDraft(draftOf([]), ctx(true));
    expect(e.canSave).toBe(false);
    expect(e.errors.join(" ")).toMatch(/ยังไม่ได้กรอกข้อมูล/);
  });

  it("ไม่ throw เมื่อไม่มีชุดเกณฑ์ของเดือน (เตือนแทน)", () => {
    const rules: TierRule[] = [
      { tier: "S", minAnnual: 0, effectiveMonth: "2027-01" },
      { tier: "M", minAnnual: 30000, effectiveMonth: "2027-01" },
    ];
    const e = evalDraft(ok, ctx(false, rules));
    expect(e.warnings.join(" ")).toMatch(/ตรวจเกณฑ์ Tier ไม่ได้/);
    expect(e.canSave).toBe(true);
  });

  it("ค่าเฉลี่ยหลุด band → เตือนรายแถว ไม่บล็อก", () => {
    const rules: TierRule[] = [
      { tier: "S", minAnnual: 0 },
      { tier: "M", minAnnual: 30000 },
      { tier: "L", minAnnual: 50000 },
      { tier: "XL", minAnnual: 150000 },
    ];
    const e = evalDraft(draftOf([["1", "900000"]]), ctx(false, rules)); // S1 ราคา 900K → XL
    expect(e.rowWarns[0]).toMatch(/เข้าเกณฑ์/);
    expect(e.canSave).toBe(true);
  });
});

describe("buildUpsertPayload", () => {
  it("source=manual · month_key YYYY-MM · ปัด 2 ตำแหน่ง · ส่ง confirmed_at", () => {
    const input = { ...emptyInput(), s1: 2, v_s1: 100.005, s3: 1, v_s3: 50.1 };
    const p = buildUpsertPayload({
      month: "2026-10", branchId: "uuid-1", branchName: BR, input,
      report: { cust: 3, value: 150.11 }, nowIso: "2026-11-19T00:00:00.000Z",
    });
    expect(p.source).toBe("manual");
    expect(p.month_key).toBe("2026-10");
    expect(p.branch_id).toBe("uuid-1");
    expect(p.v_s1).toBe(100.01);
    expect(p.cust).toBe(3);
    expect(p.vS).toBe(150.11);
    expect(p.value).toBe(150.11);
    expect(p.report_cust).toBe(3);
    expect(p.report_value).toBe(150.11);
    expect(p.confirmed_at).toBe("2026-11-19T00:00:00.000Z");
  });
  it("ไม่มียอดรายงาน → null", () => {
    const p = buildUpsertPayload({ month: "2026-10", branchId: "u", branchName: BR, input: emptyInput(), report: null, nowIso: "x" });
    expect(p.report_cust).toBeNull();
    expect(p.report_value).toBeNull();
  });
  it("สาขาส่วนกลางหรือชื่อผิด → throw (ใช้หน้านี้ไม่ได้)", () => {
    expect(() => buildUpsertPayload({ month: "2026-10", branchId: "u", branchName: "สาทร", input: emptyInput(), report: null, nowIso: "x" })).toThrow();
  });
});

describe("parsePaste (วางจาก Excel)", () => {
  const text = [
    "ขนาด\tจำนวน\tมูลค่า",
    "S1 (<30K)\t8\t143,688.73",
    "S3\t29\t1,175,706.72",
    "XL3 (>=300K)\t1\t-",
    "รวมทั้งสิ้น\t38\t1,319,395.45",
  ].join("\n");

  it("จับคู่ tier จากป้าย + ตัดคอมมา + '-' = 0 + อ่านยอดรวมทั้งสิ้น", () => {
    const p = parsePaste(text);
    expect(p.tiers.s1).toEqual({ n: 8, v: 143688.73, swapped: false });
    expect(p.tiers.s3?.v).toBe(1175706.72);
    expect(p.tiers.xl3).toEqual({ n: 1, v: 0, swapped: false });
    expect(p.tiers.m1).toBeUndefined();
    expect(p.report).toEqual({ n: 38, v: 1319395.45 });
    expect(p.issues).toEqual([]);
  });

  it("XL1 ไม่ถูกจับเป็น L1", () => {
    const p = parsePaste("XL1\t2\t900,000.00\nL1\t1\t60,000.00");
    expect(p.tiers.xl1?.n).toBe(2);
    expect(p.tiers.l1?.n).toBe(1);
  });

  it("แยกคอลัมน์ด้วยช่องว่าง 2 ตัวถ้าไม่มี tab", () => {
    const p = parsePaste("S1  5  100,000.00");
    expect(p.tiers.s1).toEqual({ n: 5, v: 100000, swapped: false });
  });

  it("สลับคอลัมน์ให้เมื่อมูลค่ามาก่อนจำนวน", () => {
    const p = parsePaste("S1\t143,688.73\t8");
    expect(p.tiers.s1).toEqual({ n: 8, v: 143688.73, swapped: true });
  });

  it("บรรทัดซ้ำ → เตือน ใช้บรรทัดหลังสุด · ขาดตัวเลข → เตือน", () => {
    const p = parsePaste("S1\t1\t10\nS1\t2\t20\nM1\t5");
    expect(p.tiers.s1?.n).toBe(2);
    expect(p.issues.join(" ")).toMatch(/ซ้ำ/);
    expect(p.issues.join(" ")).toMatch(/M1/);
  });

  it("ไม่เจอ tier เลย → tiers ว่าง", () => {
    expect(Object.keys(parsePaste("hello\nworld").tiers)).toHaveLength(0);
  });

  it("ใส่ลงฟอร์ม: tier ที่ไม่พบคงค่าเดิม · ปัด 2 ตำแหน่ง · ยอดรายงานถูกใส่", () => {
    const base = draftOf([["1", "1.00"], ["2", "2.00"]]);
    const d = applyPasteToDraft(base, parsePaste("S1\t8\t143688.734\nรวมทั้งสิ้น\t8\t143688.734"));
    expect(d.tiers[0]).toEqual({ count: "8", value: "143,688.73" });
    expect(d.tiers[1]).toEqual({ count: "2", value: "2.00" });
    expect(d.reportCust).toBe("8");
    expect(d.reportValue).toBe("143,688.73");
  });
});

describe("dirty / ตาราง", () => {
  it("เทียบ draft โดยไม่สนรูปแบบคอมมา", () => {
    const s = resolveBranchState([snap("2026-09", "manual")], "2026-10");
    const saved = draftFromState(s);
    expect(isDraftDirty(saved, saved)).toBe(false);
    const changed = { ...saved, tiers: saved.tiers.map((t, k) => (k === 0 ? { ...t, count: "9" } : t)) };
    expect(isDraftDirty(changed, saved)).toBe(true);
    const sameFmt = { ...saved, tiers: saved.tiers.map((t, k) => (k === 0 ? { ...t, value: "143688.73" } : t)) };
    expect(isDraftDirty(sameFmt, saved)).toBe(false);
  });

  it("ส่วนต่าง > 10% ติดธง · ตัวกรอง/สรุป", () => {
    const a = resolveBranchState([snap("2026-09", "manual"), snap("2026-10", "manual", { confirmed_at: "x", v_s3: 0, s3: 0 })], "2026-10");
    const b = resolveBranchState([snap("2026-09", "manual")], "2026-10");
    const rows = [toTableRow(0, "เขต 7", "ตาก", a), toTableRow(1, "เขต 8", "โคราช", b)];
    expect(rows[0]?.bigDiff).toBe(true);
    expect(rows[1]?.diffCents).toBe(0);
    expect(filterRows(rows, "", "all", "big")).toHaveLength(1);
    expect(filterRows(rows, "", "all", "ok")).toHaveLength(1);
    expect(filterRows(rows, "", "เขต 8", "all")[0]?.name).toBe("โคราช");
    expect(summarizeRows(rows)).toMatchObject({ updated: 1, pending: 1 });
  });
});

describe("tierBandTexts", () => {
  const rules: TierRule[] = [
    { tier: "S", minAnnual: 0 }, { tier: "M", minAnnual: 30000 },
    { tier: "L", minAnnual: 50000 }, { tier: "XL", minAnnual: 150000 },
  ];
  it("อ่านจาก tier_rules · 3 ปีคูณ 3", () => {
    const t = tierBandTexts(rules, "2026-10");
    expect(t?.[0]?.line1).toBe("ปีละ ต่ำกว่า 30,000");
    expect(t?.[3]?.line2).toContain("90,000");
    expect(t?.[6]?.line1).toBe("ปีละ ตั้งแต่ 150,000");
  });
  it("ไม่มีเกณฑ์ของเดือน → null", () => {
    expect(tierBandTexts(null, "2026-10")).toBeNull();
    expect(tierBandTexts([{ tier: "S", minAnnual: 0, effectiveMonth: "2027-01" }], "2026-10")).toBeNull();
  });
});
