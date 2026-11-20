/**
 * สถานะของสัญญาในทะเบียน + ข้อความระยะเวลา (pure function ทดสอบได้)
 *
 * Logic summary:
 *   * สถานะที่แสดง (mockup 4 แบบ + 2 แบบจากฐานข้อมูลจริง):
 *       cancelled / paused / pending_collection(expired_pending_collection) / ended(closed) มาจาก contracts.status ตรงๆ
 *       status = active → ใช้ effectiveContractStatus (นิยามกลาง contractEnd.ts): เลยวันสิ้นสุด = pending_collection · เหลือ ≤ 90 วัน = near_end · อื่นๆ = active
 *       ended = closed อย่างเดียว · paused ไม่จบเสมอ
 *   * ตัวกรองสถานีรองที่ฐานข้อมูลบอกได้ (contracts.status) ทำฝั่งฐานข้อมูล (dbStatusesFor) แล้ว **กรองซ้ำแบบแม่นยำ**
 *     ฝั่งแอปด้วย registryStatus (เพราะ active/near_end/ended แบ่งด้วยวันที่ ฐานข้อมูลแบ่งให้ไม่ได้) — ห้ามตัดเงียบ
 *     จึงมี cursor ต่อเนื่อง ดู registryData.ts
 *   * วันจบ/มูลค่า/Tier ไม่คำนวณซ้ำที่นี่ — ใช้ lib/rules (effectiveEndDate · annualValueForTerm · tierOf)
 */
import { effectiveContractStatus } from "@/components/todo/contractEnd";
import { rulesForMonth, type Tier, type TierRule } from "@/lib/rules";

import type { DbContractStatus, RegistryStatus } from "./registryTypes";

/** สัญญาที่จะหมดภายในกี่วันนับเป็น "ใกล้หมด" (ตรงกับ mockup) */
export const NEAR_END_DAYS = 90;

/** จำนวนวันจาก a ไป b (b - a) · ทั้งคู่ 'YYYY-MM-DD' */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);
}

export function registryStatus(dbStatus: DbContractStatus, endDate: string, today: string): RegistryStatus {
  // นิยามกลาง (components/todo/contractEnd.ts): active ที่เลยวันสิ้นสุด = expired_pending_collection · paused ไม่จบ
  switch (effectiveContractStatus(dbStatus, endDate, today)) {
    case "cancelled":
      return "cancelled";
    case "paused":
      return "paused";
    case "expired_pending_collection":
      return "pending_collection";
    case "closed":
      return "ended";
    case "active": {
      const left = daysBetween(today, endDate);
      return left <= NEAR_END_DAYS ? "near_end" : "active";
    }
  }
}

/** สถานะในฐานข้อมูลที่ตัวกรองสถานะที่เลือกอาจตรงได้ (ไว้บีบผลฝั่งฐานข้อมูลก่อน) · null = ไม่กรอง */
export function dbStatusesFor(statuses: readonly RegistryStatus[]): DbContractStatus[] | null {
  if (statuses.length === 0) return null;
  const out = new Set<DbContractStatus>();
  for (const s of statuses) {
    if (s === "active" || s === "near_end") out.add("active");
    else if (s === "pending_collection") {
      out.add("expired_pending_collection");
      out.add("active"); // active ที่เลยวันสิ้นสุด (ยังเป็น active ใน DB — ไม่มีงานตั้งสถานะให้)
    } else if (s === "ended") out.add("closed");
    else out.add(s);
  }
  return [...out];
}

export const STATUS_LABEL: Record<RegistryStatus, string> = {
  active: "Active",
  near_end: "ใกล้หมด",
  pending_collection: "รอเก็บสถานี",
  ended: "หมดสัญญา",
  paused: "พักสัญญา",
  cancelled: "ยกเลิก",
};

/** ลำดับตัวเลือกในตัวกรอง (4 แบบตาม mockup ก่อน แล้ว 2 แบบเพิ่ม) */
export const STATUS_ORDER: readonly RegistryStatus[] = ["active", "near_end", "pending_collection", "ended", "paused", "cancelled"];

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (ค.ศ. — SPEC §12) */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export interface Remaining {
  /** จำนวนวันที่เหลือ (ติดลบ = หมดแล้ว) */
  days: number;
  /** ข้อความ เช่น "เหลือ 1 ปี 2 เดือน · หมด 31/12/2027" */
  text: string;
  /** สัดส่วนที่ผ่านไปของสัญญา 0–100 */
  percent: number;
  tone: "ok" | "warn" | "end";
}

export function remainingOf(start: string, end: string, today: string, status: RegistryStatus): Remaining {
  const days = daysBetween(today, end);
  const total = Math.max(1, daysBetween(start, end));
  const percent = Math.max(0, Math.min(100, (daysBetween(start, today) * 100) / total));
  const stop = `หมด ${fmtDate(end)}`;
  let text: string;
  if (days < 0) text = `หมดแล้ว ${Math.abs(days).toLocaleString("en-US")} วัน · ${stop}`;
  else if (days === 0) text = `หมดวันนี้ · ${stop}`;
  else {
    let m = Math.floor(days / 30.44);
    const y = Math.floor(m / 12);
    m = m % 12;
    const left = y > 0 || m > 0 ? `${y > 0 ? `${y} ปี ` : ""}${m > 0 ? `${m} เดือน` : ""}`.trim() : `${days} วัน`;
    text = `เหลือ ${left} · ${stop}`;
  }
  const tone = status === "near_end" ? "warn" : days < 0 ? "end" : "ok";
  return { days, text, percent, tone };
}

/**
 * คำอธิบายช่วงมูลค่าต่อปีของแต่ละ Tier สำหรับ legend ท้ายตาราง — อ่านจาก tier_rules ของเดือนปัจจุบัน (ห้าม hardcode)
 * เช่น [{tier:"S", text:"< 30,000/ปี"}, {tier:"M", text:"30,000–49,999"}, {tier:"XL", text:"≥ 100,000"}] · เกณฑ์ใช้ไม่ได้ = []
 */
export function tierLegend(rules: TierRule[], month: string): { tier: Tier; text: string }[] {
  let sorted: TierRule[];
  try {
    sorted = rulesForMonth(rules, month);
  } catch {
    return [];
  }
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return sorted.map((r, i) => {
    const next = sorted[i + 1];
    if (i === 0) return { tier: r.tier, text: next ? `< ${n(next.minAnnual)}/ปี` : "ทุกมูลค่า" };
    return { tier: r.tier, text: next ? `${n(r.minAnnual)}–${n(next.minAnnual - 1)}` : `≥ ${n(r.minAnnual)}` };
  });
}
