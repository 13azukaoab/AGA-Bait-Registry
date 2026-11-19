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
 *   * เคมีผง: จุด × 0.3 ก./จุด (ตรงกับ view) · คิดกรัมจากยอดรวมจุด ไม่รวมค่าที่ปัดทีละการเข้า
 *   * ไม่มีชื่อลูกค้าในข้อมูลที่ผ่านไฟล์นี้ (PDPA)
 */

export type SaleType = "new" | "renew";
export type VisitType = "routine" | "problem" | "follow_up";
export type WorkGroup = "routine" | "makeup" | "problem";
export type CustomerGroup = "new" | "renew" | "unknown";

/** เคมีผง 0.3 ก. ต่อจุด (ตรงกับ v_service_materials.powder_g) */
export const POWDER_G_PER_POINT = 0.3;

export interface MaterialVisit {
  visitId: string;
  branchId: string;
  visitType: VisitType;
  /** 'YYYY-MM-DD' วันแรกของเดือนที่ชดเชย · null = ไม่ใช่การเข้าชดเชย */
  makeupForMonth: string | null;
  saleType: SaleType | null;
  /** ทีมที่เข้าในครั้งนั้น (visit_teams) */
  teamIds: readonly string[];
  /** เวลาทำงานจริง (นาที) · null = ไม่มีข้อมูล */
  durationMin: number | null;
  outsideG: number;
  insideG: number;
  /** ส่วนของ insideG ที่เป็นเหยื่อติดตั้ง AG ตอนติดตั้ง */
  installBaitG: number;
  powderPoints: number;
  timberPcs: number;
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

/** รวมวัสดุของการเข้าหลายครั้ง */
export function sumMaterials(visits: readonly MaterialVisit[]): Materials {
  const m = emptyMaterials();
  for (const v of visits) {
    m.visits += 1;
    m.outsideG += v.outsideG;
    m.insideG += v.insideG;
    m.installBaitG += v.installBaitG;
    m.powderPoints += v.powderPoints;
    m.timberPcs += v.timberPcs;
  }
  m.powderG = Math.round(m.powderPoints * POWDER_G_PER_POINT * 10) / 10;
  return m;
}

/** เหยื่อรวมนอก+ใน (ก.) */
export function baitTotalG(m: Materials): number {
  return m.outsideG + m.insideG;
}

/** จัดการเข้า 1 ครั้งเข้ากลุ่มประเภทงาน — ชดเชยแยกเฉพาะในกลุ่ม routine */
export function workGroupOf(v: Pick<MaterialVisit, "visitType" | "makeupForMonth">): WorkGroup {
  if (v.visitType === "routine") return v.makeupForMonth ? "makeup" : "routine";
  return "problem";
}

export function customerGroupOf(v: Pick<MaterialVisit, "saleType">): CustomerGroup {
  return v.saleType ?? "unknown";
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

export function breakdownByWork(visits: readonly MaterialVisit[]): WorkBreakdown {
  const routine = visits.filter((v) => v.visitType === "routine");
  const makeup = routine.filter((v) => workGroupOf(v) === "makeup");
  const problem = visits.filter((v) => workGroupOf(v) === "problem");
  return { routine: sumMaterials(routine), makeup: sumMaterials(makeup), problem: sumMaterials(problem), all: sumMaterials(visits) };
}

export interface CustomerBreakdown {
  new: Materials;
  renew: Materials;
  /** สัญญาที่ไม่มี sale_type — ใช้ให้ยอดรวมตรงเสมอ (หน้าจอแสดงเฉพาะเมื่อ > 0) */
  unknown: Materials;
  all: Materials;
}

export function breakdownByCustomer(visits: readonly MaterialVisit[]): CustomerBreakdown {
  const pick = (g: CustomerGroup) => sumMaterials(visits.filter((v) => customerGroupOf(v) === g));
  return { new: pick("new"), renew: pick("renew"), unknown: pick("unknown"), all: sumMaterials(visits) };
}

/** รวมวัสดุรายสาขา (key = branchId) */
export function sumByBranch(visits: readonly MaterialVisit[]): Map<string, Materials> {
  const groups = new Map<string, MaterialVisit[]>();
  for (const v of visits) {
    const list = groups.get(v.branchId);
    if (list) list.push(v);
    else groups.set(v.branchId, [v]);
  }
  const out = new Map<string, Materials>();
  for (const [id, list] of groups) out.set(id, sumMaterials(list));
  return out;
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
