import { describe, expect, it } from "vitest";

import { defaultFilters } from "./historyFilters";
import {
  allowedBranchIds,
  applyAuditFilters,
  bangkokRangeUtc,
  combineOrGroups,
  cursorClause,
  monthDateRange,
  postCloseClause,
  type FilterLike,
} from "./historyQuery";
import type { BranchRef, ClosureRef } from "./historyTypes";

/** builder จำลอง: บันทึกการเรียกไว้ตรวจ */
class Rec implements FilterLike {
  calls: [string, ...unknown[]][] = [];
  in(c: string, v: readonly string[]) {
    this.calls.push(["in", c, [...v]]);
    return this;
  }
  gte(c: string, v: string) {
    this.calls.push(["gte", c, v]);
    return this;
  }
  lt(c: string, v: string) {
    this.calls.push(["lt", c, v]);
    return this;
  }
  eq(c: string, v: string) {
    this.calls.push(["eq", c, v]);
    return this;
  }
  or(e: string) {
    this.calls.push(["or", e]);
    return this;
  }
  not(c: string, o: string, v: string) {
    this.calls.push(["not", c, o, v]);
    return this;
  }
  find(name: string) {
    return this.calls.filter((c) => c[0] === name);
  }
}

const branches: BranchRef[] = [
  { id: "b1", name: "ลาดพร้าว", division: "central", zoneId: "z4", zoneName: "เขต 4" },
  { id: "b2", name: "นนทบุรี", division: "central", zoneId: "z2", zoneName: "เขต 2" },
  { id: "b3", name: "เชียงใหม่", division: "province", zoneId: "z9", zoneName: "เขต 9" },
];
const closures: ClosureRef[] = [{ monthKey: "2026-10", scope: "central", closedAt: "2026-11-02T03:00:00+00:00", lastResyncAt: null }];
const F = defaultFilters("2026-11-19");

describe("keyset cursor", () => {
  it("ใส่เวลาดิบในเครื่องหมายคำพูด และใช้ id ตัดสินเมื่อเวลาเท่ากัน", () => {
    expect(cursorClause({ changedAt: "2026-11-05T07:20:00.123456+00:00", id: "abc" })).toBe(
      'changed_at.lt."2026-11-05T07:20:00.123456+00:00",and(changed_at.eq."2026-11-05T07:20:00.123456+00:00",id.lt.abc)',
    );
  });
  it("ไม่มี cursor = ไม่มี or", () => {
    const r = new Rec();
    applyAuditFilters(r, F, { branches, closures }, null);
    expect(r.find("or")).toHaveLength(0);
  });
  it("มี cursor = .or ตัวเดียวเป็น cursor", () => {
    const r = new Rec();
    applyAuditFilters(r, F, { branches, closures }, { changedAt: "T", id: "i" });
    expect(r.find("or")).toEqual([["or", cursorClause({ changedAt: "T", id: "i" })]]);
  });
});

describe("ช่วงวัน", () => {
  it("วันไทยเป็นช่วง UTC [00:00+07, +1 วัน)", () => {
    expect(bangkokRangeUtc("2026-11-01", "2026-11-02")).toEqual({
      gte: "2026-10-31T17:00:00.000Z",
      lt: "2026-11-02T17:00:00.000Z",
    });
  });
  it("monthDateRange ข้ามปี", () => {
    expect(monthDateRange("2026-12")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" });
  });
});

describe("ตัวกรอง → query", () => {
  it("คน / เดือน / สัญญา / การกระทำ", () => {
    const r = new Rec();
    applyAuditFilters(
      r,
      { ...F, people: ["u1"], months: ["2026-10"], contractId: "c9", actions: ["update"] },
      { branches, closures },
      null,
    );
    expect(r.find("in")).toEqual(
      expect.arrayContaining([
        ["in", "changed_by", ["u1"]],
        ["in", "month_key", ["2026-10"]],
        ["in", "action", ["update"]],
      ]),
    );
    expect(r.find("eq")).toEqual([["eq", "contract_id", "c9"]]);
  });
  it("เขต → สาขาในเขต · เขต+สาขา = ต้องอยู่ในเขต", () => {
    expect(allowedBranchIds({ zones: ["z4"], branches: [] }, branches)).toEqual(["b1"]);
    expect(allowedBranchIds({ zones: ["z4"], branches: ["b1", "b2"] }, branches)).toEqual(["b1"]);
    expect(allowedBranchIds({ zones: [], branches: [] }, branches)).toBeNull();
  });
  it("เขต+สาขาไม่ซ้อนกัน → ผลว่างโดยไม่ยิง query", () => {
    expect(applyAuditFilters(new Rec(), { ...F, zones: ["z4"], branches: ["b2"] }, { branches, closures }, null)).toBeNull();
  });
  it("ประเภทข้อมูล → table_name IN", () => {
    const r = new Rec();
    applyAuditFilters(r, { ...F, kinds: ["contract"] }, { branches, closures }, null);
    expect(r.find("in").find((c) => c[1] === "table_name")?.[2]).toEqual(["contracts", "contract_teams"]);
  });
  it("ประเภท 'อื่นๆ' อย่างเดียว → NOT IN ตารางที่รู้จัก", () => {
    const r = new Rec();
    applyAuditFilters(r, { ...F, kinds: ["other"] }, { branches, closures }, null);
    expect(r.find("not")[0]?.[1]).toBe("table_name");
    expect(r.find("not")[0]?.[2]).toBe("in");
  });
  it("อื่นๆ + ประเภทอื่น → OR group", () => {
    const r = new Rec();
    applyAuditFilters(r, { ...F, kinds: ["other", "contract"] }, { branches, closures }, null);
    expect(String(r.find("or")[0]?.[1])).toContain("table_name.not.in.");
  });
});

describe("แก้หลังปิด", () => {
  it("clause ต่อการปิด: เดือน + สาขาของส่วนนั้น + เวลาหลังปิด", () => {
    expect(postCloseClause(closures, branches)).toBe(
      'and(month_key.eq.2026-10,branch_id.in.(b1,b2),changed_at.gt."2026-11-02T03:00:00+00:00")',
    );
  });
  it("ยังไม่มีการปิดเลย → null → ผลว่าง", () => {
    expect(postCloseClause([], branches)).toBeNull();
    expect(applyAuditFilters(new Rec(), { ...F, postCloseOnly: true }, { branches, closures: [] }, null)).toBeNull();
  });
  it("ตัดตารางปิดเดือนออก", () => {
    const r = new Rec();
    applyAuditFilters(r, { ...F, postCloseOnly: true }, { branches, closures }, null);
    expect(r.find("not")).toEqual([["not", "table_name", "in", "(month_closures,month_closure_overrides)"]]);
  });
  it("หลายก้อน OR (แก้หลังปิด + cursor) รวมเป็น and(or(),or()) ใน .or ตัวเดียว", () => {
    const r = new Rec();
    applyAuditFilters(r, { ...F, postCloseOnly: true }, { branches, closures }, { changedAt: "T", id: "i" });
    expect(r.find("or")).toHaveLength(1);
    expect(String(r.find("or")[0]?.[1])).toMatch(/^and\(or\(and\(month_key/);
  });
  it("combineOrGroups", () => {
    expect(combineOrGroups([])).toBeNull();
    expect(combineOrGroups(["a"])).toBe("a");
    expect(combineOrGroups(["a", "b"])).toBe("and(or(a),or(b))");
  });
});
