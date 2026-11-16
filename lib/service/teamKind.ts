/**
 * ประเภททีม (`teams.kind` — M22) — pure function ใช้ร่วมกันระหว่างหน้า /customers/new และ /service
 *
 * Logic summary:
 *   * ประเภททีมมี 3 แบบ: `service` ทีมบริการ · `install` ทีมติดตั้ง · `supervisor` ทีมหัวหน้างาน
 *     (ฐานข้อมูลบังคับด้วย CHECK · ทีมใหม่จากหน้าตั้งค่าต้องเลือกประเภทเสมอ)
 *   * ห้ามเดาประเภทจากรหัสทีม (เดิมเขียน A–O = บริการ, Z = ติดตั้ง ตายตัว) — ทีมใหม่เช่น P ใช้งานได้ทันทีตาม kind
 *   * หน้ากรอกบริการ (/service) เลือกได้เฉพาะ `service` + `install` (ตรงด่าน SV006 ใน `save_service_visit`)
 *   * ลำดับแสดง: บริการ → ติดตั้ง → หัวหน้างาน แล้วเรียงตามรหัสทีม
 *   * M26/M33 — ทีมที่ "เลือกเพิ่มให้งานใหม่ได้" ต้องเปิดใช้งาน (`teams.is_active`) และไม่ใช่หัวหน้างาน (สัญญา) /
 *     เป็นบริการหรือติดตั้ง (การเข้าบริการ) · DB ปฏิเสธด้วย TM004 (ทีมปิด) / TM005 (หัวหน้างาน) เฉพาะทีมที่ "เพิ่มใหม่"
 *     งานเก่าที่มีทีมปิด/Sup อยู่แล้วต้องยังแสดงชื่อ และส่งชุดเดิมกลับได้ → `teamsForPicker` คงทีมเดิมไว้ในรายการ
 *     (ติ๊กออกได้ แต่ติ๊กกลับเข้าไม่ได้) · ค่าตั้งต้นของงานใหม่ (เช่น ทีมครั้งก่อน) กรองด้วย `assignableTeamIds`
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


/** ข้อมูลทีมที่ใช้ตัดสินว่าเลือกให้งานใหม่ได้ไหม (`is_active` + `kind`) */
export interface TeamAvailability {
  kind: TeamKind;
  isActive: boolean;
}

/** ทีมที่ผูกกับ "สัญญา" ใหม่ได้ = เปิดใช้งาน และไม่ใช่หัวหน้างาน (ตรง TM004/TM005 ของ `save_job_opening`) */
export function isTeamAssignableToContract(team: TeamAvailability): boolean {
  return team.isActive && team.kind !== "supervisor";
}

/** ทีมที่ผูกกับ "การเข้าบริการ" ใหม่ได้ = เปิดใช้งาน และเป็นบริการ/ติดตั้ง (ตรง TM004 + SV006 ของ `save_service_visit`) */
export function isTeamAssignableToVisit(team: TeamAvailability): boolean {
  return team.isActive && canRecordService(team.kind);
}

/**
 * รายการทีมที่โชว์ในตัวเลือก = ทีมที่เลือกเพิ่มได้ + ทีมที่ถูกเลือกอยู่แล้ว (ทีมเดิมของงานเก่าที่ปิด/Sup)
 * — ทีมเดิมต้องไม่หายไปเงียบๆ · ผู้ใช้ติ๊กออกได้ แต่พอติ๊กออกแล้วจะไม่ขึ้นให้ติ๊กกลับ (เพิ่มทีมแบบนี้ใหม่ไม่ได้)
 */
export function teamsForPicker<T extends TeamAvailability & { id: string }>(
  teams: readonly T[],
  value: readonly string[],
  isAssignable: (team: TeamAvailability) => boolean,
): T[] {
  return teams.filter((t) => isAssignable(t) || value.includes(t.id));
}

/** คำอธิบายสั้นๆ ของทีมที่เลือกเพิ่มไม่ได้ (ใช้ติดท้ายรหัสทีมในตัวเลือก) · เลือกได้ปกติ = null */
export function teamUnavailableNote(team: TeamAvailability): string | null {
  if (!team.isActive) return "ปิดใช้งาน";
  if (team.kind === "supervisor") return "หัวหน้างาน";
  return null;
}

/**
 * กรอง id ทีมให้เหลือเฉพาะที่เลือกให้งาน "ใหม่" ได้ — ใช้กับค่าตั้งต้นที่หยิบจากงานเก่า (เช่น ทีมของการเข้าครั้งก่อน)
 * กันส่งทีมปิด/Sup เข้าไปเป็นทีมที่ "เพิ่มใหม่" แล้วโดน TM004/TM005 โดยผู้ใช้ไม่ได้ทำผิด · id ที่ไม่รู้จักถูกตัดทิ้ง
 */
export function assignableTeamIds<T extends TeamAvailability & { id: string }>(
  ids: readonly string[],
  teams: readonly T[],
  isAssignable: (team: TeamAvailability) => boolean,
): string[] {
  const ok = new Set(teams.filter(isAssignable).map((t) => t.id));
  return ids.filter((id) => ok.has(id));
}
