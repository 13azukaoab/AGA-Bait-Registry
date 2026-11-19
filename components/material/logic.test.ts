import { describe, expect, it } from "vitest";

import {
  baitTotalG,
  breakdownByCustomer,
  breakdownByWork,
  customerGroupOf,
  gramsPerAgBox,
  pctChange,
  sharePct,
  sumByBranch,
  sumMaterials,
  workGroupOf,
  type MaterialVisit,
} from "./logic";
import { evaluateWorkload, minutesToHours, thresholdForTeam } from "./workload";

let seq = 0;
function visit(over: Partial<MaterialVisit> = {}): MaterialVisit {
  seq += 1;
  return {
    visitId: `v${seq}`,
    branchId: "b1",
    visitType: "routine",
    makeupForMonth: null,
    saleType: "renew",
    teamIds: ["t1"],
    durationMin: 60,
    outsideG: 0,
    insideG: 0,
    installBaitG: 0,
    powderPoints: 0,
    timberPcs: 0,
    ...over,
  };
}

describe("workGroupOf — จัดกลุ่มประเภทงาน", () => {
  it("routine ปกติ = routine", () => {
    expect(workGroupOf({ visitType: "routine", makeupForMonth: null })).toBe("routine");
  });
  it("routine ที่มี makeup_for_month = ชดเชย", () => {
    expect(workGroupOf({ visitType: "routine", makeupForMonth: "2026-09-01" })).toBe("makeup");
  });
  it("problem และ follow_up = แก้ไขปัญหา", () => {
    expect(workGroupOf({ visitType: "problem", makeupForMonth: null })).toBe("problem");
    expect(workGroupOf({ visitType: "follow_up", makeupForMonth: null })).toBe("problem");
  });
  it("การเข้าแก้ปัญหาที่มี makeup_for_month ยังนับเป็นแก้ไขปัญหา (ชดเชยแยกเฉพาะในประจำเดือน)", () => {
    expect(workGroupOf({ visitType: "problem", makeupForMonth: "2026-09-01" })).toBe("problem");
  });
});

describe("breakdownByWork", () => {
  const visits = [
    visit({ outsideG: 500, insideG: 300, powderPoints: 10, timberPcs: 40 }),
    visit({ outsideG: 100, insideG: 50, powderPoints: 2, timberPcs: 5, makeupForMonth: "2026-09-01" }),
    visit({ visitType: "problem", outsideG: 200, insideG: 400, installBaitG: 250, powderPoints: 5, timberPcs: 8 }),
    visit({ visitType: "follow_up", outsideG: 50, insideG: 100, powderPoints: 0, timberPcs: 2 }),
  ];
  const b = breakdownByWork(visits);

  it("ประจำเดือนรวมชดเชย · ชดเชยเป็นเซ็ตย่อย", () => {
    expect(b.routine.visits).toBe(2);
    expect(b.routine.outsideG).toBe(600);
    expect(b.makeup.visits).toBe(1);
    expect(b.makeup.outsideG).toBe(100);
  });
  it("แก้ไขปัญหารวม problem + follow_up และเหยื่อติดตั้ง AG", () => {
    expect(b.problem.visits).toBe(2);
    expect(b.problem.outsideG).toBe(250);
    expect(b.problem.insideG).toBe(500);
    expect(b.problem.installBaitG).toBe(250);
  });
  it("routine + problem = ยอดรวมทุกการเข้า", () => {
    expect(b.routine.outsideG + b.problem.outsideG).toBe(b.all.outsideG);
    expect(b.routine.insideG + b.problem.insideG).toBe(b.all.insideG);
    expect(b.routine.timberPcs + b.problem.timberPcs).toBe(b.all.timberPcs);
  });
  it("ไม่มีการเข้า = ศูนย์ทุกช่อง", () => {
    expect(breakdownByWork([]).all).toEqual(sumMaterials([]));
    expect(breakdownByWork([]).all.visits).toBe(0);
  });
});

describe("เคมีผง", () => {
  it("คิดกรัม = จุด × 0.3 จากยอดรวม (ไม่ปัดทีละการเข้า)", () => {
    const m = sumMaterials([visit({ powderPoints: 1 }), visit({ powderPoints: 1 }), visit({ powderPoints: 1 })]);
    expect(m.powderPoints).toBe(3);
    expect(m.powderG).toBe(0.9);
  });
});

describe("breakdownByCustomer — New / Renew", () => {
  const visits = [
    visit({ saleType: "new", outsideG: 100, insideG: 100 }),
    visit({ saleType: "new", visitType: "problem", outsideG: 50, insideG: 0 }),
    visit({ saleType: "renew", outsideG: 300, insideG: 200 }),
    visit({ saleType: null, outsideG: 10, insideG: 10 }),
  ];
  const b = breakdownByCustomer(visits);

  it("แยก New / Renew นับวัสดุทั้งหมดของกลุ่ม (ทุกประเภทงาน)", () => {
    expect(b.new.visits).toBe(2);
    expect(b.new.outsideG).toBe(150);
    expect(b.renew.outsideG).toBe(300);
  });
  it("ไม่มี sale_type อยู่กลุ่ม unknown และยอดรวมตรงเสมอ", () => {
    expect(customerGroupOf({ saleType: null })).toBe("unknown");
    expect(b.unknown.outsideG).toBe(10);
    expect(b.new.outsideG + b.renew.outsideG + b.unknown.outsideG).toBe(b.all.outsideG);
  });
});

describe("sumByBranch", () => {
  it("รวมแยกตาม branchId", () => {
    const m = sumByBranch([
      visit({ branchId: "a", outsideG: 100 }),
      visit({ branchId: "a", outsideG: 50 }),
      visit({ branchId: "b", outsideG: 7 }),
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
  it("เดือนก่อนเป็น 0 / ไม่มีข้อมูล = null (ไม่หารศูนย์)", () => {
    expect(pctChange(50, 0)).toBeNull();
    expect(pctChange(50, null)).toBeNull();
    expect(pctChange(50, undefined)).toBeNull();
  });
  it("สัดส่วน", () => {
    expect(sharePct(25, 100)).toBe(25);
    expect(sharePct(1, 3)).toBe(33);
    expect(sharePct(5, 0)).toBe(0);
  });
  it("เหยื่อรวม และ ก./กล่อง AG", () => {
    expect(baitTotalG(sumMaterials([visit({ outsideG: 10, insideG: 5 })]))).toBe(15);
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
