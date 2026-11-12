/**
 * ตั้งสถานีครั้งแรก (`initialize_contract_stations`) — pure function (SPEC v1.8 §8.1 · DECISIONS 2.19)
 *
 * Logic summary:
 *   * ลูกค้าใหม่: กรอกจำนวน IG / IC → หน้าจอสร้างเลข 1..n (ไม่มีช่องว่าง)
 *   * Renew: เสนอสถานีที่ยังใช้งานของสัญญาเก่าทั้งหมด (ติ๊กไว้ก่อน) ผู้ใช้ติ๊กออกได้ + เพิ่มสถานีใหม่ได้
 *       - สถานีที่ย้ายยังใช้ "เลขเดิม" (F ของกล่อง AG นับต่อ) · เลขใหม่ต่อจากเลขสูงสุดของชนิดนั้นที่ย้ายมา
 *         (ไม่ชนกัน → ไม่เกิด SV009)
 *       - ย้ายได้ทุกชนิด รวม AG (RPC รองรับ)
 *   * ทำได้ครั้งเดียวต่อสัญญา — ถ้า RPC ตอบ SV007 แปลว่าตั้งไปแล้ว (หน้าจอโหลดสถานีใหม่แล้วบันทึกต่อ)
 */
import type { NumberIndex } from "./stationIndex";
import { emptyIndex } from "./stationIndex";
import type { SetupState, StationRow } from "./types";
import { isInUse } from "./types";

export const MAX_SETUP_COUNT = 500;

export function emptySetup(): SetupState {
  return { igCount: "", icCount: "", excludedOldIds: [], extraIg: "", extraIc: "" };
}

/** จำนวนสถานี: ว่าง = 0 · ต้องเป็นจำนวนเต็ม 0–500 · ผิดรูปแบบ = null */
export function parseCount(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > MAX_SETUP_COUNT ? null : n;
}

export interface InitPlan {
  igNos: number[];
  icNos: number[];
  transferIds: string[];
  /** ชุดเลขสถานีที่จะมีหลังตั้ง (ไว้ตรวจเลขในฟอร์ม) */
  index: NumberIndex;
  /** จำนวนสถานีที่ใช้งานหลังตั้ง (รวมที่ย้ายมา) */
  total: number;
  errors: string[];
}

function range(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + i);
}

export function buildInitPlan(
  setup: SetupState,
  isRenew: boolean,
  oldStations: readonly StationRow[],
): InitPlan {
  const errors: string[] = [];
  const index = emptyIndex();
  const transferIds: string[] = [];

  if (isRenew) {
    const excluded = new Set(setup.excludedOldIds);
    for (const s of oldStations) {
      if (!isInUse(s.status) || s.no === null || excluded.has(s.id)) continue;
      transferIds.push(s.id);
      index[s.type].add(s.no);
    }
  }

  const ig = parseCount(isRenew ? setup.extraIg : setup.igCount);
  const ic = parseCount(isRenew ? setup.extraIc : setup.icCount);
  if (ig === null) errors.push("จำนวนสถานี IG ต้องเป็นจำนวนเต็ม 0–500");
  if (ic === null) errors.push("จำนวนสถานี IC ต้องเป็นจำนวนเต็ม 0–500");

  const startAfter = (set: Set<number>) => (set.size ? Math.max(...set) + 1 : 1);
  const igNos = range(startAfter(index.IG), ig ?? 0);
  const icNos = range(startAfter(index.IC), ic ?? 0);
  for (const n of igNos) index.IG.add(n);
  for (const n of icNos) index.IC.add(n);

  const total = index.IG.size + index.IC.size + index.AG.size;
  if (errors.length === 0 && total < 1) {
    errors.push(
      isRenew
        ? "ยังไม่มีสถานีเลย — ติ๊กย้ายสถานีจากสัญญาเก่า หรือระบุจำนวนสถานีใหม่"
        : "จำนวนสถานี IG / IC (ลูกค้าใหม่) ต้องมีอย่างน้อย 1 สถานี",
    );
  }
  return { igNos, icNos, transferIds, index, total, errors };
}
