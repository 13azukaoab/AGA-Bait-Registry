import { describe, expect, it } from "vitest";

import { bucketByDay, groupVisits, mergeEntries } from "./historyGroups";
import type { AuditRow } from "./historyTypes";

const audit = (id: string, changedAt: string): AuditRow => ({
  id,
  tableName: "contracts",
  rowId: null,
  action: "update",
  oldData: null,
  newData: null,
  changedBy: null,
  changedAt,
  branchId: null,
  contractId: null,
  monthKey: null,
  actorPositionCode: null,
});

describe("groupVisits", () => {
  it("รวมต่อคนต่อวันไทย (เที่ยงคืนไทยตัดวัน)", () => {
    const g = groupVisits([
      { id: "v1", createdBy: "u1", createdAt: "2026-11-05T02:00:00+00:00", branchId: "b1" },
      { id: "v2", createdBy: "u1", createdAt: "2026-11-05T09:00:00+00:00", branchId: "b2" },
      { id: "v3", createdBy: "u1", createdAt: "2026-11-05T17:30:00+00:00", branchId: "b1" }, // = 6 พ.ย. 00:30 ไทย
      { id: "v4", createdBy: "u2", createdAt: "2026-11-05T03:00:00+00:00", branchId: null },
    ]);
    expect(g).toHaveLength(3);
    const u1day5 = g.find((x) => x.userId === "u1" && x.day === "2026-11-05")!;
    expect(u1day5.count).toBe(2);
    expect([...u1day5.branchIds].sort()).toEqual(["b1", "b2"]);
    expect(u1day5.firstAt).toBe("2026-11-05T02:00:00+00:00");
    expect(u1day5.at).toBe("2026-11-05T09:00:00+00:00");
    expect(g[0]?.day).toBe("2026-11-06"); // ใหม่สุดมาก่อน
  });
});

describe("mergeEntries", () => {
  const groups = groupVisits([
    { id: "v1", createdBy: "u1", createdAt: "2026-11-05T10:00:00+00:00", branchId: null },
    { id: "v2", createdBy: "u1", createdAt: "2026-11-01T10:00:00+00:00", branchId: null },
  ]);
  const rows = [audit("a2", "2026-11-06T00:00:00+00:00"), audit("a1", "2026-11-03T00:00:00+00:00")];
  it("เรียงใหม่→เก่า ผสมกัน", () => {
    const m = mergeEntries(rows, groups, false);
    expect(m.map((e) => e.key)).toEqual(["a:a2", "g:u1|2026-11-05", "a:a1", "g:u1|2026-11-01"]);
  });
  it("ยังมีหน้าถัดไป: ซ่อนกลุ่มที่เก่ากว่าแถว audit ล่าสุดที่โหลด", () => {
    const m = mergeEntries(rows, groups, true);
    expect(m.map((e) => e.key)).toEqual(["a:a2", "g:u1|2026-11-05", "a:a1"]);
  });
});

describe("bucketByDay", () => {
  it("แบ่งรายวัน", () => {
    const m = mergeEntries([audit("a", "2026-11-06T00:00:00+00:00"), audit("b", "2026-11-05T05:00:00+00:00")], [], false);
    expect(bucketByDay(m).map((d) => [d.day, d.entries.length])).toEqual([
      ["2026-11-06", 1],
      ["2026-11-05", 1],
    ]);
  });
});
