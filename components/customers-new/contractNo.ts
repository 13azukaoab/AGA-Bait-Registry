/**
 * เลขที่สัญญา (ช่อง "เลขที่สัญญา" ในตารางเปิดงาน)
 *
 * Logic summary:
 *   * ตัดช่องว่างทุกชนิด + พิมพ์ใหญ่อัตโนมัติ (ไฟล์ Excel เดิมมีเว้นวรรคท้าย/ตัวเล็ก ทำให้กลายเป็นสัญญาคนละใบ)
 *   * รูปแบบ: CT + ปี 2 หลัก + "-" + 7 หลัก เช่น CT26-0021813 (ตาม mockup ctFix)
 *   * ซ้ำกันในตารางเดียวกัน = ไม่ผ่าน (ซ้ำกับในฐานข้อมูลตรวจตอนบันทึกด้วย UNIQUE ของ contracts.contract_no)
 */

const CONTRACT_NO_PATTERN = /^CT\d{2}-\d{7}$/;

export function normalizeContractNo(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidContractNo(normalized: string): boolean {
  return CONTRACT_NO_PATTERN.test(normalized);
}

/** ผลตรวจเลขที่สัญญาทั้งตาราง: คืน error ภาษาไทยต่อ index (ไม่มี key = ผ่าน/ว่าง) */
export function checkContractNos(values: readonly string[]): Map<number, string> {
  const normalized = values.map(normalizeContractNo);
  const count = new Map<string, number>();
  for (const v of normalized) if (v) count.set(v, (count.get(v) ?? 0) + 1);

  const errors = new Map<number, string>();
  normalized.forEach((v, i) => {
    if (!v) return;
    if (!isValidContractNo(v)) {
      errors.set(i, "รูปแบบต้องเป็น CT + ปี 2 หลัก + - + 7 หลัก เช่น CT26-0021813");
    } else if ((count.get(v) ?? 0) > 1) {
      errors.set(i, "เลขที่สัญญาซ้ำกับแถวอื่น");
    }
  });
  return errors;
}
