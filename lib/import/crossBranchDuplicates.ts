/**
 * หาเลขที่สัญญาที่ซ้ำ "ข้ามสาขา" ในทะเบียนส่วนกลาง (เจ้าของตัดสิน ง1 · 18 พ.ย. 2026) — pure function
 *
 * Logic summary:
 *   - contracts.contract_no เป็น UNIQUE ในฐานข้อมูล → เลขเดียวกันใน 2 สาขา นำเข้าได้แค่แถวเดียว
 *   - เจ้าของให้ "ถามสาขาก่อน": ทุกแถวที่ซ้ำข้ามสาขา **ไม่นำเข้า** → ส่งเป็น holdRows ให้ dryRunRegistrySheet
 *     แล้วไปรายการกรอกมือพร้อมเหตุผล DUPLICATE_ACROSS_BRANCH_REASON
 *   - ซ้ำในสาขาเดียวกัน ไม่ใช่งานของไฟล์นี้ (importContracts แจ้ง "เลขที่สัญญาซ้ำกับแถว …" อยู่แล้ว)
 *   - คืนแค่สาขา + เลขแถว Excel (ไม่มีเลขสัญญา/ชื่อลูกค้าในผลลัพธ์ · PDPA)
 */
import type { HoldRow } from "./registryDryRun";
import type { RegistryRow } from "./registrySheet";

export const DUPLICATE_ACROSS_BRANCH_REASON = "เลขที่สัญญาซ้ำข้ามสาขา รอสาขายืนยัน";

const CONTRACT_LIKE = /^CT\d{2}-\d+$/;

export interface BranchRows {
  branch: string;
  rows: RegistryRow[];
}

/** สาขา → แถวที่ต้องกัน (ทุกแถวของเลขที่ซ้ำข้ามสาขา) */
export function findCrossBranchDuplicates(entries: BranchRows[]): Map<string, HoldRow[]> {
  const places = new Map<string, { branch: string; excelRow: number }[]>();
  for (const { branch, rows } of entries) {
    for (const r of rows) {
      const no = ((r.raw as Record<string, string>)["เลขที่สัญญา"] ?? "").replace(/\s+/g, "").toUpperCase();
      if (!CONTRACT_LIKE.test(no)) continue;
      places.set(no, [...(places.get(no) ?? []), { branch, excelRow: r.excelRow }]);
    }
  }
  const holds = new Map<string, HoldRow[]>();
  for (const list of places.values()) {
    if (new Set(list.map((p) => p.branch)).size < 2) continue;
    for (const p of list) {
      holds.set(p.branch, [...(holds.get(p.branch) ?? []), { excelRow: p.excelRow, reason: DUPLICATE_ACROSS_BRANCH_REASON }]);
    }
  }
  for (const list of holds.values()) list.sort((a, b) => a.excelRow - b.excelRow);
  return holds;
}
