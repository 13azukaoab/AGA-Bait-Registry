import { describe, expect, it } from "vitest";

import type { MaterialVisit, UsageRow } from "./logic";
import type { MaterialPageData } from "./materialData";
import { buildMaterialView } from "./viewModel";

function u(over: Partial<UsageRow>): UsageRow {
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

function v(over: Partial<MaterialVisit>): MaterialVisit {
  return {
    visitId: Math.random().toString(36).slice(2),
    branchId: "b1",
    customerId: "c1",
    internalInspection: false,
    teamIds: [],
    durationMin: 0,
    ...over,
  };
}

function data(
  cur: { usage: UsageRow[]; visits: MaterialVisit[] },
  prev: { usage: UsageRow[]; visits: MaterialVisit[] },
): MaterialPageData {
  return {
    month: "2026-10",
    prevMonth: "2026-09",
    current: { ...cur, truncated: false },
    previous: { ...prev, truncated: false },
    branches: [
      { id: "b1", name: "สาขาหนึ่ง", division: "central" },
      { id: "b2", name: "สาขาสอง", division: "province" },
      { id: "b3", name: "สาขาว่าง", division: "central" },
    ],
    teams: [
      { id: "t1", code: "A", name: "ทีม A", kind: "service", branchId: null, headcount: 2, isActive: true },
      { id: "t2", code: "B", name: "ทีม B", kind: "service", branchId: null, headcount: 0, isActive: true },
      { id: "t3", code: "C", name: "ทีม C", kind: "install", branchId: null, headcount: 0, isActive: false },
    ],
    thresholds: { central: 30, byTeam: { t2: 10 } },
    agBoxes: [{ branchId: "b1", inUse: 50, checked: 20, checkedPrev: 25 }],
  };
}

describe("buildMaterialView", () => {
  const curUsage = [
    u({ branchId: "b1", outsideG: 400, insideG: 200, visitCount: 3 }),
    u({ branchId: "b2", saleType: "new", outsideG: 100, visitCount: 1 }),
  ];
  const prevUsage = [u({ branchId: "b1", outsideG: 300, insideG: 200 })];
  const curVisits = [
    v({ branchId: "b1", teamIds: ["t1"], durationMin: 3720, internalInspection: true, customerId: "c1" }), // 62 ชม.
    v({ branchId: "b2", teamIds: ["t1", "t2"], durationMin: 60, internalInspection: true, customerId: "c2" }),
    v({ branchId: "b2", teamIds: ["t2"], internalInspection: true, customerId: "c2" }),
  ];
  const view = buildMaterialView(data({ usage: curUsage, visits: curVisits }, { usage: prevUsage, visits: [] }), null);

  it("แถวสาขา: มีเฉพาะสาขาที่มีการเข้า + % เทียบเดือนก่อน", () => {
    expect(view.branches.map((b) => b.branch.id)).toEqual(["b1", "b2"]);
    expect(view.branches[0]?.baitPctVsPrev).toBe(20); // 600 vs 500
    expect(view.branches[1]?.baitPctVsPrev).toBeNull(); // เดือนก่อนไม่มีข้อมูล
  });

  it("ก./กล่อง AG = เหยื่อใน ÷ กล่องที่ตรวจ · เดือนก่อนใช้ checkedPrev", () => {
    expect(view.branches[0]?.gPerAgBox).toBe(10); // 200 / 20
    expect(view.branches[0]?.gPerAgBoxPrev).toBe(8); // 200 / 25
    expect(view.branches[1]?.gPerAgBox).toBeNull();
  });

  it("ภาระงาน: เวลาเต็มให้ทุกทีมที่ไปด้วย · เกณฑ์ทีมที่ตั้งทับใช้ของทีม", () => {
    const t1 = view.teams.find((t) => t.team.id === "t1");
    expect(t1?.visits).toBe(2);
    expect(t1?.minutes).toBe(3780);
    expect(t1?.workload.perPerson).toBe(31.5); // 63 ชม. / 2 คน
    expect(t1?.workload.level).toBe("over");
    const t2 = view.teams.find((t) => t.team.id === "t2");
    expect(t2?.workload.level).toBe("no-headcount");
    expect(t2?.workload.threshold).toBe(10);
  });

  it("ทีมที่ปิดและไม่มีงานไม่แสดง", () => {
    expect(view.teams.some((t) => t.team.id === "t3")).toBe(false);
  });

  it("ตรวจภายใน: นับการเข้าและลูกค้าไม่ซ้ำ แยกสาขา/ทีม", () => {
    expect(view.inspection).toEqual({ visits: 3, customers: 2 });
    expect(view.inspectionByBranch.find((r) => r.branch.id === "b2")?.count).toEqual({ visits: 2, customers: 1 });
    expect(view.inspectionByTeam.find((r) => r.team.id === "t2")?.count).toEqual({ visits: 2, customers: 1 });
  });

  it("กรองสาขา: ใช้กับทั้งเดือนนี้และเดือนก่อน", () => {
    const only = buildMaterialView(data({ usage: curUsage, visits: curVisits }, { usage: prevUsage, visits: [] }), "b2");
    expect(only.all.visits).toBe(1);
    expect(only.allPrev.visits).toBe(0);
    expect(only.customer.new.visits).toBe(1);
    expect(only.branches.map((b) => b.branch.id)).toEqual(["b2"]);
  });

  it("sale_type ไม่ระบุยังรวมในยอดรวม", () => {
    const d = data({ usage: [u({ saleType: "unknown", outsideG: 40 }), u({ saleType: "new", outsideG: 60 })], visits: [] }, { usage: [], visits: [] });
    const r = buildMaterialView(d, null);
    expect(r.customer.unknown.outsideG).toBe(40);
    expect(r.all.outsideG).toBe(100);
  });

  it("ตั้ง truncated เมื่อเดือนใดเดือนหนึ่งโหลดไม่ครบ", () => {
    const d = data({ usage: [], visits: [] }, { usage: [], visits: [] });
    d.previous.truncated = true;
    expect(buildMaterialView(d, null).truncated).toBe(true);
  });
});
