/**
 * ช่องสาขา: พิมพ์แล้วเดาคำ รับเฉพาะชื่อที่อยู่ใน master (ตาราง branches)
 *
 * Logic summary:
 *   * เทียบชื่อแบบตัดช่องว่าง/ตัวพิมพ์ ("พระราม2" = "พระราม 2") เพื่อช่วยผู้ใช้ แต่ค่าที่บันทึก
 *     เป็นชื่อสะกดตรงใน master เสมอ (ชื่อสาขาเป็น key ของ Dashboard)
 *   * ไม่พบใน master = null → ช่องขอบแดง บันทึกไม่ผ่าน
 *   * เขตมาจาก branch.zoneName อัตโนมัติ ผู้ใช้ไม่กรอก
 */

export interface BranchOption {
  id: string;
  name: string;
  zoneId: string;
  zoneName: string;
}

function squash(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** หาสาขาที่ชื่อตรง (หลัง squash) · ไม่เจอ = null */
export function resolveBranch(
  input: string,
  branches: readonly BranchOption[],
): BranchOption | null {
  const key = squash(input);
  if (!key) return null;
  return branches.find((b) => squash(b.name) === key) ?? null;
}

/** รายการเดาคำ: ชื่อที่ขึ้นต้นด้วยตัวที่พิมพ์ก่อน แล้วตามด้วยที่มีคำนั้นอยู่ข้างใน */
export function suggestBranches(
  input: string,
  branches: readonly BranchOption[],
  limit = 8,
): BranchOption[] {
  const key = squash(input);
  if (!key) return branches.slice(0, limit);
  const starts: BranchOption[] = [];
  const contains: BranchOption[] = [];
  for (const b of branches) {
    const n = squash(b.name);
    if (n.startsWith(key)) starts.push(b);
    else if (n.includes(key)) contains.push(b);
  }
  return [...starts, ...contains].slice(0, limit);
}
