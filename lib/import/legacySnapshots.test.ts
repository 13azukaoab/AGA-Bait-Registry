/**
 * เทสตัวแปลง dashboard_data.json เดิม → แถว legacy (ข้อมูลสมมติทั้งหมด · รันบน CI)
 * ตัวเลขในไฟล์นี้เป็นค่าสมมติ ไม่ใช่ตัวเลขจริงของสาขา
 */
import { describe, expect, it } from "vitest";
import { BRANCHES } from "../dashboard/branches";
import { buildDashboardData } from "../dashboard/buildDashboardData";
import { assembleDashboardSources } from "../dashboard/sources";
import type { DashboardData, DashboardRow } from "../dashboard/types";
import {
  convertLegacyDashboardData,
  legacyTotalsByMonth,
  parseDashboardMonthKey,
  toCents,
  toSnapshotInsertRows,
} from "./legacySnapshots";

/** แถวสมมติ 1 สาขา — ตัวเลขต่างกันตาม index เพื่อจับการสลับแถว */
function fakeRow(i: number, monthIdx: number): DashboardRow {
  const b = BRANCHES[i]!;
  const s1 = i + monthIdx;
  const m3 = 2;
  const vS = 1000.25 * (i + 1);
  const vM = 500.5;
  return {
    area: b.area,
    branch: b.branch,
    s1, s3: 0, m1: 0, m3, l1: 0, l3: 0, xl1: 0, xl3: 0,
    cust: s1 + m3,
    vS, vM, vL: 0, vXL: 0,
    value: vS + vM,
  };
}

function fakeData(keys: string[]): DashboardData {
  const out: DashboardData = {};
  keys.forEach((k, mi) => {
    out[k] = BRANCHES.map((_, i) => fakeRow(i, mi));
  });
  return out;
}

const GO_LIVE = "2026-10";
const KEYS = ["JUL.26", "AUG.26", "SEP.26", "OCT.26"];

describe("parseDashboardMonthKey", () => {
  it("แปลง MMM.YY → YYYY-MM", () => {
    expect(parseDashboardMonthKey("JAN.25")).toBe("2025-01");
    expect(parseDashboardMonthKey("SEP.26")).toBe("2026-09");
    expect(parseDashboardMonthKey("DEC.99")).toBe("2099-12");
  });
  it("รูปแบบผิด = throw", () => {
    for (const bad of ["Sep.26", "SEP26", "SEP.2026", "2026-09", "XYZ.26", ""]) {
      expect(() => parseDashboardMonthKey(bad)).toThrow();
    }
  });
});

describe("toCents", () => {
  it("ตัดเศษ float ที่เกิดจากการบวก แต่ค่าเท่าเดิม", () => {
    expect(toCents(1600595.4100000001)).toBe(160059541);
    expect(toCents(6744617.0)).toBe(674461700);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
  it("มีหลักที่ 3 จริง = throw (ไม่ปัดทิ้งเงียบๆ)", () => {
    expect(() => toCents(10.005)).toThrow();
    expect(() => toCents(1.234)).toThrow();
  });
  it("ไม่ใช่ตัวเลข / ติดลบ = throw", () => {
    expect(() => toCents(Number.NaN)).toThrow();
    expect(() => toCents(-1)).toThrow();
  });
});

describe("convertLegacyDashboardData", () => {
  it("นำเข้าเฉพาะเดือนก่อน go-live · เดือนที่ go-live ขึ้นไปถูกตัด (OCT.26)", () => {
    const res = convertLegacyDashboardData(fakeData(KEYS), { goLiveMonth: GO_LIVE });
    expect(res.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(res.skippedKeys).toEqual(["OCT.26"]);
    expect(res.rows).toHaveLength(3 * 43);
    expect(res.rows.every((r) => r.source === "legacy")).toBe(true);
    expect(res.rows.every((r) => /^\d{4}-\d{2}$/.test(r.month))).toBe(true);
  });

  it("ค่าเงินที่มีเศษ float ถูกเก็บเป็น 2 ตำแหน่ง ยอดเท่าเดิม", () => {
    const data = fakeData(["SEP.26"]);
    const r0 = data["SEP.26"]![0]!;
    r0.vS = 1600595.4100000001;
    r0.vM = 6744617.0;
    r0.value = r0.vS + r0.vM;
    const res = convertLegacyDashboardData(data, { goLiveMonth: GO_LIVE });
    const out = res.rows.find((r) => r.branch === r0.branch)!;
    expect(out.vS).toBe(1600595.41);
    expect(out.vM).toBe(6744617);
    expect(out.value).toBe(8345212.41);
  });

  it("ใช้เขตปัจจุบันเสมอ (จับคู่ด้วยชื่อสาขา) และรายงานแถวที่เขตในไฟล์ต่าง", () => {
    const data = fakeData(["SEP.26"]);
    const row = data["SEP.26"]!.find((r) => r.branch === "พระราม 2")!;
    row.area = "เขต 1";
    const res = convertLegacyDashboardData(data, { goLiveMonth: GO_LIVE });
    expect(res.rows.find((r) => r.branch === "พระราม 2")!.area).toBe("เขต 13");
    expect(res.areaDifferences).toEqual([
      { month: "2026-09", branch: "พระราม 2", fileArea: "เขต 1", currentArea: "เขต 13" },
    ]);
  });

  it("ส่งผ่าน assembleDashboardSources + buildDashboardData ได้ตัวเลขเดิมทุกช่อง (ทางอ่านจริงของ sync)", () => {
    const data = fakeData(KEYS);
    const res = convertLegacyDashboardData(data, { goLiveMonth: GO_LIVE });
    const sources = assembleDashboardSources({
      goLiveMonth: GO_LIVE,
      lastMonth: "2026-09",
      snapshots: res.rows,
      closedCentralMonths: new Set(),
      registry: { contracts: [], visits: [], rules: [] },
    });
    const out = buildDashboardData(sources, { goLiveMonth: GO_LIVE });
    for (const key of ["JUL.26", "AUG.26", "SEP.26"]) {
      expect(out[key]).toEqual(data[key]);
    }
    // OCT.26 ในไฟล์ไม่ถูกนำเข้า → ยังไม่ถึงเดือน go-live ที่จบแล้ว จึงไม่มีในผลลัพธ์
    expect(Object.keys(out)).toEqual(["JUL.26", "AUG.26", "SEP.26"]);
  });

  describe("ข้อมูลผิด = throw (ไม่นำเข้าบางส่วน)", () => {
    const conv = (d: DashboardData) => convertLegacyDashboardData(d, { goLiveMonth: GO_LIVE });

    it("ชื่อสาขาสะกดไม่ตรง", () => {
      const d = fakeData(["SEP.26"]);
      d["SEP.26"]![0]!.branch = "พุทธมณฑล ";
      expect(() => conv(d)).toThrow(/ไม่อยู่ในรายชื่อ 43 สาขา/);
    });
    it("ขาดสาขา", () => {
      const d = fakeData(["SEP.26"]);
      d["SEP.26"]!.pop();
      expect(() => conv(d)).toThrow(/ขาด/);
    });
    it("สาขาซ้ำ", () => {
      const d = fakeData(["SEP.26"]);
      d["SEP.26"]![1] = { ...d["SEP.26"]![0]! };
      expect(() => conv(d)).toThrow(/ซ้ำ/);
    });
    it("จำนวนไม่ใช่จำนวนเต็ม", () => {
      const d = fakeData(["SEP.26"]);
      d["SEP.26"]![0]!.s1 = 1.5;
      expect(() => conv(d)).toThrow(/จำนวนเต็ม/);
    });
    it("cust ไม่เท่าผลรวม 8 tier", () => {
      const d = fakeData(["SEP.26"]);
      d["SEP.26"]![0]!.cust += 1;
      expect(() => conv(d)).toThrow(/cust/);
    });
    it("value ไม่เท่า vS+vM+vL+vXL", () => {
      const d = fakeData(["SEP.26"]);
      d["SEP.26"]![0]!.value += 1;
      expect(() => conv(d)).toThrow(/value/);
    });
    it("ช่องหาย / ชนิดผิด", () => {
      const d = fakeData(["SEP.26"]);
      (d["SEP.26"]![0] as unknown as Record<string, unknown>).vXL = "0";
      expect(() => conv(d)).toThrow(/vXL/);
    });
    it("เดือนขาดหาย (ไม่ต่อเนื่อง)", () => {
      expect(() => conv(fakeData(["JUL.26", "SEP.26"]))).toThrow(/2026-08/);
    });
    it("ไม่มีเดือนก่อน go-live พอดี (SEP.26)", () => {
      expect(() => conv(fakeData(["JUL.26", "AUG.26"]))).toThrow(/2026-09/);
    });
    it("key เดือนผิดรูปแบบ", () => {
      expect(() => conv({ "2026-09": fakeData(["SEP.26"])["SEP.26"]! })).toThrow();
    });
    it("goLiveMonth ผิดรูปแบบ", () => {
      expect(() =>
        convertLegacyDashboardData(fakeData(["SEP.26"]), { goLiveMonth: "OCT.26" }),
      ).toThrow();
    });
    it("ไม่ใช่ object", () => {
      expect(() => convertLegacyDashboardData([], { goLiveMonth: GO_LIVE })).toThrow();
    });
  });
});

describe("legacyTotalsByMonth", () => {
  it("รวมยอดต่อเดือนเป็นสตางค์ (ไม่มีเศษ float)", () => {
    const res = convertLegacyDashboardData(fakeData(["SEP.26"]), { goLiveMonth: GO_LIVE });
    const [t] = legacyTotalsByMonth(res.rows);
    const expectCust = BRANCHES.reduce((s, _, i) => s + i + 2, 0);
    const expectCents = BRANCHES.reduce((s, _, i) => s + 100025 * (i + 1) + 50050, 0);
    expect(t).toEqual({ month: "2026-09", rows: 43, cust: expectCust, valueCents: expectCents });
  });
});

describe("toSnapshotInsertRows", () => {
  const ids = new Map(BRANCHES.map((b, i) => [b.branch, `id-${i}`]));

  it("แปลงเป็นคอลัมน์ของตาราง · ไม่ส่ง v_s1…v_xl3 / value_annual / report_* (ใช้ค่า default ของ DB)", () => {
    const res = convertLegacyDashboardData(fakeData(["SEP.26"]), { goLiveMonth: GO_LIVE });
    const rows = toSnapshotInsertRows(res.rows, ids);
    expect(rows).toHaveLength(43);
    expect(Object.keys(rows[0]!)).toEqual([
      "month_key", "branch_id", "source",
      "s1", "s3", "m1", "m3", "l1", "l3", "xl1", "xl3",
      "cust", "vS", "vM", "vL", "vXL", "value",
    ]);
    expect(rows[0]).toMatchObject({ month_key: "2026-09", branch_id: "id-0", source: "legacy" });
  });

  it("ไม่มี id ของสาขา = throw", () => {
    const res = convertLegacyDashboardData(fakeData(["SEP.26"]), { goLiveMonth: GO_LIVE });
    const partial = new Map([...ids].slice(1));
    expect(() => toSnapshotInsertRows(res.rows, partial)).toThrow(/ไม่พบ id/);
  });
});
