import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEAM_SORT,
  TEAM_SORT_COLUMNS,
  nextTeamSort,
  sortTeams,
  teamSortAnnouncement,
  type TeamSortKey,
} from "./teamSort";
import type { TeamRow } from "./settingsLogic";

// ข้อมูลสมมติทั้งหมด (ไม่ใช่ทีมจริง)
function team(o: Partial<TeamRow> & { code: string }): TeamRow {
  return {
    id: `id-${o.code}`,
    name: "ทีมทดสอบ",
    kind: "service",
    isSystem: false,
    isActive: true,
    headcount: 2,
    activeContracts: 10,
    workloadHours: null,
    effectiveWorkloadHours: 40,
    ...o,
  };
}

const codes = (rows: TeamRow[]) => rows.map((t) => t.code);
const sort = (rows: TeamRow[], key: TeamSortKey, dir: "asc" | "desc") => codes(sortTeams(rows, { key, dir }));

describe("sortTeams", () => {
  it("ค่าเริ่มต้น = รหัสทีม A→Z", () => {
    const rows = [team({ code: "C" }), team({ code: "A" }), team({ code: "B" })];
    expect(codes(sortTeams(rows, DEFAULT_TEAM_SORT))).toEqual(["A", "B", "C"]);
  });

  it("ไม่แก้ array เดิม", () => {
    const rows = [team({ code: "B" }), team({ code: "A" })];
    sortTeams(rows, DEFAULT_TEAM_SORT);
    expect(codes(rows)).toEqual(["B", "A"]);
  });

  it("รหัสทีม สองทิศ", () => {
    const rows = [team({ code: "B" }), team({ code: "A" }), team({ code: "Z" })];
    expect(sort(rows, "code", "asc")).toEqual(["A", "B", "Z"]);
    expect(sort(rows, "code", "desc")).toEqual(["Z", "B", "A"]);
  });

  it("ชื่อ ภาษาไทย ก→ฮ / ฮ→ก", () => {
    const rows = [team({ code: "A", name: "สมุทร" }), team({ code: "B", name: "กรุงเทพ" }), team({ code: "C", name: "เชียงใหม่" })];
    expect(sort(rows, "name", "asc")).toEqual(["B", "C", "A"]);
    expect(sort(rows, "name", "desc")).toEqual(["A", "C", "B"]);
  });

  it("ประเภททีม เรียงตามชื่อไทยของประเภท (ติดตั้ง < บริการ < หัวหน้างาน) สองทิศ", () => {
    const rows = [
      team({ code: "A", kind: "supervisor" }),
      team({ code: "B", kind: "service" }),
      team({ code: "C", kind: "install" }),
    ];
    expect(sort(rows, "kind", "asc")).toEqual(["C", "B", "A"]);
    expect(sort(rows, "kind", "desc")).toEqual(["A", "B", "C"]);
  });

  it("คนภาคสนาม เรียงเป็นตัวเลข (10 มากกว่า 9) · 0 = ว่าง อยู่ท้ายทั้งสองทิศ", () => {
    const rows = [
      team({ code: "A", headcount: 9 }),
      team({ code: "B", headcount: 10 }),
      team({ code: "C", headcount: 0 }),
      team({ code: "D", headcount: 3 }),
    ];
    expect(sort(rows, "headcount", "desc")).toEqual(["B", "A", "D", "C"]);
    expect(sort(rows, "headcount", "asc")).toEqual(["D", "A", "B", "C"]);
  });

  it("ชม./คน/เดือน ใช้ค่าเฉพาะทีมก่อน ไม่มีใช้ค่าที่ใช้จริง · ไม่มีทั้งคู่ = ว่างท้ายเสมอ", () => {
    const rows = [
      team({ code: "A", workloadHours: 30, effectiveWorkloadHours: 30 }),
      team({ code: "B", workloadHours: null, effectiveWorkloadHours: 40 }),
      team({ code: "C", workloadHours: null, effectiveWorkloadHours: null }),
      team({ code: "D", workloadHours: 50, effectiveWorkloadHours: 50 }),
    ];
    expect(sort(rows, "workload", "desc")).toEqual(["D", "B", "A", "C"]);
    expect(sort(rows, "workload", "asc")).toEqual(["A", "B", "D", "C"]);
  });

  it("สัญญาที่ใช้งานอยู่ null (—) ท้ายเสมอ · 0 สัญญาไม่ใช่ว่าง", () => {
    const rows = [
      team({ code: "A", activeContracts: 5 }),
      team({ code: "B", activeContracts: null }),
      team({ code: "C", activeContracts: 0 }),
      team({ code: "D", activeContracts: 12 }),
    ];
    expect(sort(rows, "contracts", "desc")).toEqual(["D", "A", "C", "B"]);
    expect(sort(rows, "contracts", "asc")).toEqual(["C", "A", "D", "B"]);
  });

  it("ใช้งาน: เปิดก่อน / ปิดก่อน (ค่าเท่ากันเรียงตามรหัส)", () => {
    const rows = [team({ code: "A", isActive: false }), team({ code: "B" }), team({ code: "C", isActive: false }), team({ code: "D" })];
    expect(sort(rows, "active", "asc")).toEqual(["B", "D", "A", "C"]);
    expect(sort(rows, "active", "desc")).toEqual(["A", "C", "B", "D"]);
  });

  it("ค่าเท่ากัน → เรียงตามรหัสทีมเสมอ (ไม่กลับทิศตามที่เลือก)", () => {
    const rows = [team({ code: "C", headcount: 4 }), team({ code: "A", headcount: 4 }), team({ code: "B", headcount: 4 })];
    expect(sort(rows, "headcount", "asc")).toEqual(["A", "B", "C"]);
    expect(sort(rows, "headcount", "desc")).toEqual(["A", "B", "C"]);
  });

  it("ค่าว่างหลายแถว → เรียงกันเองตามรหัส", () => {
    const rows = [team({ code: "C", headcount: 0 }), team({ code: "A", headcount: 0 }), team({ code: "B", headcount: 2 })];
    expect(sort(rows, "headcount", "desc")).toEqual(["B", "A", "C"]);
    expect(sort(rows, "headcount", "asc")).toEqual(["B", "A", "C"]);
  });

  it("ชื่อว่าง ท้ายเสมอ", () => {
    const rows = [team({ code: "A", name: "" }), team({ code: "B", name: "ขขข" })];
    expect(sort(rows, "name", "asc")).toEqual(["B", "A"]);
    expect(sort(rows, "name", "desc")).toEqual(["B", "A"]);
  });
});

describe("nextTeamSort / ประกาศ", () => {
  it("คอลัมน์ใหม่เริ่มที่ทิศแรก: ข้อความ asc · ตัวเลข desc · ใช้งาน asc", () => {
    const from = DEFAULT_TEAM_SORT;
    expect(nextTeamSort(from, "name").dir).toBe("asc");
    expect(nextTeamSort(from, "kind").dir).toBe("asc");
    expect(nextTeamSort(from, "headcount").dir).toBe("desc");
    expect(nextTeamSort(from, "workload").dir).toBe("desc");
    expect(nextTeamSort(from, "contracts").dir).toBe("desc");
    expect(nextTeamSort(from, "active").dir).toBe("asc");
  });

  it("กดคอลัมน์เดิมซ้ำสลับทิศ", () => {
    const s1 = nextTeamSort(DEFAULT_TEAM_SORT, "code");
    expect(s1).toEqual({ key: "code", dir: "desc" });
    expect(nextTeamSort(s1, "code")).toEqual({ key: "code", dir: "asc" });
  });

  it("ประกาศข้อความตามคอลัมน์และทิศ · มีครบ 7 คอลัมน์", () => {
    expect(teamSortAnnouncement({ key: "active", dir: "asc" })).toBe("เรียงตาม ใช้งาน · เปิดก่อน");
    expect(teamSortAnnouncement({ key: "headcount", dir: "desc" })).toBe("เรียงตาม คนภาคสนาม · มาก → น้อย");
    expect(TEAM_SORT_COLUMNS).toHaveLength(7);
  });
});
