import { describe, expect, it } from "vitest";

import type { TierRule } from "../rules/types";
import { BRANCHES } from "./branches";
import { buildDashboardData } from "./buildDashboardData";
import { DashboardSyncError } from "./errors";
import {
  assembleDashboardSources,
  bangkokMonth,
  computeCentralRows,
  monthRange,
  previousMonth,
  type AssembleInput,
  type BranchContract,
  type StoredSnapshotRow,
} from "./sources";

// ข้อมูลสมมติทั้งหมด
const RULES: TierRule[] = [
  { tier: "S", minAnnual: 0 },
  { tier: "M", minAnnual: 30000 },
  { tier: "L", minAnnual: 50000 },
  { tier: "XL", minAnnual: 100000 },
];

const CENTRAL = BRANCHES.filter((b) => b.division === "central");

function stored(month: string, branch: string, source: StoredSnapshotRow["source"], value: number): StoredSnapshotRow {
  return {
    month, source, area: "", branch,
    s1: 1, s3: 0, m1: 0, m3: 0, l1: 0, l3: 0, xl1: 0, xl3: 0,
    cust: 1, vS: value, vM: 0, vL: 0, vXL: 0, value,
  };
}

const legacySep = stored("2026-09", "พุทธมณฑล", "legacy", 111);

function contract(id: string, branch: string, start: string, value: number, term = 12): BranchContract {
  return { id, branch, startDate: start, termMonths: term, valueTotal: value };
}

function input(over: Partial<AssembleInput> = {}): AssembleInput {
  return {
    goLiveMonth: "2026-10",
    lastMonth: "2026-10",
    snapshots: [legacySep],
    closedCentralMonths: new Set(),
    registry: { contracts: [], visits: [], rules: RULES },
    ...over,
  };
}

describe("ตัวช่วยเดือน", () => {
  it("bangkokMonth ใช้เวลาไทย (31 ต.ค. 18:00 UTC = 1 พ.ย. ไทย)", () => {
    expect(bangkokMonth(new Date("2026-10-31T18:00:00Z"))).toBe("2026-11");
    expect(bangkokMonth(new Date("2026-10-31T16:00:00Z"))).toBe("2026-10");
  });
  it("previousMonth ข้ามปีได้", () => {
    expect(previousMonth("2027-01")).toBe("2026-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
  });
  it("monthRange รวม 2 ฝั่ง · ปลายก่อนต้น = ว่าง", () => {
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthRange("2026-10", "2026-09")).toEqual([]);
  });
});

describe("computeCentralRows — คำนวณสดเดือนที่ยังไม่ปิด", () => {
  it("ครบ 24 สาขาส่วนกลาง · นับตามสาขาของลูกค้า · ไม่นับต่างจังหวัด", () => {
    const rows = computeCentralRows(
      {
        contracts: [
          contract("c1", "นครปฐม", "2026-01-15", 50000, 36), // 50,000 / 3 ปี → S3
          contract("c2", "นครปฐม", "2026-10-01", 150000), // XL1
          contract("c3", "เชียงใหม่", "2026-01-01", 10000), // ต่างจังหวัด → ไม่นับ
        ],
        visits: [],
        rules: RULES,
      },
      "2026-10",
    );
    expect(rows).toHaveLength(CENTRAL.length);
    const np = rows.find((r) => r.branch === "นครปฐม")!;
    expect(np).toMatchObject({ s3: 1, xl1: 1, cust: 2, vS: 50000, vXL: 150000, value: 200000 });
    expect(rows.some((r) => r.branch === "เชียงใหม่")).toBe(false);
    expect(Object.keys(np)).toHaveLength(16);
  });

  it("ค่าเงินปัด 2 ตำแหน่ง (ไม่มีเศษ float ทำให้ 'ข้าม' พัง)", () => {
    const rows = computeCentralRows(
      {
        contracts: [
          contract("a", "สาทร", "2026-10-01", 0.1),
          contract("b", "สาทร", "2026-10-01", 0.2),
        ],
        visits: [],
        rules: RULES,
      },
      "2026-10",
    );
    expect(rows.find((r) => r.branch === "สาทร")!.value).toBe(0.3);
  });
});

describe("assembleDashboardSources", () => {
  it("ไม่มี legacy เลย = legacy_missing (กันทับประวัติบน Dashboard)", () => {
    expect(() => assembleDashboardSources(input({ snapshots: [] }))).toThrow(DashboardSyncError);
    try {
      assembleDashboardSources(input({ snapshots: [] }));
    } catch (e) {
      expect((e as DashboardSyncError).code).toBe("legacy_missing");
    }
  });

  it("เดือนยังไม่ปิด = คำนวณสด (ไม่ใช้แถว computed ที่เก็บไว้)", () => {
    const src = assembleDashboardSources(
      input({
        snapshots: [legacySep, stored("2026-10", "นครปฐม", "computed", 999)],
        registry: { contracts: [contract("c1", "นครปฐม", "2026-10-01", 20000)], visits: [], rules: RULES },
      }),
    );
    const np = src.computed?.["2026-10"]?.find((r) => r.branch === "นครปฐม");
    expect(np?.value).toBe(20000);
  });

  it("เดือนที่ปิดแล้ว = ใช้ snapshot เดิม ไม่คำนวณใหม่ (กฎ 7)", () => {
    const closedRows = CENTRAL.map((b) => stored("2026-10", b.branch, "computed", 7));
    const src = assembleDashboardSources(
      input({
        snapshots: [legacySep, ...closedRows],
        closedCentralMonths: new Set(["2026-10"]),
        // ทะเบียนเปลี่ยนแล้ว (แก้หลังปิด) แต่ต้องไม่กระทบเดือนที่ปิด
        registry: { contracts: [contract("c1", "นครปฐม", "2026-10-01", 20000)], visits: [], rules: RULES },
      }),
    );
    const rows = src.computed?.["2026-10"] ?? [];
    expect(rows).toHaveLength(CENTRAL.length);
    expect(rows.every((r) => r.value === 7)).toBe(true);
  });

  it("เดือนที่ปิดแล้วแต่ snapshot ขาดบางสาขา = closed_snapshot_missing (ไม่เติมศูนย์ ไม่คำนวณใหม่)", () => {
    const partial = CENTRAL.slice(1).map((b) => stored("2026-10", b.branch, "computed", 7));
    expect(() =>
      assembleDashboardSources(
        input({ snapshots: [legacySep, ...partial], closedCentralMonths: new Set(["2026-10"]) }),
      ),
    ).toThrow(/ขาด 1 สาขา/);
  });

  it("ช่วงเดือน: legacy ก่อน go-live · computed/manual go-live … เดือนล่าสุดที่จบแล้ว", () => {
    const src = assembleDashboardSources(
      input({
        lastMonth: "2026-11",
        snapshots: [
          legacySep,
          stored("2026-10", "พุทธมณฑล", "legacy", 1), // legacy หลัง go-live → ตัดทิ้ง
          stored("2026-10", "เชียงใหม่", "manual", 300),
          stored("2026-12", "เชียงใหม่", "manual", 400), // หลังเดือนล่าสุด → ไม่ส่ง
        ],
      }),
    );
    expect(Object.keys(src.legacy ?? {})).toEqual(["2026-09"]);
    expect(Object.keys(src.computed ?? {})).toEqual(["2026-10", "2026-11"]);
    expect(Object.keys(src.manual ?? {})).toEqual(["2026-10"]);
  });

  it("ประกอบต่อด้วย buildDashboardData ได้ไฟล์ครบ 43 สาขาทุกเดือน", () => {
    const src = assembleDashboardSources(input());
    const data = buildDashboardData(src, { goLiveMonth: "2026-10" });
    expect(Object.keys(data)).toEqual(["SEP.26", "OCT.26"]);
    expect(data["OCT.26"]).toHaveLength(43);
  });

  it("go-live ยังไม่ถึง (เดือนล่าสุด < go-live) = ไม่มีเดือน computed", () => {
    const src = assembleDashboardSources(input({ lastMonth: "2026-09" }));
    expect(src.computed).toEqual({});
  });

  it("เดือนผิดรูปแบบ = load_failed", () => {
    expect(() => assembleDashboardSources(input({ goLiveMonth: "2026-10-01" }))).toThrow(/รูปแบบ/);
  });
});
