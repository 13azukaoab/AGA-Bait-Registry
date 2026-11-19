/**
 * ตรรกะล้วน (pure function) ของหน้า "สรุปงานบริการรายเดือน" (/material) — ไม่แตะ DB / React
 *
 * Logic summary:
 *   * ข้อมูลเข้า = `MaterialVisit` 1 แถวต่อการเข้า 1 ครั้ง (รวมวัสดุจาก v_service_materials กับข้อมูลการเข้า/สัญญา
 *     ที่ `materialData.ts` ดึงมา) — ถ้า BE ส่ง RPC รวมยอดมาให้ ให้เปลี่ยนที่ `materialData.ts` ที่เดียว (ไฟล์นี้ยังใช้เหมือนเดิม)
 *   * มุมมอง 1 ตามประเภทงาน (DECISIONS 2.90 ก):
 *       - บริการประจำเดือน = `visit_type = 'routine'` · แยกย่อย "ชดเชย" = `makeup_for_month` ไม่เป็น null (ชดเชยเป็นส่วนหนึ่งของประจำเดือน)
 *       - แก้ไขปัญหา = `visit_type IN ('problem','follow_up')` (เหยื่อติดตั้ง AG อยู่ใน insideG ของการเข้านั้นแล้ว)
 *       - งานซ่อมที่ทำในการเข้าแบบ routine ถูกนับเป็นบริการประจำเดือน (ข้อจำกัดที่เจ้าของรับทราบ)
 *   * มุมมอง 2 ตามประเภทลูกค้า = `contracts.sale_type` (new / renew · ไม่ระบุ = unknown) นับวัสดุทั้งหมดของลูกค้ากลุ่มนั้น
 *   * เคมีผง: กรัมคิดจากยอดรวมจุด × 0.3 ก./จุด (ไม่รวมค่าที่ปัดทีละการเข้า)
 *   * ไม่มีชื่อลูกค้าในข้อมูลที่ผ่านไฟล์นี้ (PDPA)
 */

export type SaleType = "new" | "renew";
export type WorkGroup = "routine" | "makeup" | "problem";
export type CustomerGroup = "new" | "renew" | "unknown";

/** เคมีผง 0.3 ก. ต่อจุด (ตรงกับ v_service_materials.powder_g) */
export const POWDER_G_PER_POINT = 0.3;

/** 1 แถวของ RPC material_usage_summary (สาขา × ประเภทงาน × sale_type) */
export interface UsageRow {
  branchId: string;
  workGroup: WorkGroup;
  saleType: CustomerGroup;
  visitCount: number;
  outsideG: number;
  insideG: number;
  installBaitG: number;
  powderPoints: number;
  timberPcs: number;
}

/** การเข้า 1 ครั้ง (ไม่มีวัสดุ) — ใช้กับภาระงานรายทีมและตรวจภายใน */
export interface MaterialVisit {
  visitId: string;
  branchId: string;
  /** ลูกค้าของการเข้า (ใช้นับจำนวนลูกค้าไม่ซ้ำ · ไม่ส่งชื่อออกหน้าจอ) */
  customerId: string;
  /** ติ๊ก "ตรวจภายใน" (visits.internal_inspection) · DECISIONS 2.93 */
  internalInspection: boolean;
  /** ทีมที่เข้าในครั้งนั้น (visit_teams) */
  teamIds: readonly string[];
  /** เวลาทำงานจริง (นาที) · null = ไม่มีข้อมูล */
  durationMin: number | null;
}

export interface Materials {
  visits: number;
  outsideG: number;
  insideG: number;
  installBaitG: number;
  powderPoints: number;
  /** กรัม (1 ทศนิยม) */
  powderG: number;
  timberPcs: number;
}

export function emptyMaterials(): Materials {
  return { visits: 0, outsideG: 0, insideG: 0, installBaitG: 0, powderPoints: 0, powderG: 0, timberPcs: 0 };
}

/** รวมแถวสรุปวัสดุ */
export function sumUsage(rows: readonly UsageRow[]): Materials {
  const m = emptyMaterials();
  for (const r of rows) {
    m.visits += r.visitCount;
    m.outsideG += r.outsideG;
    m.insideG += r.insideG;
    m.installBaitG += r.installBaitG;
    m.powderPoints += r.powderPoints;
    m.timberPcs += r.timberPcs;
  }
  m.powderG = Math.round(m.powderPoints * POWDER_G_PER_POINT * 10) / 10;
  return m;
}

/** เหยื่อรวมนอก+ใน (ก.) */
export function baitTotalG(m: Materials): number {
  return m.outsideG + m.insideG;
}

export interface WorkBreakdown {
  /** บริการประจำเดือน ทั้งหมด (รวมชดเชย) */
  routine: Materials;
  /** ส่วนที่เป็นชดเชย (เซ็ตย่อยของ routine) */
  makeup: Materials;
  problem: Materials;
  /** routine + problem = ทุกการเข้า */
  all: Materials;
}

export function breakdownByWork(rows: readonly UsageRow[]): WorkBreakdown {
  return {
    routine: sumUsage(rows.filter((r) => r.workGroup !== "problem")),
    makeup: sumUsage(rows.filter((r) => r.workGroup === "makeup")),
    problem: sumUsage(rows.filter((r) => r.workGroup === "problem")),
    all: sumUsage(rows),
  };
}

export interface CustomerBreakdown {
  new: Materials;
  renew: Materials;
  /** สัญญาที่ไม่มี sale_type ("ไม่ระบุ") — ใช้ให้ยอดรวมตรงเสมอ (หน้าจอแสดงเฉพาะเมื่อมีการเข้า) */
  unknown: Materials;
  all: Materials;
}

export function breakdownByCustomer(rows: readonly UsageRow[]): CustomerBreakdown {
  const pick = (g: CustomerGroup) => sumUsage(rows.filter((r) => r.saleType === g));
  return { new: pick("new"), renew: pick("renew"), unknown: pick("unknown"), all: sumUsage(rows) };
}

/** รวมวัสดุรายสาขา (key = branchId) */
export function sumByBranch(rows: readonly UsageRow[]): Map<string, Materials> {
  const groups = new Map<string, UsageRow[]>();
  for (const r of rows) {
    const list = groups.get(r.branchId);
    if (list) list.push(r);
    else groups.set(r.branchId, [r]);
  }
  return new Map([...groups].map(([id, list]) => [id, sumUsage(list)]));
}

/**
 * % เปลี่ยนจากเดือนก่อน — null เมื่อเดือนก่อนเป็น 0 / ไม่มีข้อมูล (หลีกเลี่ยงหารศูนย์และ "∞%")
 * ปัดเป็นจำนวนเต็ม
 */
export function pctChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** สัดส่วน (0–100, ปัดจำนวนเต็ม) · ส่วนรวม 0 = 0 */
export function sharePct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** ก./กล่อง AG = เหยื่อใน AG ÷ จำนวนกล่อง AG ที่ตรวจจริง (1 ทศนิยม) · ไม่มีกล่อง = null */
export function gramsPerAgBox(insideG: number, agChecked: number): number | null {
  return agChecked > 0 ? Math.round((insideG / agChecked) * 10) / 10 : null;
}

export interface InspectionCount {
  /** จำนวนการเข้าที่ติ๊กตรวจภายใน */
  visits: number;
  /** จำนวนลูกค้าไม่ซ้ำ (ลูกค้าเดียวกันเข้าหลายครั้งนับ 1 ราย) */
  customers: number;
}

/** นับ "ตรวจภายใน" (DECISIONS 2.93): การเข้า = จำนวนแถวที่ติ๊ก · ลูกค้า = customerId ไม่ซ้ำ */
export function countInternalInspection(visits: readonly MaterialVisit[]): InspectionCount {
  const hit = visits.filter((v) => v.internalInspection);
  return { visits: hit.length, customers: new Set(hit.map((v) => v.customerId)).size };
}

/** ตรวจภายในแยกกลุ่ม (key เช่น branchId) — เฉพาะกลุ่มที่มีการตรวจ */
export function inspectionByKey(
  visits: readonly MaterialVisit[],
  keysOf: (v: MaterialVisit) => readonly string[],
): Map<string, InspectionCount> {
  const groups = new Map<string, MaterialVisit[]>();
  for (const v of visits) {
    if (!v.internalInspection) continue;
    for (const k of keysOf(v)) {
      const list = groups.get(k);
      if (list) list.push(v);
      else groups.set(k, [v]);
    }
  }
  return new Map([...groups].map(([k, list]) => [k, countInternalInspection(list)]));
}
