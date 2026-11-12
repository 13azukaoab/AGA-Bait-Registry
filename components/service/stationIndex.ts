/**
 * ดัชนีเลขสถานีของสัญญา (ต่อชนิด IG/IC/AG) — pure function
 *
 * Logic summary:
 *   * "ใช้งาน" = active / eliminated / pending_removal (ตรงกับ unique index ของฐานข้อมูล)
 *   * เลขมีช่องว่างได้ (สถานีหาย/ถอนออกแล้วเลขว่าง · DECISIONS 2.20) → ตรวจกับ "ชุดเลขที่ใช้งานอยู่" ไม่ใช่ 1..max
 *   * แก้การเข้าเดิม: ผลของงานซ่อมที่บันทึกไว้แล้วถูกทำกับสถานีแล้ว (ฝังใหม่ = มีแถวแล้ว · หาย/ถอน = ไม่ใช่
 *     "ใช้งาน" แล้ว) จึงต้องคำนวณ "ชุดเลขก่อนการเข้านี้" (`baselineIndex`) เพื่อไม่ให้ตรวจผิดว่าชนกับตัวเอง
 *   * ตั้งสถานีครั้งแรก (ยังไม่มีแถว): ใช้ชุดเลขที่ "จะสร้าง" แทน (`plannedIndex`)
 */
import type { StationRow, StationType, WorkRowDb } from "./types";
import { isInUse } from "./types";

export type NumberIndex = Record<StationType, Set<number>>;

export function emptyIndex(): NumberIndex {
  return { IG: new Set(), IC: new Set(), AG: new Set() };
}

export function inUseIndex(stations: readonly StationRow[]): NumberIndex {
  const idx = emptyIndex();
  for (const s of stations) {
    if (s.no !== null && isInUse(s.status)) idx[s.type].add(s.no);
  }
  return idx;
}

/**
 * ชุดเลขที่ใช้งาน "ก่อน" การเข้านี้ทำงานซ่อม:
 *   − เลขที่การเข้านี้ฝังใหม่ไว้แล้ว  + เลขที่การเข้านี้ทำให้หาย/ถอนออกไว้แล้ว
 */
export function baselineIndex(
  stations: readonly StationRow[],
  savedWorks: readonly WorkRowDb[],
): NumberIndex {
  const idx = inUseIndex(stations);
  for (const w of savedWorks) {
    if (w.kind === "added") for (const n of w.stationNos) idx[w.stationType].delete(n);
  }
  for (const w of savedWorks) {
    if (w.kind === "lost" || w.kind === "withdrawn") {
      for (const n of w.stationNos) idx[w.stationType].add(n);
    }
  }
  return idx;
}

/** เลขกล่อง AG ถัดไป = มากกว่าเลขสูงสุดของ AG ทุกสถานะ (ไม่หยิบเลขของกล่องที่ถอดแล้วกลับมาใช้ให้สับสน) */
export function nextAgNumber(stations: readonly StationRow[], alsoUsed: readonly number[] = []): number {
  let max = 0;
  for (const s of stations) if (s.type === "AG" && s.no !== null && s.no > max) max = s.no;
  for (const n of alsoUsed) if (n > max) max = n;
  return max + 1;
}

/** ย่อชุดเลขเป็นข้อความสั้นๆ ไว้แสดง เช่น "1-80" หรือ "1-4, 6-9" */
export function describeNumbers(numbers: Iterable<number>): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i] as number;
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      i += 1;
      end = sorted[i] as number;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    i += 1;
  }
  return parts.join(", ");
}
