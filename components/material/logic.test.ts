import { describe, expect, it } from "vitest";

import {
  baitTotalG,
  breakdownByCustomer,
  breakdownByWork,
  countInternalInspection,
  gramsPerAgBox,
  inspectionByKey,
  pctChange,
  sharePct,
  sumByBranch,
  sumUsage,
  type MaterialVisit,
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

let seq = 0;
function visit(over: Partial<MaterialVisit> = {}): MaterialVisit {
  seq += 1;
  return {
    visitId: `v${seq}`,
    branchId: "b1",
    customerId: "c1",
    internalInspection: false,
    teamIds: ["t1"],
    durationMin: 60,
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

describe("ตรวจภายใน (2.93)", () => {
  const visits = [
    visit({ customerId: "c1", internalInspection: true, branchId: "a", teamIds: ["t1"] }),
    visit({ customerId: "c1", internalInspection: true, branchId: "a", teamIds: ["t1", "t2"] }), // ลูกค้าเดิม เข้าอีกครั้ง
    visit({ customerId: "c2", internalInspection: true, branchId: "b", teamIds: ["t2"] }),
    visit({ customerId: "c3", internalInspection: false, branchId: "b", teamIds: ["t2"] }),
  ];
  it("ลูกค้าเดียวกันเข้าหลายครั้ง นับการเข้าทุกครั้ง แต่นับลูกค้า 1 ราย", () => {
    expect(countInternalInspection(visits)).toEqual({ visits: 3, customers: 2 });
  });
  it("ไม่ติ๊ก = ไม่นับ · ไม่มีการเข้า = 0", () => {
    expect(countInternalInspection([visit({ internalInspection: false })])).toEqual({ visits: 0, customers: 0 });
    expect(countInternalInspection([])).toEqual({ visits: 0, customers: 0 });
  });
  it("แยกตามสาขา", () => {
    const m = inspectionByKey(visits, (v) => [v.branchId]);
    expect(m.get("a")).toEqual({ visits: 2, customers: 1 });
    expect(m.get("b")).toEqual({ visits: 1, customers: 1 });
  });
  it("แยกตามทีม: เข้าพร้อมหลายทีมนับให้ทุกทีม · ทีมที่ไม่มีตรวจไม่มีแถว", () => {
    const m = inspectionByKey(visits, (v) => v.teamIds);
    expect(m.get("t1")).toEqual({ visits: 2, customers: 1 });
    expect(m.get("t2")).toEqual({ visits: 2, customers: 2 });
    expect(m.has("t9")).toBe(false);
  });
});
