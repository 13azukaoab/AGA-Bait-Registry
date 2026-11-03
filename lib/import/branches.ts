import type { Division } from "./types";

/**
 * master สาขา → เขต → หน่วยงาน ตาม SPEC §4 (43 สาขา / 13 เขต)
 * แหล่งข้อมูลหลักคือ SPEC §4 ไม่ใช่โค้ด C1–C9 ใน mockup (ซึ่งมีแค่ 24 สาขาส่วนกลาง
 * และวาง "พระราม 2"/"ปราจีนบุรี" ผิดเขต) — ชื่อสาขาต้องสะกดตรงกับ Dashboard ทุกตัวอักษร
 */
export interface BranchInfo {
  name: string;
  zone: string; // 'เขต 1' .. 'เขต 13'
  division: Division;
}

export const BRANCHES: readonly BranchInfo[] = [
  // เขต 1
  { name: "พุทธมณฑล", zone: "เขต 1", division: "central" },
  { name: "นครปฐม", zone: "เขต 1", division: "central" },
  { name: "หัวหิน", zone: "เขต 1", division: "central" },
  // เขต 2
  { name: "สาทร", zone: "เขต 2", division: "central" },
  { name: "ปทุมวัน", zone: "เขต 2", division: "central" },
  { name: "พระราม 4", zone: "เขต 2", division: "central" },
  { name: "นนทบุรี", zone: "เขต 2", division: "central" },
  // เขต 3
  { name: "ปทุมธานี", zone: "เขต 3", division: "central" },
  { name: "รามอินทรา", zone: "เขต 3", division: "central" },
  { name: "อยุธยา", zone: "เขต 3", division: "central" },
  // เขต 4
  { name: "ลาดพร้าว", zone: "เขต 4", division: "central" },
  { name: "พัฒนาการ", zone: "เขต 4", division: "central" },
  { name: "สุวินทวงศ์", zone: "เขต 4", division: "central" },
  { name: "ประชาชื่น", zone: "เขต 4", division: "central" },
  // เขต 5
  { name: "สมุทรปราการ", zone: "เขต 5", division: "central" },
  { name: "พัทยา", zone: "เขต 5", division: "central" },
  { name: "ระยอง", zone: "เขต 5", division: "central" },
  // เขต 6
  { name: "สุขุมวิท", zone: "เขต 6", division: "central" },
  { name: "ปากน้ำ", zone: "เขต 6", division: "central" },
  { name: "ชลบุรี", zone: "เขต 6", division: "central" },
  // เขต 7
  { name: "เชียงราย", zone: "เขต 7", division: "province" },
  { name: "เชียงใหม่", zone: "เขต 7", division: "province" },
  { name: "ตาก", zone: "เขต 7", division: "province" },
  { name: "พิษณุโลก", zone: "เขต 7", division: "province" },
  // เขต 8
  { name: "โคราช", zone: "เขต 8", division: "province" },
  { name: "ขอนแก่น", zone: "เขต 8", division: "province" },
  { name: "อุดรธานี", zone: "เขต 8", division: "province" },
  { name: "อุบลราชธานี", zone: "เขต 8", division: "province" },
  // เขต 9 (ผูกหน่วยงานที่ระดับสาขา — ปากช่อง/สระบุรี central, ลพบุรี province)
  { name: "ปากช่อง", zone: "เขต 9", division: "central" },
  { name: "สระบุรี", zone: "เขต 9", division: "central" },
  { name: "ลพบุรี", zone: "เขต 9", division: "province" },
  // เขต 10
  { name: "สุราษฎร์ธานี", zone: "เขต 10", division: "province" },
  { name: "เกาะสมุย", zone: "เขต 10", division: "province" },
  { name: "พังงา", zone: "เขต 10", division: "province" },
  // เขต 11
  { name: "กระบี่", zone: "เขต 11", division: "province" },
  { name: "ภูเก็ต", zone: "เขต 11", division: "province" },
  { name: "หาดใหญ่", zone: "เขต 11", division: "province" },
  // เขต 12
  { name: "ระนอง", zone: "เขต 12", division: "province" },
  { name: "นครศรีธรรมราช", zone: "เขต 12", division: "province" },
  { name: "ตรัง", zone: "เขต 12", division: "province" },
  { name: "ชุมพร", zone: "เขต 12", division: "province" },
  // เขต 13
  { name: "พระราม 2", zone: "เขต 13", division: "central" },
  { name: "ปราจีนบุรี", zone: "เขต 13", division: "central" },
];

/** คำที่ขึ้นต้นแบบนี้ = งานกรุ๊ป/ลูกค้านอกสาขา (ไม่มีเขต ไม่ถือว่าผิด) */
const GROUP_PREFIX = "งานกรุ๊ป";

/** แก้สะกดผิดที่รู้จัก (เก็บแบบ space-insensitive ที่ key) → ชื่อ canonical */
const KNOWN_ALIASES: Record<string, string> = {
  นนทบรี: "นนทบุรี", // ขาดสระ ุ (พบในไฟล์จริง)
};

/** ตัดช่องว่างทั้งหมดเพื่อเทียบแบบไม่สนช่องว่าง (พระราม2 = พระราม 2) */
function squash(s: string): string {
  return s.replace(/\s/g, "");
}

const BY_NAME = new Map(BRANCHES.map((b) => [b.name, b]));
const BY_SQUASHED = new Map(BRANCHES.map((b) => [squash(b.name), b]));

export interface BranchResult {
  branch: string | null;
  zone: string | null;
  division: Division | null;
  isGroup?: boolean;
  fix?: string;
  error?: string;
}

/**
 * ล้าง+ตรวจชื่อสาขา คำนวณเขต/หน่วยงานจากสาขา
 * - ตรงเป๊ะ → ไม่มี fix
 * - ต่างแค่ช่องว่าง / สะกดผิดที่รู้จัก → แก้ให้ พร้อมบอกว่าแก้อะไร
 * - ไม่รู้จัก / ว่าง → error (must-fix)
 */
export function normalizeBranch(raw: string): BranchResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { branch: null, zone: null, division: null, error: "ไม่มีสาขา" };
  }
  if (trimmed.startsWith(GROUP_PREFIX)) {
    return { branch: trimmed, zone: null, division: null, isGroup: true };
  }

  // 1) ตรงเป๊ะ
  const exact = BY_NAME.get(trimmed);
  if (exact) {
    return { branch: exact.name, zone: exact.zone, division: exact.division };
  }

  // 2) สะกดผิดที่รู้จัก
  const aliased = KNOWN_ALIASES[trimmed] ?? KNOWN_ALIASES[squash(trimmed)];
  if (aliased) {
    const info = BY_NAME.get(aliased)!;
    return {
      branch: info.name,
      zone: info.zone,
      division: info.division,
      fix: `สาขา "${trimmed}" → ${info.name}`,
    };
  }

  // 3) ต่างแค่ช่องว่าง
  const squashed = BY_SQUASHED.get(squash(trimmed));
  if (squashed) {
    return {
      branch: squashed.name,
      zone: squashed.zone,
      division: squashed.division,
      fix: `สาขา "${trimmed}" → ${squashed.name}`,
    };
  }

  // 4) ไม่รู้จัก
  return {
    branch: null,
    zone: null,
    division: null,
    error: `ไม่รู้จักสาขา "${trimmed}"`,
  };
}
