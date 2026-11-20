import { describe, expect, it } from "vitest";

import {
  baitTotalG,
  breakdownByCustomer,
  breakdownByWork,
  gramsPerAgBox,
  inspectionByBranchMap,
  inspectionByTeamMap,
  inspectionErrorMessage,
  inspectionTotal,
  pctChange,
  sharePct,
  sumByBranch,
  sumUsage,
  type InspectionRow,
  type UsageRow,
} from "./logic";
import { evaluateWorkload, minutesToHours, thresholdForTeam } from "./workload";

function row(over: Partial<UsageRow> = {}): UsageRow {
  return {
    branchId: "b1",
    workGroup: "routine",
    saleType: "renew",
    visitCount: 1,
    outsideG: 0,
    insideG: 0,
    installBaitG: 0,
    powderPoints: 0,
    timberPcs: 0,
    ...over,
  };
}

describe("breakdownByWork — จัดกลุ่มประเภทงานจากแถว RPC", () => {
  const rows = [
    row({ workGroup: "routine", visitCount: 10, outsideG: 500, insideG: 300, powderPoints: 10, timberPcs: 40 }),
    row({ workGroup: "makeup", visitCount: 2, outsideG: 100, insideG: 50, powderPoints: 2, timberPcs: 5 }),
    row({ workGroup: "problem", visitCount: 4, outsideG: 250, insideG: 500, installBaitG: 250, powderPoints: 5, timberPcs: 10 }),
  ];
  const b = breakdownByWork(rows);

  it("ประจำเดือนรวมชดเชย · ชดเชยเป็นเซ็ตย่อย", () => {
    expect(b.routine.visits).toBe(12);
    expect(b.routine.outsideG).toBe(600);
    expect(b.makeup.visits).toBe(2);
    expect(b.makeup.outsideG).toBe(100);
  });
  it("แก้ไขปัญหาแยกต่างหาก รวมเหยื่อติดตั้ง AG", () => {
    expect(b.problem.visits).toBe(4);
    expect(b.problem.insideG).toBe(500);
    expect(b.problem.installBaitG).toBe(250);
  });
  it("routine + problem = ยอดรวมทั้งหมด", () => {
    expect(b.routine.outsideG + b.problem.outsideG).toBe(b.all.outsideG);
    expect(b.routine.insideG + b.problem.insideG).toBe(b.all.insideG);
    expect(b.routine.timberPcs + b.problem.timberPcs).toBe(b.all.timberPcs);
    expect(b.routine.visits + b.problem.visits).toBe(b.all.visits);
  });
  it("ไม่มีแถว = ศูนย์ทุกช่อง", () => {
    expect(breakdownByWork([]).all).toEqual(sumUsage([]));
    expect(breakdownByWork([]).all.visits).toBe(0);
  });
});

describe("เคมีผง", () => {
  it("คิดกรัม = จุด × 0.3 จากยอดรวม", () => {
    const m = sumUsage([row({ powderPoints: 1 }), row({ powderPoints: 1 }), row({ powderPoints: 1 })]);
    expect(m.powderPoints).toBe(3);
    expect(m.powderG).toBe(0.9);
  });
});

describe("breakdownByCustomer — New / Renew / ไม่ระบุ", () => {
  const rows = [
    row({ saleType: "new", workGroup: "routine", outsideG: 100, insideG: 100, visitCount: 3 }),
    row({ saleType: "new", workGroup: "problem", outsideG: 50, visitCount: 1 }),
    row({ saleType: "renew", outsideG: 300, insideG: 200, visitCount: 5 }),
    row({ saleType: "unknown", outsideG: 10, insideG: 10, visitCount: 1 }),
  ];
  const b = breakdownByCustomer(rows);

  it("แยก New / Renew นับวัสดุทุกประเภทงานของกลุ่มนั้น", () => {
    expect(b.new.visits).toBe(4);
    expect(b.new.outsideG).toBe(150);
    expect(b.renew.outsideG).toBe(300);
  });
  it("ไม่ระบุไม่ถูกทิ้ง และยอดรวมตรงเสมอ", () => {
    expect(b.unknown.outsideG).toBe(10);
    expect(b.new.outsideG + b.renew.outsideG + b.unknown.outsideG).toBe(b.all.outsideG);
    expect(b.new.visits + b.renew.visits + b.unknown.visits).toBe(b.all.visits);
  });
});

describe("sumByBranch", () => {
  it("รวมแยกตาม branchId (ทุกประเภทงาน/ลูกค้า)", () => {
    const m = sumByBranch([
      row({ branchId: "a", outsideG: 100 }),
      row({ branchId: "a", workGroup: "problem", outsideG: 50 }),
      row({ branchId: "b", outsideG: 7 }),
    ]);
    expect(m.get("a")?.outsideG).toBe(150);
    expect(m.get("b")?.visits).toBe(1);
    expect(m.size).toBe(2);
  });
});

describe("เทียบเดือนก่อน", () => {
  it("คำนวณ % เปลี่ยน ปัดจำนวนเต็ม", () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(96, 100)).toBe(-4);
    expect(pctChange(100, 100)).toBe(0);
    expect(pctChange(2, 3)).toBe(-33);
  });
  it("เดือนก่อนเป็น 0 / ไม่มีข้อมูล = null (ไม่หารศูนย์ ไม่ NaN/∞)", () => {
    expect(pctChange(50, 0)).toBeNull();
    expect(pctChange(50, null)).toBeNull();
    expect(pctChange(50, undefined)).toBeNull();
    expect(pctChange(0, 0)).toBeNull();
  });
  it("สัดส่วน", () => {
    expect(sharePct(25, 100)).toBe(25);
    expect(sharePct(1, 3)).toBe(33);
    expect(sharePct(5, 0)).toBe(0);
  });
  it("เหยื่อรวม และ ก./กล่อง AG", () => {
    expect(baitTotalG(sumUsage([row({ outsideG: 10, insideG: 5 })]))).toBe(15);
    expect(gramsPerAgBox(450, 100)).toBe(4.5);
    expect(gramsPerAgBox(450, 0)).toBeNull();
  });
});

describe("ภาระงานรายทีม", () => {
  it("ชม./คน = ชั่วโมงรวม ÷ จำนวนคน · ไม่เกินเกณฑ์ = ok", () => {
    const r = evaluateWorkload(60 * 100, 4, 30); // 100 ชม. / 4 คน = 25
    expect(r.perPerson).toBe(25);
    expect(r.level).toBe("ok");
  });
  it("เกินเกณฑ์ = over · เท่ากับเกณฑ์ยังไม่เกิน", () => {
    expect(evaluateWorkload(60 * 130, 4, 30).level).toBe("over"); // 32.5
    expect(evaluateWorkload(60 * 120, 4, 30).level).toBe("ok"); // 30.0
  });
  it("จำนวนคน 0 = คำนวณไม่ได้", () => {
    const r = evaluateWorkload(600, 0, 30);
    expect(r.perPerson).toBeNull();
    expect(r.level).toBe("no-headcount");
  });
  it("เกณฑ์: ทีมที่ตั้งทับใช้ค่าของทีม · ไม่มีใช้ค่ากลาง", () => {
    const th = { central: 30, byTeam: { t9: 20 } };
    expect(thresholdForTeam("t9", th)).toBe(20);
    expect(thresholdForTeam("t1", th)).toBe(30);
  });
  it("นาที → ชั่วโมง", () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(100)).toBe(1.67);
  });
});

function ins(over: Partial<InspectionRow>): InspectionRow {
  return { branchId: "a", teamId: null, isBranchTotal: false, inspectionCount: 0, contractCount: 0, ...over };
}

describe("ตรวจภายใน (2.93 / M43) — อ่านจากแถว RPC", () => {
  // สาขา a: การเข้า 3 ครั้ง (สัญญา 2) · ครั้งหนึ่งไปสองทีม t1+t2 → แถวทีมรวมกัน 4 ครั้ง แต่แถวรวมสาขา 3 ครั้ง
  // สาขา b: การเข้า 1 ครั้ง (สัญญา 1) ทีม t2
  const rows: InspectionRow[] = [
    ins({ branchId: "a", isBranchTotal: true, inspectionCount: 3, contractCount: 2 }),
    ins({ branchId: "a", teamId: "t1", inspectionCount: 2, contractCount: 1 }),
    ins({ branchId: "a", teamId: "t2", inspectionCount: 2, contractCount: 2 }),
    ins({ branchId: "b", isBranchTotal: true, inspectionCount: 1, contractCount: 1 }),
    ins({ branchId: "b", teamId: "t2", inspectionCount: 1, contractCount: 1 }),
  ];

  it("ยอดรวมใช้เฉพาะแถวรวมสาขา — การเข้าหลายทีมไม่นับซ้ำ", () => {
    expect(inspectionTotal(rows)).toEqual({ visits: 4, contracts: 3 });
  });
  it("รายสาขาใช้แถวรวมสาขา ไม่ใช่ผลรวมแถวทีม", () => {
    const m = inspectionByBranchMap(rows);
    expect(m.get("a")).toEqual({ visits: 3, contracts: 2 });
    expect(m.get("b")).toEqual({ visits: 1, contracts: 1 });
  });
  it("รายทีมใช้แถวทีม · ทีมเดียวกันหลายสาขารวมข้ามสาขา · ไม่เอาแถวรวมสาขา", () => {
    const m = inspectionByTeamMap(rows);
    expect(m.get("t1")).toEqual({ visits: 2, contracts: 1 });
    expect(m.get("t2")).toEqual({ visits: 3, contracts: 3 });
    expect(m.size).toBe(2);
  });
  it("แถวที่ไม่มีทีม (team_id null ที่ไม่ใช่แถวรวม) ไม่ถูกนับเป็นทีม", () => {
    expect(inspectionByTeamMap([ins({ branchId: "a", teamId: null, inspectionCount: 5 })]).size).toBe(0);
  });
  it("ไม่มีแถว = 0", () => {
    expect(inspectionTotal([])).toEqual({ visits: 0, contracts: 0 });
    expect(inspectionByBranchMap([]).size).toBe(0);
  });
  it("แปลง error เป็นข้อความไทย ไม่ส่งข้อความดิบ", () => {
    expect(inspectionErrorMessage("II001")).toContain("เดือน");
    expect(inspectionErrorMessage("42501")).toContain("สิทธิ์");
    expect(inspectionErrorMessage("XX999")).toContain("ไม่สำเร็จ");
    expect(inspectionErrorMessage(undefined)).toContain("ไม่สำเร็จ");
    expect(inspectionErrorMessage("II001")).not.toMatch(/[A-Za-z]{4,}/);
  });
});
