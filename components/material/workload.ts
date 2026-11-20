/**
 * ภาระงานรายทีม (ชม./คน) ของหน้า /material — จุดเปลี่ยนเกณฑ์จุดเดียว
 *
 * Logic summary:
 *   * ชม./คน = เวลาทำงานรวมของทีม (ชม.) ÷ `teams.headcount` (M25) · headcount = 0 → ยังไม่ตั้งจำนวนคน (คำนวณไม่ได้)
 *   * เกินเกณฑ์ = ชม./คน > เกณฑ์ (ตามข้อมูลจริง ไม่ปัดก่อนเทียบ)
 *   * เกณฑ์ของทีม: ตอนนี้ใช้ค่ากลาง `workload_hours_per_person()` ทุกทีม (DECISIONS 2.89 ระหว่างรอ M42)
 *     พอ BE รวม M42 (`team_workload_hours(team_id)` · DECISIONS 2.88) เข้า main ให้แก้ **ฟังก์ชัน `thresholdForTeam` ข้างล่างที่เดียว**
 *     (และ `materialData.ts` ตอนดึงค่าต่อทีมมาใส่ `TeamThresholds`) — ที่เหลือของหน้าไม่ต้องแตะ
 *   * ห้าม hardcode ตัวเลขเกณฑ์ (30 เป็นแค่ค่าเริ่มต้นในฐานข้อมูล)
 */

/** เกณฑ์ที่โหลดมา: ค่ากลาง + (อนาคต) ค่าของแต่ละทีมที่ตั้งทับ — ทีมที่ไม่มีใน byTeam = ใช้ค่ากลาง */
export interface TeamThresholds {
  /** ค่ากลาง ชม./คน/เดือน (app_settings.workload_hours_per_person) */
  central: number;
  /** teamId → ค่าที่ทีมตั้งทับ (M42) · ตอนนี้ว่างเสมอ */
  byTeam: Readonly<Record<string, number>>;
}

/** เกณฑ์ ชม./คน ของทีมนั้น — จุดอ่านเดียวของหน้านี้ */
export function thresholdForTeam(teamId: string, thresholds: TeamThresholds): number {
  return thresholds.byTeam[teamId] ?? thresholds.central;
}

export type WorkloadLevel = "ok" | "over" | "no-headcount";

export interface WorkloadResult {
  hours: number;
  headcount: number;
  perPerson: number | null;
  threshold: number;
  level: WorkloadLevel;
}

/** นาที → ชั่วโมง (2 ทศนิยม) */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function evaluateWorkload(minutes: number, headcount: number, threshold: number): WorkloadResult {
  const hours = minutes / 60;
  if (headcount <= 0) return { hours, headcount, perPerson: null, threshold, level: "no-headcount" };
  const perPerson = hours / headcount;
  return { hours, headcount, perPerson, threshold, level: perPerson > threshold ? "over" : "ok" };
}
