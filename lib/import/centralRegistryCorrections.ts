/**
 * ตาราง "แก้เลขที่สัญญา" ในทะเบียนส่วนกลาง OCT.26 — ระบุเองทุกแถว อ้างด้วย ไฟล์ / ชีท / แถว Excel (ห้ามเดา)
 *
 * Logic summary:
 *   - ใช้กับแถวที่สาขายืนยันแล้วว่าเลขในไฟล์ผิด (เช่น เลขซ้ำข้ามสาขา ง1 → สาขาตอบ · DECISIONS 2.80)
 *   - แก้ที่ "ตารางเซลล์" (grid) ก่อนอ่านชีท → dry-run, ตัวหาเลขซ้ำข้ามสาขา และนำเข้าจริง เห็นเลขเดียวกันทุกขั้น
 *   - ด่าน: เลขเดิมในเซลล์ต้องตรง `from` (ไฟล์เปลี่ยน/แถวเลื่อน = หยุด) · รายการในตารางที่ไม่ถูกใช้ = หยุด
 *   - ใส่ได้เฉพาะเลขที่สัญญา **ห้ามใส่ชื่อลูกค้า/ข้อมูลส่วนบุคคล** (ชื่อพิมพ์ผิดให้ Admin แก้ในแอปหลังนำเข้า)
 */
import { parseRegistrySheet, type CellValue } from "./registrySheet";

export interface ContractNoCorrection {
  /** ชื่อไฟล์ทะเบียน (ตรง CENTRAL_REGISTRY_FILES_OCT26) */
  file: string;
  /** ชื่อชีทตามไฟล์ */
  sheet: string;
  /** เลขแถว Excel (เริ่ม 1) */
  excelRow: number;
  /** เลขในไฟล์ (หลังตัดช่องว่าง + ตัวพิมพ์ใหญ่) */
  from: string;
  /** เลขที่ถูกต้อง */
  to: string;
  /** เหตุผล/ที่มา (ไม่มีข้อมูลลูกค้า) */
  reason: string;
}

export const CONTRACT_NO_CORRECTIONS_OCT26: readonly ContractNoCorrection[] = [
  {
    file: "OCT.26_เขต 4 ปี 2026 (ลาดพร้าว, พัฒนาการ, สุวินทวงศ์, ประชาชื่น).xlsx",
    sheet: "สุวินทวงศ์",
    excelRow: 77,
    from: "CT26-0025771",
    to: "CT26-0018912",
    reason: "สาขายืนยันเลขจริง (เลขในไฟล์ซ้ำกับพุทธมณฑล แถว 225) · DECISIONS 2.80",
  },
];

const norm = (v: CellValue | undefined): string => String(v ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * คืน grid ใหม่ที่แก้เลขสัญญาตามตาราง (ไม่แก้ grid เดิม) + รายการที่ใช้
 * เลขเดิมในเซลล์ไม่ตรง `from` = throw
 */
export function applyContractNoCorrections(
  file: string,
  sheet: string,
  grid: CellValue[][],
  corrections: readonly ContractNoCorrection[] = CONTRACT_NO_CORRECTIONS_OCT26,
): { grid: CellValue[][]; applied: ContractNoCorrection[] } {
  const mine = corrections.filter((c) => c.file === file && c.sheet === sheet);
  if (mine.length === 0) return { grid, applied: [] };
  const col = parseRegistrySheet(grid, sheet).columns.contractNo;
  const out = grid.map((row) => [...row]);
  for (const c of mine) {
    const row = out[c.excelRow - 1];
    if (!row || norm(row[col]) !== c.from) {
      throw new Error(
        `ตารางแก้เลขสัญญา: ${sheet} แถว ${c.excelRow} เลขในไฟล์ไม่ใช่ ${c.from} (ไฟล์เปลี่ยน/แถวเลื่อน?) — หยุด ตรวจตารางก่อน`,
      );
    }
    row[col] = c.to;
  }
  return { grid: out, applied: mine };
}

/** รายการในตารางที่ไม่ถูกใช้ (ไฟล์/ชีทไม่ตรง) — ต้องว่าง */
export function unusedCorrections(
  applied: readonly ContractNoCorrection[],
  corrections: readonly ContractNoCorrection[] = CONTRACT_NO_CORRECTIONS_OCT26,
): ContractNoCorrection[] {
  return corrections.filter((c) => !applied.includes(c));
}
