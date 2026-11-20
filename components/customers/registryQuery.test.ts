import { describe, expect, it } from "vitest";

import { defaultFilters } from "./registryFilters";
import { allowedBranchIds, applyRegistryFilters, combineOrGroups, cursorClause, SORTS, type FilterLike } from "./registryQuery";
import type { BranchRef } from "./registryTypes";

/** builder จำลอง: จดการเรียกไว้ */
class Rec implements FilterLike {
  calls: [string, ...unknown[]][] = [];
  in(c: string, v: readonly string[]) {
    this.calls.push(["in", c, [...v]]);
    return this;
  }
  eq(c: string, v: string | number) {
    this.calls.push(["eq", c, v]);
    return this;
  }
  neq(c: string, v: string | number) {
    this.calls.push(["neq", c, v]);
    return this;
  }
  or(e: string) {
    this.calls.push(["or", e]);
    return this;
  }
}

const branches: BranchRef[] = [
  { id: "b1", name: "A", zoneId: "z1", zoneName: "เขต 1", zoneOrder: 1 },
  { id: "b2", name: "B", zoneId: "z1", zoneName: "เขต 1", zoneOrder: 1 },
  { id: "b3", name: "C", zoneId: "z2", zoneName: "เขต 2", zoneOrder: 2 },
];

describe("cursorClause (keyset)", () => {
  it("ค่าเริ่มต้น = วันเริ่ม ใหม่→เก่า: lt + id lt", () => {
    expect(cursorClause(SORTS.default, { value: "2026-05-01", id: "X" })).toBe("start_date.lt.2026-05-01,and(start_date.eq.2026-05-01,id.lt.X)");
  });

  it("มูลค่า น้อย→มาก: gt + id gt", () => {
    expect(cursorClause(SORTS.value_asc, { value: "96000", id: "X" })).toBe("value_total.gt.96000,and(value_total.eq.96000,id.gt.X)");
  });

  it("วันสิ้นสุดว่างได้: ท้ายสุดเสมอ — ค่าไม่ว่างต้องรวมกลุ่มว่างเป็นหน้าถัดไป · cursor ที่ว่างใช้ id ในกลุ่มว่าง", () => {
    expect(cursorClause(SORTS.end_asc, { value: "2027-01-01", id: "X" })).toBe("end_date.gt.2027-01-01,and(end_date.eq.2027-01-01,id.gt.X),end_date.is.null");
    expect(cursorClause(SORTS.end_desc, { value: "2027-01-01", id: "X" })).toBe("end_date.lt.2027-01-01,and(end_date.eq.2027-01-01,id.lt.X),end_date.is.null");
    expect(cursorClause(SORTS.end_asc, { value: null, id: "X" })).toBe("and(end_date.is.null,id.gt.X)");
    expect(cursorClause(SORTS.end_desc, { value: null, id: "X" })).toBe("and(end_date.is.null,id.lt.X)");
  });
});

describe("combineOrGroups", () => {
  it("0 ก้อน = null · 1 ก้อน = ก้อนนั้น · หลายก้อน = and(or(..),or(..))", () => {
    expect(combineOrGroups([])).toBeNull();
    expect(combineOrGroups(["a"])).toBe("a");
    expect(combineOrGroups(["a,b", "c"])).toBe("and(or(a,b),or(c))");
  });
});

describe("allowedBranchIds", () => {
  it("ไม่เลือก = null (ไม่กรอง) · เลือกเขต = ทุกสาขาในเขต · เลือกทั้งเขตและสาขา = สาขาต้องอยู่ในเขตด้วย", () => {
    expect(allowedBranchIds({ zones: [], branches: [] }, branches)).toBeNull();
    expect(allowedBranchIds({ zones: ["z1"], branches: [] }, branches)).toEqual(["b1", "b2"]);
    expect(allowedBranchIds({ zones: ["z1"], branches: ["b1", "b3"] }, branches)).toEqual(["b1"]);
    expect(allowedBranchIds({ zones: [], branches: ["b3"] }, branches)).toEqual(["b3"]);
  });
});

describe("applyRegistryFilters", () => {
  it("ไม่มีตัวกรอง = ไม่ใส่เงื่อนไขอะไรเลย", () => {
    const q = new Rec();
    expect(applyRegistryFilters(q, defaultFilters(), branches, "", null)).toBe(q);
    expect(q.calls).toEqual([]);
  });

  it("ตัวกรองหลายอย่างทำงานร่วมกัน (AND)", () => {
    const q = new Rec();
    applyRegistryFilters(q, { ...defaultFilters(), zones: ["z1"], years: "3", statuses: ["near_end"] }, branches, "", null);
    expect(q.calls).toEqual([
      ["in", "customers.branch_id", ["b1", "b2"]],
      ["eq", "term_months", 36],
      ["in", "status", ["active"]],
    ]);
  });

  it("ปีสัญญา 1 = ทุกอย่างที่ไม่ใช่ 36 เดือน (Custom นับกลุ่ม 1 ปี)", () => {
    const q = new Rec();
    applyRegistryFilters(q, { ...defaultFilters(), years: "1" }, branches, "", null);
    expect(q.calls).toEqual([["neq", "term_months", 36]]);
  });

  it("เขต/สาขาที่เลือกแล้วไม่มีสาขาตรงกัน = null (ผลว่าง ไม่ต้องยิง query)", () => {
    expect(applyRegistryFilters(new Rec(), { ...defaultFilters(), zones: ["z1"], branches: ["b3"] }, branches, "", null)).toBeNull();
  });

  it("ค้นหา + cursor รวมเป็น .or() ตัวเดียว", () => {
    const q = new Rec();
    applyRegistryFilters(q, defaultFilters(), branches, "สมชาย", { value: "2026-05-01", id: "X" });
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0]).toEqual([
      "or",
      "and(or(contract_no.ilike.*สมชาย*,customers.name.ilike.*สมชาย*),or(start_date.lt.2026-05-01,and(start_date.eq.2026-05-01,id.lt.X)))",
    ]);
  });
});
