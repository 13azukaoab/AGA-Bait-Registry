/**
 * ตรรกะ pure ของ "เรียงตารางรายชื่อทีม" (หน้าตั้งค่า แท็บทีม) — แพทเทิร์นเดียวกับ `components/admin/userSort.ts`
 *
 * Logic summary:
 *   * เรียงได้ 7 คอลัมน์: ทีม(รหัส) · ชื่อ/คำอธิบาย · ประเภททีม · คนภาคสนาม · ชม./คน/เดือน · สัญญาที่ใช้งานอยู่ · ใช้งาน
 *   * ค่าเริ่มต้น = รหัสทีม A→Z
 *   * ทิศแรกเมื่อกดหัวคอลัมน์: ข้อความ = A→Z (ก→ฮ) · ตัวเลข = มาก→น้อย · ใช้งาน = เปิดก่อน
 *   * ค่าว่าง (แสดงเป็น "—") อยู่ท้ายเสมอทั้งสองทิศ:
 *       - คนภาคสนาม 0 = ยังไม่ระบุ · สัญญาที่ใช้งานอยู่ null = อ่านไม่ได้ · ชื่อว่าง
 *       - ชม./คน/เดือน ใช้ค่าที่ตั้งเฉพาะทีม ถ้าไม่ตั้งใช้ค่าที่ใช้จริง (ค่ากลาง) ที่ DB คำนวณ · ไม่มีทั้งคู่ = ว่าง
 *   * ข้อความไทยเรียงด้วย localeCompare(…, "th") · ตัวเลขเรียงเป็นตัวเลข · ค่าเท่ากัน → เรียงตามรหัสทีม (ทิศขึ้นเสมอ)
 */
import { TEAM_KIND_LABEL } from "@/lib/service/teamKind";

import type { TeamRow } from "./settingsLogic";

export type TeamSortKey = "code" | "name" | "kind" | "headcount" | "workload" | "contracts" | "active";
export type TeamSortDir = "asc" | "desc";
export type TeamSortState = { key: TeamSortKey; dir: TeamSortDir };

export type TeamSortColumn = {
  key: TeamSortKey;
  label: string;
  /** ทิศที่ได้เมื่อกดหัวคอลัมน์ครั้งแรก */
  first: TeamSortDir;
  ascLabel: string;
  descLabel: string;
};

export const TEAM_SORT_COLUMNS: readonly TeamSortColumn[] = [
  { key: "code", label: "ทีม", first: "asc", ascLabel: "A → Z", descLabel: "Z → A" },
  { key: "name", label: "ชื่อ / คำอธิบาย", first: "asc", ascLabel: "ก → ฮ", descLabel: "ฮ → ก" },
  { key: "kind", label: "ประเภททีม", first: "asc", ascLabel: "ก → ฮ", descLabel: "ฮ → ก" },
  { key: "headcount", label: "คนภาคสนาม", first: "desc", ascLabel: "น้อย → มาก", descLabel: "มาก → น้อย" },
  { key: "workload", label: "ชม./คน/เดือน", first: "desc", ascLabel: "น้อย → มาก", descLabel: "มาก → น้อย" },
  { key: "contracts", label: "สัญญาที่ใช้งานอยู่", first: "desc", ascLabel: "น้อย → มาก", descLabel: "มาก → น้อย" },
  { key: "active", label: "ใช้งาน", first: "asc", ascLabel: "เปิดก่อน", descLabel: "ปิดก่อน" },
];

export const DEFAULT_TEAM_SORT: TeamSortState = { key: "code", dir: "asc" };

const FALLBACK_COLUMN: TeamSortColumn = { key: "code", label: "ทีม", first: "asc", ascLabel: "A → Z", descLabel: "Z → A" };

export function teamColumnOf(key: TeamSortKey): TeamSortColumn {
  return TEAM_SORT_COLUMNS.find((c) => c.key === key) ?? FALLBACK_COLUMN;
}

/** กดหัวคอลัมน์: คอลัมน์เดิม = สลับทิศ · คอลัมน์ใหม่ = ทิศแรกของคอลัมน์นั้น */
export function nextTeamSort(current: TeamSortState, key: TeamSortKey): TeamSortState {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: teamColumnOf(key).first };
}

/** ข้อความประกาศให้ screen reader หลังเรียง */
export function teamSortAnnouncement(s: TeamSortState): string {
  const c = teamColumnOf(s.key);
  return `เรียงตาม ${c.label} · ${s.dir === "asc" ? c.ascLabel : c.descLabel}`;
}

type SortableTeam = Pick<
  TeamRow,
  "code" | "name" | "kind" | "isActive" | "headcount" | "activeContracts" | "workloadHours" | "effectiveWorkloadHours"
>;

/** ค่าที่ใช้เทียบของคอลัมน์ · null = ว่าง (อยู่ท้ายเสมอ) */
function valueOf(t: SortableTeam, key: TeamSortKey): string | number | null {
  switch (key) {
    case "code":
      return t.code.trim() === "" ? null : t.code;
    case "name":
      return t.name.trim() === "" ? null : t.name;
    case "kind":
      return TEAM_KIND_LABEL[t.kind];
    case "headcount":
      return t.headcount > 0 ? t.headcount : null;
    case "workload":
      return t.workloadHours ?? t.effectiveWorkloadHours;
    case "contracts":
      return t.activeContracts;
    case "active":
      return t.isActive ? 0 : 1;
  }
}

function textCompare(a: string, b: string): number {
  return a.localeCompare(b, "th");
}

/** เรียงสำเนาของรายการทีม (ไม่แก้ array เดิม) */
export function sortTeams<T extends SortableTeam>(teams: readonly T[], sort: TeamSortState): T[] {
  const m = sort.dir === "asc" ? 1 : -1;
  return teams.slice().sort((a, b) => {
    const va = valueOf(a, sort.key);
    const vb = valueOf(b, sort.key);
    if (va === null && vb !== null) return 1; // ว่างท้ายเสมอ ไม่กลับตามทิศ
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null) {
      const c =
        typeof va === "number" && typeof vb === "number" ? (va < vb ? -1 : va > vb ? 1 : 0) : textCompare(String(va), String(vb));
      if (c !== 0) return c * m;
    }
    return textCompare(a.code, b.code);
  });
}
