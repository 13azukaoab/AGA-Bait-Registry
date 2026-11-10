import { describe, it, expect } from "vitest";
import type { SnapshotRow } from "../rules/types";
import { buildDashboardData } from "./buildDashboardData";
import { BRANCH_COUNT } from "./branches";
import type { DashboardRow } from "./types";

/** แถวตัวอย่าง พุทธมณฑล จาก SPEC §9.1 (ในรูป SnapshotRow — มี value_annual เกินมา) */
const buddhamonthon: SnapshotRow = {
  area: "เขต 1", branch: "พุทธมณฑล",
  s1: 41, s3: 123, m1: 12, m3: 13, l1: 5, l3: 5, xl1: 1, xl3: 0,
  cust: 200, vS: 7344973.74, vM: 1860525.89, vL: 1308417, vXL: 318860,
  value: 10832776.63, value_annual: 9999999,
};

/** แถว §9.1 เดียวกันแต่ 16 ฟิลด์ (ที่คาดหวังใน output) */
const buddhamonthonExpected: DashboardRow = {
  area: "เขต 1", branch: "พุทธมณฑล",
  s1: 41, s3: 123, m1: 12, m3: 13, l1: 5, l3: 5, xl1: 1, xl3: 0,
  cust: 200, vS: 7344973.74, vM: 1860525.89, vL: 1308417, vXL: 318860,
  value: 10832776.63,
};

describe("buildDashboardData", () => {
  it("key เดือนเป็น MMM.YY (YYYY-MM → monthKey)", () => {
    const data = buildDashboardData({ computed: { "2026-09": [buddhamonthon] } });
    expect(Object.keys(data)).toEqual(["SEP.26"]);
  });

  it("ทุกเดือนมีครบ 43 สาขา (เติมแถวศูนย์ให้สาขาที่ไม่มีข้อมูล)", () => {
    const data = buildDashboardData({ computed: { "2025-01": [buddhamonthon] } });
    expect(data["JAN.25"]).toHaveLength(BRANCH_COUNT);
  });

  it("รูปแบบแถวตรงตามตัวอย่าง SPEC §9.1 และไม่มี value_annual", () => {
    const data = buildDashboardData({ computed: { "2025-01": [buddhamonthon] } });
    const first = data["JAN.25"]?.[0];
    expect(first).toEqual(buddhamonthonExpected);
    expect(Object.keys(first ?? {})).toHaveLength(16);
    expect(first && "value_annual" in first).toBe(false);
  });

  it("แถวที่เติมศูนย์มี 16 ฟิลด์ ไม่มี value_annual", () => {
    const data = buildDashboardData({ computed: { "2025-01": [buddhamonthon] } });
    const rows = data["JAN.25"] ?? [];
    for (const r of rows) {
      expect(Object.keys(r)).toHaveLength(16);
      expect("value_annual" in r).toBe(false);
    }
  });

  it("เรียงแถวตามลำดับสาขา SPEC §4 (พุทธมณฑลเป็นแถวแรก)", () => {
    const data = buildDashboardData({ computed: { "2025-01": [buddhamonthon] } });
    expect(data["JAN.25"]?.[0]?.branch).toBe("พุทธมณฑล");
  });

  it("merge 3 แหล่ง: manual ทับ computed ทับ legacy ต่อ (เดือน,สาขา)", () => {
    const base = (branch: string, value: number): SnapshotRow => ({
      area: "เขต 1", branch,
      s1: 0, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
      cust: 1, vS: value, vM: 0, vL: 0, vXL: 0, value, value_annual: value,
    });

    const data = buildDashboardData({
      legacy: { "2025-01": [base("พุทธมณฑล", 100)] },
      computed: { "2025-01": [base("พุทธมณฑล", 200)] },
      manual: { "2025-01": [base("ลพบุรี", 300)] },
    });

    const rows = data["JAN.25"] ?? [];
    const bud = rows.find((r) => r.branch === "พุทธมณฑล");
    const lop = rows.find((r) => r.branch === "ลพบุรี");
    expect(bud?.value).toBe(200); // computed ทับ legacy
    expect(lop?.value).toBe(300); // manual
  });

  it("บังคับ area ตามมาตรฐานแม้ input ใส่ area ผิด", () => {
    const wrongArea: SnapshotRow = { ...buddhamonthon, area: "เขต 99" };
    const data = buildDashboardData({ computed: { "2025-01": [wrongArea] } });
    expect(data["JAN.25"]?.[0]?.area).toBe("เขต 1");
  });

  it("throw เมื่อชื่อสาขาสะกดผิด/ไม่รู้จัก", () => {
    const typo: SnapshotRow = { ...buddhamonthon, branch: "พุทธมณฑลล" };
    expect(() => buildDashboardData({ computed: { "2025-01": [typo] } })).toThrow(
      /ไม่อยู่ในรายชื่อ/,
    );
  });

  it("throw เมื่อสาขาซ้ำในแหล่งเดียวกันของเดือนเดียวกัน", () => {
    expect(() =>
      buildDashboardData({
        computed: { "2025-01": [buddhamonthon, buddhamonthon] },
      }),
    ).toThrow(/ซ้ำ/);
  });

  it("หลายเดือนจัดการแยกกัน", () => {
    const data = buildDashboardData({
      computed: { "2025-01": [buddhamonthon], "2026-09": [buddhamonthon] },
    });
    expect(Object.keys(data).sort()).toEqual(["JAN.25", "SEP.26"]);
    expect(data["JAN.25"]).toHaveLength(BRANCH_COUNT);
    expect(data["SEP.26"]).toHaveLength(BRANCH_COUNT);
  });
});

/**
 * กฎ "ยกค่าเดือนล่าสุด" — SPEC §6.5 (ต่างจังหวัดเดือนที่ยังไม่มีข้อมูล)
 * และ §7.7 v1.5 (ปิดส่วนไหนเสร็จส่งทันที ส่วนที่ยังไม่ปิดใช้ค่าที่มีอยู่/ค่ายกมา)
 */
describe("buildDashboardData — ยกค่าเดือนล่าสุด (ต่างจังหวัด)", () => {
  /** แถวต่างจังหวัดแบบย่อ (ใส่เฉพาะค่าที่เทสสนใจ) */
  const province = (branch: string, value: number): SnapshotRow => ({
    area: "เขต 9", branch,
    s1: 1, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    cust: 1, vS: value, vM: 0, vL: 0, vXL: 0, value, value_annual: value,
  });

  const central = (branch: string, value: number): SnapshotRow => ({
    area: "เขต 1", branch,
    s1: 1, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    cust: 1, vS: value, vM: 0, vL: 0, vXL: 0, value, value_annual: value,
  });

  const rowOf = (data: ReturnType<typeof buildDashboardData>, key: string, branch: string) =>
    (data[key] ?? []).find((r) => r.branch === branch);

  it("ต่างจังหวัดเดือนที่ไม่มีข้อมูล → ยกค่าเดือนก่อนมาทั้งแถว", () => {
    const data = buildDashboardData({
      manual: { "2026-01": [province("ลพบุรี", 500)] },
      computed: { "2026-02": [central("พุทธมณฑล", 10)] },
    });
    expect(rowOf(data, "FEB.26", "ลพบุรี")?.value).toBe(500);
    expect(rowOf(data, "FEB.26", "ลพบุรี")?.cust).toBe(1);
  });

  it("ยกต่อได้หลายเดือนติดกัน (ยกค่าเดือนล่าสุดที่มีข้อมูลจริง)", () => {
    const data = buildDashboardData({
      manual: { "2026-01": [province("ลพบุรี", 500)] },
      computed: {
        "2026-02": [central("พุทธมณฑล", 10)],
        "2026-03": [central("พุทธมณฑล", 10)],
      },
    });
    expect(rowOf(data, "MAR.26", "ลพบุรี")?.value).toBe(500);
  });

  it("มีข้อมูลใหม่แล้วยกค่าใหม่ต่อ (ไม่ยกค่าเก่าค้าง)", () => {
    const data = buildDashboardData({
      manual: {
        "2026-01": [province("ลพบุรี", 500)],
        "2026-02": [province("ลพบุรี", 800)],
      },
      computed: { "2026-03": [central("พุทธมณฑล", 10)] },
    });
    expect(rowOf(data, "MAR.26", "ลพบุรี")?.value).toBe(800);
  });

  it("เดือนแรกที่ยังไม่เคยมีข้อมูลต่างจังหวัด → แถวศูนย์ (ไม่มีค่าให้ยก)", () => {
    const data = buildDashboardData({
      computed: { "2026-01": [central("พุทธมณฑล", 10)] },
      manual: { "2026-02": [province("ลพบุรี", 500)] },
    });
    expect(rowOf(data, "JAN.26", "ลพบุรี")?.value).toBe(0);
    expect(rowOf(data, "JAN.26", "ลพบุรี")?.cust).toBe(0);
  });

  it("ส่วนกลางไม่ยกค่าเดือนก่อน — เดือนที่ไม่มีข้อมูลเป็นแถวศูนย์", () => {
    const data = buildDashboardData({
      computed: { "2026-01": [central("พุทธมณฑล", 10)] },
      manual: { "2026-02": [province("ลพบุรี", 500)] },
    });
    expect(rowOf(data, "FEB.26", "พุทธมณฑล")?.value).toBe(0);
  });

  it("ปิด carryForwardProvince ได้ (ใช้ตรวจความครบก่อนปิดเดือน) → แถวศูนย์", () => {
    const data = buildDashboardData(
      {
        manual: { "2026-01": [province("ลพบุรี", 500)] },
        computed: { "2026-02": [central("พุทธมณฑล", 10)] },
      },
      { carryForwardProvince: false },
    );
    expect(rowOf(data, "FEB.26", "ลพบุรี")?.value).toBe(0);
  });

  it("แถวที่ยกมามี 16 ฟิลด์ และไม่ใช้ object เดียวกันกับเดือนก่อน", () => {
    const data = buildDashboardData({
      manual: { "2026-01": [province("ลพบุรี", 500)] },
      computed: { "2026-02": [central("พุทธมณฑล", 10)] },
    });
    const jan = rowOf(data, "JAN.26", "ลพบุรี");
    const feb = rowOf(data, "FEB.26", "ลพบุรี");
    expect(Object.keys(feb ?? {})).toHaveLength(16);
    expect(feb).not.toBe(jan);
    expect(feb).toEqual(jan);
  });

  it("ทุกเดือนยังครบ 43 สาขาเมื่อมีการยกค่า", () => {
    const data = buildDashboardData({
      manual: { "2026-01": [province("ลพบุรี", 500)] },
      computed: { "2026-02": [central("พุทธมณฑล", 10)] },
    });
    expect(data["JAN.26"]).toHaveLength(BRANCH_COUNT);
    expect(data["FEB.26"]).toHaveLength(BRANCH_COUNT);
  });
});
