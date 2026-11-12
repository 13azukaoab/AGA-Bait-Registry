/**
 * ปริมาณเหยื่อ + การกินเหยื่อ ของผลตรวจ — pure function (SPEC v1.8 §8.1 · DECISIONS 2.9)
 *
 * Logic summary:
 *   * เลือกจากรายการ 0 / 50 / 100 / 150 / 200 ก. หรือ "มากกว่า 200" แล้วพิมพ์เอง
 *   * พิมพ์เอง: จำนวนเต็ม > 200 หาร 50 ลงตัว ไม่เกิน 5,000 (ตรงกับ CHECK ของ `station_checks.bait_added_g`)
 *   * การกินเหยื่อ 0 / 25 / 50 / 75 / 100% — ไม่บังคับ
 */
import type { BaitSelect, EatenSelect } from "./types";

export const BAIT_OPTIONS = [0, 50, 100, 150, 200] as const;
export const BAIT_CUSTOM_MIN = 250;
export const BAIT_MAX = 5000;
export const EATEN_OPTIONS = [0, 25, 50, 75, 100] as const;

export const BAIT_CUSTOM_HINT = "ต้องมากกว่า 200 และหาร 50 ลงตัว เช่น 250, 300, 350 (ไม่เกิน 5,000)";

export type BaitResult =
  | { status: "unset" }
  | { status: "ok"; grams: number }
  | { status: "invalid"; message: string };

export function resolveBait(select: BaitSelect, custom: string): BaitResult {
  if (select === "") return { status: "unset" };
  if (select !== "other") return { status: "ok", grams: Number(select) };
  const text = custom.trim();
  if (text === "") return { status: "invalid", message: "พิมพ์ปริมาณเหยื่อ" };
  if (!/^\d+$/.test(text)) return { status: "invalid", message: BAIT_CUSTOM_HINT };
  const grams = Number(text);
  if (grams < BAIT_CUSTOM_MIN || grams > BAIT_MAX || grams % 50 !== 0) {
    return { status: "invalid", message: BAIT_CUSTOM_HINT };
  }
  return { status: "ok", grams };
}

/** ค่าที่โหลดจากฐานข้อมูลกลับเป็นตัวเลือกบนจอ (นอกรายการ = "มากกว่า 200" + ค่าที่พิมพ์) */
export function baitToSelect(grams: number | null): { select: BaitSelect; custom: string } {
  if (grams === null) return { select: "", custom: "" };
  if ((BAIT_OPTIONS as readonly number[]).includes(grams)) {
    return { select: String(grams) as BaitSelect, custom: "" };
  }
  return { select: "other", custom: String(grams) };
}

export function eatenToSelect(pct: number | null): EatenSelect {
  return pct === null ? "" : (String(pct) as EatenSelect);
}

export function resolveEaten(select: EatenSelect): number | null {
  return select === "" ? null : Number(select);
}

/** เคมีผง: จำนวนจุดต้องเป็นจำนวนเต็ม ≥ 1 (ฐานข้อมูล CHECK powder_points > 0) · กรัม = จุด × 0.3 */
export type PowderResult =
  | { status: "unset" }
  | { status: "ok"; points: number; grams: number }
  | { status: "invalid" };

export function resolvePowder(text: string): PowderResult {
  const t = text.trim();
  if (t === "") return { status: "unset" };
  if (!/^\d+$/.test(t)) return { status: "invalid" };
  const points = Number(t);
  if (points < 1 || points > 100000) return { status: "invalid" };
  return { status: "ok", points, grams: Math.round(points * 0.3 * 100) / 100 };
}
