/**
 * ตรรกะ pure ของแท็บ "ประเภทลูกค้า" "ทีม" และเกณฑ์ Workload หน้าตั้งค่า — ไม่แตะ DB/React
 *
 * Logic summary:
 *   * ทีม: รหัสทีม (code) 1–4 ตัว a-z A-Z 0-9 · ไม่ซ้ำแบบไม่สนตัวพิมพ์ (กัน `sup`/`Sup` — DB unique index ยังสนตัวพิมพ์
 *     จึงตรวจที่ client + server) · สร้างแล้วแก้รหัสไม่ได้ · ประเภททีมต้องเลือก (TEAM_KINDS) ·
 *     จำนวนคนภาคสนาม 0–99 (`teams.headcount`) · **0 = แสดง "—"** (ชม./คน หารศูนย์ไม่ได้ M25)
 *   * ทีมระบบ (is_system, ตอนนี้ Sup): ลบ/ปิดไม่ได้ · เปลี่ยนรหัส/ประเภทไม่ได้ (แก้ชื่อ/จำนวนคนได้)
 *   * ประเภทลูกค้า: โครงสร้างจริงมีแค่ code / label / group_label / sort_order (ยังไม่มี is_active / hint — ดูรายงาน)
 *     ชื่อไม่ซ้ำทั้งระบบ (ไม่สนเว้นวรรค/ตัวพิมพ์) · หมวด = group_label ที่เรียงตาม sort_order ต่ำสุดของสมาชิก
 *     · ลำดับใหม่ส่ง RPC `reorder_customer_types` เป็น "รหัสทุกตัวตามลำดับใหม่" ครั้งเดียว
 *   * Workload: ชม./คน/เดือน > 0 และ ≤ 300 ทศนิยมไม่เกิน 2 ตำแหน่ง (ตรง WL001)
 */
import { TEAM_KINDS, type TeamKind } from "@/lib/service/teamKind";

export const CONFIRM_PHRASE = "ยืนยันแก้ไข";

/** เทียบชื่อซ้ำ: ไม่สนช่องว่าง/ตัวพิมพ์ */
export function normName(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

export const WORKLOAD_MAX = 300;

export function validateWorkload(hours: number | null): string | null {
  if (hours === null) return "กรอกเป็นตัวเลข";
  if (hours <= 0 || hours > WORKLOAD_MAX) return `ต้องมากกว่า 0 และไม่เกิน ${WORKLOAD_MAX} ชม./คน/เดือน`;
  if (Math.abs(hours * 100 - Math.round(hours * 100)) > 1e-6) return "ทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
  return null;
}

// ---------------------------------------------------------------------------
// ทีม
// ---------------------------------------------------------------------------

export type TeamRow = {
  id: string;
  code: string;
  name: string;
  kind: TeamKind;
  isSystem: boolean;
  isActive: boolean;
  headcount: number;
  /** จำนวนสัญญาที่ใช้งานอยู่ผูกกับทีมนี้ (null = อ่านไม่ได้) */
  activeContracts: number | null;
};

export const TEAM_CODE_PATTERN = /^[A-Za-z0-9]{1,4}$/;
export const TEAM_NAME_MAX = 60;
export const HEADCOUNT_MAX = 99;

export function parseHeadcount(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= HEADCOUNT_MAX ? n : null;
}

/** headcount 0 = "—" (ไม่ใช่ 0 คน — หารศูนย์ไม่ได้) */
export function headcountLabel(n: number): string {
  return n > 0 ? String(n) : "—";
}

export type TeamDraft = { code: string; name: string; kind: TeamKind | ""; headcount: string };
export type TeamErrors = Partial<Record<"code" | "name" | "kind" | "headcount", string>>;

export function validateTeam(
  d: TeamDraft,
  mode: "create" | "edit",
  existingCodes: readonly string[],
): TeamErrors {
  const errors: TeamErrors = {};
  if (mode === "create") {
    const code = d.code.trim();
    if (!TEAM_CODE_PATTERN.test(code)) errors.code = "รหัสทีมเป็นตัวอักษร/ตัวเลข 1–4 ตัว";
    else if (existingCodes.some((c) => c.toLowerCase() === code.toLowerCase())) {
      errors.code = "รหัสทีมนี้มีอยู่แล้ว (ไม่สนตัวพิมพ์เล็ก/ใหญ่)";
    }
  }
  const name = d.name.trim();
  if (name === "") errors.name = "กรอกชื่อ / คำอธิบายทีม";
  else if (name.length > TEAM_NAME_MAX) errors.name = `ยาวได้ไม่เกิน ${TEAM_NAME_MAX} ตัวอักษร`;
  if (d.kind === "" || !TEAM_KINDS.includes(d.kind)) errors.kind = "เลือกประเภททีม";
  if (parseHeadcount(d.headcount) === null) errors.headcount = `กรอกจำนวนเต็ม 0–${HEADCOUNT_MAX} (0 = ยังไม่ระบุ)`;
  return errors;
}

/** ทีมนี้ปิดใช้งานได้ไหม (ทีมระบบปิดไม่ได้ — DB กันซ้ำด้วย TM002) */
export function canDeactivate(t: Pick<TeamRow, "isSystem">): boolean {
  return !t.isSystem;
}

/** ปุ่มลบทีมแสดงเมื่อไม่ใช่ทีมระบบ — ว่ามีงานผูกหรือไม่ให้ DB ตัดสิน (TM001) ไม่เดาจากตัวเลขในตาราง */
export function canOfferDelete(t: Pick<TeamRow, "isSystem">): boolean {
  return !t.isSystem;
}

// ---------------------------------------------------------------------------
// ประเภทลูกค้า
// ---------------------------------------------------------------------------

export type CustomerTypeRow = { code: string; label: string; groupLabel: string; sortOrder: number };
export type TypeGroup = { label: string; items: CustomerTypeRow[] };

/** จัดกลุ่มตามหมวด: ลำดับหมวด = sort_order ต่ำสุดของสมาชิก · ในหมวดเรียงตาม sort_order */
export function groupTypes(rows: readonly CustomerTypeRow[]): TypeGroup[] {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const groups: TypeGroup[] = [];
  for (const r of sorted) {
    let g = groups.find((x) => x.label === r.groupLabel);
    if (!g) {
      g = { label: r.groupLabel, items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }
  return groups;
}

/** รหัสทุกตัวตามลำดับที่หน้าจอแสดง (ส่ง RPC reorder_customer_types) */
export function flattenCodes(groups: readonly TypeGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.code));
}

/** ย้ายประเภท (gi, ii) ขึ้น/ลงในหมวดเดียวกัน — ชนขอบ = คืนค่าเดิม */
export function moveItem(groups: readonly TypeGroup[], gi: number, ii: number, delta: -1 | 1): TypeGroup[] {
  const next = groups.map((g) => ({ ...g, items: [...g.items] }));
  const items = next[gi]?.items;
  if (!items) return next;
  const j = ii + delta;
  if (j < 0 || j >= items.length) return next;
  [items[ii], items[j]] = [items[j]!, items[ii]!];
  return next;
}

export function moveGroup(groups: readonly TypeGroup[], gi: number, delta: -1 | 1): TypeGroup[] {
  const next = groups.map((g) => ({ ...g, items: [...g.items] }));
  const j = gi + delta;
  if (j < 0 || j >= next.length) return next;
  [next[gi], next[j]] = [next[j]!, next[gi]!];
  return next;
}

export const TYPE_LABEL_MAX = 60;

export type TypeErrors = Partial<Record<"label" | "group", string>>;

export function validateType(
  d: { label: string; group: string },
  all: readonly CustomerTypeRow[],
  exceptCode?: string,
): TypeErrors {
  const errors: TypeErrors = {};
  const label = d.label.trim();
  if (label === "") errors.label = "กรอกชื่อประเภท";
  else if (label.length > TYPE_LABEL_MAX) errors.label = `ยาวได้ไม่เกิน ${TYPE_LABEL_MAX} ตัวอักษร`;
  else if (all.some((r) => r.code !== exceptCode && normName(r.label) === normName(label))) {
    errors.label = "มีประเภทชื่อนี้อยู่แล้ว (ไม่สนเว้นวรรค/ตัวพิมพ์)";
  }
  const group = d.group.trim();
  if (group === "") errors.group = "เลือกหรือกรอกชื่อหมวด";
  else if (group.length > TYPE_LABEL_MAX) errors.group = `ยาวได้ไม่เกิน ${TYPE_LABEL_MAX} ตัวอักษร`;
  return errors;
}

/**
 * รหัสประเภทใหม่ (PK ภาษาอังกฤษ) — ผู้ใช้ไม่เห็น/ไม่ต้องตั้ง: `ct_` + hex สุ่ม 8 ตัว
 * (ตรง `customer_types.code` text PK · ไม่ซ้ำกับของเดิม)
 */
export function newTypeCode(existing: readonly string[], random: () => number = Math.random): string {
  for (let i = 0; i < 20; i += 1) {
    const hex = Array.from({ length: 8 }, () => Math.floor(random() * 16).toString(16)).join("");
    const code = `ct_${hex}`;
    if (!existing.includes(code)) return code;
  }
  throw new Error("newTypeCode: สร้างรหัสไม่ซ้ำไม่ได้");
}

/** ใส่ประเภทใหม่ท้ายหมวดของมัน (หมวดใหม่ = ท้ายสุด) แล้วคืนรหัสทุกตัวตามลำดับ */
export function orderWithNewAtGroupEnd(
  groups: readonly TypeGroup[],
  newCode: string,
  groupLabel: string,
): string[] {
  const next = groups.map((g) => ({ label: g.label, codes: g.items.map((i) => i.code) }));
  const g = next.find((x) => x.label === groupLabel);
  if (g) g.codes.push(newCode);
  else next.push({ label: groupLabel, codes: [newCode] });
  return next.flatMap((x) => x.codes);
}
