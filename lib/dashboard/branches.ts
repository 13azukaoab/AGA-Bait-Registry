import type { BranchRef } from "../rules/types";

export type Division = "central" | "province";

/** สาขาพร้อมหน่วยงาน (division ผูกที่ระดับสาขา — SPEC §4, เขต 9 คร่อม 2 หน่วยงาน) */
export interface Branch extends BranchRef {
  division: Division;
}

/**
 * รายชื่อสาขาทั้งหมดตาม SPEC §4 — เรียงตามเขต (ลำดับนี้ใช้จัดลำดับแถวใน dashboard_data.json ด้วย)
 * central 24 สาขา · province 19 สาขา · รวม 43
 * **ชื่อสาขาต้องสะกดตรงกับ Dashboard ทุกตัวอักษร** เพราะ Dashboard ใช้ชื่อเป็น key (SPEC §4, CLAUDE.md กฎ 4)
 */
export const BRANCHES: readonly Branch[] = [
  // เขต 1
  { area: "เขต 1", branch: "พุทธมณฑล", division: "central" },
  { area: "เขต 1", branch: "นครปฐม", division: "central" },
  { area: "เขต 1", branch: "หัวหิน", division: "central" },
  // เขต 2
  { area: "เขต 2", branch: "สาทร", division: "central" },
  { area: "เขต 2", branch: "ปทุมวัน", division: "central" },
  { area: "เขต 2", branch: "พระราม 4", division: "central" },
  { area: "เขต 2", branch: "นนทบุรี", division: "central" },
  // เขต 3
  { area: "เขต 3", branch: "ปทุมธานี", division: "central" },
  { area: "เขต 3", branch: "รามอินทรา", division: "central" },
  { area: "เขต 3", branch: "อยุธยา", division: "central" },
  // เขต 4
  { area: "เขต 4", branch: "ลาดพร้าว", division: "central" },
  { area: "เขต 4", branch: "พัฒนาการ", division: "central" },
  { area: "เขต 4", branch: "สุวินทวงศ์", division: "central" },
  { area: "เขต 4", branch: "ประชาชื่น", division: "central" },
  // เขต 5
  { area: "เขต 5", branch: "สมุทรปราการ", division: "central" },
  { area: "เขต 5", branch: "พัทยา", division: "central" },
  { area: "เขต 5", branch: "ระยอง", division: "central" },
  // เขต 6
  { area: "เขต 6", branch: "สุขุมวิท", division: "central" },
  { area: "เขต 6", branch: "ปากน้ำ", division: "central" },
  { area: "เขต 6", branch: "ชลบุรี", division: "central" },
  // เขต 7
  { area: "เขต 7", branch: "เชียงราย", division: "province" },
  { area: "เขต 7", branch: "เชียงใหม่", division: "province" },
  { area: "เขต 7", branch: "ตาก", division: "province" },
  { area: "เขต 7", branch: "พิษณุโลก", division: "province" },
  // เขต 8
  { area: "เขต 8", branch: "โคราช", division: "province" },
  { area: "เขต 8", branch: "ขอนแก่น", division: "province" },
  { area: "เขต 8", branch: "อุดรธานี", division: "province" },
  { area: "เขต 8", branch: "อุบลราชธานี", division: "province" },
  // เขต 9 — คร่อม 2 หน่วยงาน
  { area: "เขต 9", branch: "ปากช่อง", division: "central" },
  { area: "เขต 9", branch: "สระบุรี", division: "central" },
  { area: "เขต 9", branch: "ลพบุรี", division: "province" },
  // เขต 10
  { area: "เขต 10", branch: "สุราษฎร์ธานี", division: "province" },
  { area: "เขต 10", branch: "เกาะสมุย", division: "province" },
  { area: "เขต 10", branch: "พังงา", division: "province" },
  // เขต 11
  { area: "เขต 11", branch: "กระบี่", division: "province" },
  { area: "เขต 11", branch: "ภูเก็ต", division: "province" },
  { area: "เขต 11", branch: "หาดใหญ่", division: "province" },
  // เขต 12
  { area: "เขต 12", branch: "ระนอง", division: "province" },
  { area: "เขต 12", branch: "นครศรีธรรมราช", division: "province" },
  { area: "เขต 12", branch: "ตรัง", division: "province" },
  { area: "เขต 12", branch: "ชุมพร", division: "province" },
  // เขต 13
  { area: "เขต 13", branch: "พระราม 2", division: "central" },
  { area: "เขต 13", branch: "ปราจีนบุรี", division: "central" },
] as const;

/** จำนวนสาขาทั้งหมดที่ Dashboard ต้องมีครบทุกเดือน (SPEC §9.1) */
export const BRANCH_COUNT = BRANCHES.length; // = 43

/** เซ็ตชื่อสาขาที่ถูกต้อง (ใช้ตรวจการสะกด) */
export const BRANCH_NAMES: ReadonlySet<string> = new Set(
  BRANCHES.map((b) => b.branch),
);
