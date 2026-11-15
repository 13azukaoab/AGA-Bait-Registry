/**
 * ประเภททีม (`teams.kind` — M22) — pure function ใช้ร่วมกันระหว่างหน้า /customers/new และ /service
 *
 * Logic summary:
 *   * ประเภททีมมี 3 แบบ: `service` ทีมบริการ · `install` ทีมติดตั้ง · `supervisor` ทีมหัวหน้างาน
 *     (ฐานข้อมูลบังคับด้วย CHECK · ทีมใหม่จากหน้าตั้งค่าต้องเลือกประเภทเสมอ)
 *   * ห้ามเดาประเภทจากรหัสทีม (เดิมเขียน A–O = บริการ, Z = ติดตั้ง ตายตัว) — ทีมใหม่เช่น P ใช้งานได้ทันทีตาม kind
 *   * หน้ากรอกบริการ (/service) เลือกได้เฉพาะ `service` + `install` (ตรงด่าน SV006 ใน `save_service_visit`)
 *   * ลำดับแสดง: บริการ → ติดตั้ง → หัวหน้างาน แล้วเรียงตามรหัสทีม
 */

export type TeamKind = "service" | "install" | "supervisor";

export const TEAM_KINDS: readonly TeamKind[] = ["service", "install", "supervisor"];

/** ชื่อไทยของประเภททีม */
export const TEAM_KIND_LABEL: Record<TeamKind, string> = {
  service: "ทีมบริการ",
  install: "ทีมติดตั้ง",
  supervisor: "ทีมหัวหน้างาน",
};

export function isTeamKind(value: unknown): value is TeamKind {
  return typeof value === "string" && (TEAM_KINDS as readonly string[]).includes(value);
}

/** ประเภททีมที่บันทึกการเข้าบริการได้ (ตรงกับ SV006 ฝั่ง DB: `kind IN ('service','install')`) */
export function canRecordService(kind: TeamKind): boolean {
  return kind === "service" || kind === "install";
}

/** ลำดับของประเภทเวลาแสดงรายการ (น้อย = ขึ้นก่อน) */
export function teamKindRank(kind: TeamKind): number {
  return TEAM_KINDS.indexOf(kind);
}

/** เรียงทีมตามประเภท แล้วตามรหัส (ไม่แก้อาร์เรย์เดิม) */
export function sortTeamsByKind<T extends { code: string; kind: TeamKind }>(teams: readonly T[]): T[] {
  return [...teams].sort(
    (a, b) => teamKindRank(a.kind) - teamKindRank(b.kind) || a.code.localeCompare(b.code),
  );
}

/**
 * ข้อความบอกว่ามีทีมอะไรบ้างในแต่ละประเภท เช่น "ทีมบริการ A, B · ทีมติดตั้ง Z"
 * (ข้ามประเภทที่ไม่มีทีม · ว่างทั้งหมด = สตริงว่าง)
 */
export function describeTeamsByKind(teams: readonly { code: string; kind: TeamKind }[]): string {
  const sorted = sortTeamsByKind(teams);
  return TEAM_KINDS.map((kind) => {
    const codes = sorted.filter((t) => t.kind === kind).map((t) => t.code);
    return codes.length > 0 ? `${TEAM_KIND_LABEL[kind]} ${codes.join(", ")}` : null;
  })
    .filter((s): s is string => s !== null)
    .join(" · ");
}
