/**
 * userLabel — ประกอบป้ายแสดง "ใครล็อกอินอยู่" บนแถบบน (pure function · ไม่แตะ DB)
 *
 * กติกา: ชื่อ = displayName (ตัดช่องว่าง) → ถ้าว่างใช้ username · ตำแหน่ง = ชื่อสั้นของตำแหน่ง
 * ไม่มีตำแหน่ง = แสดงแค่ชื่อ (ไม่มี " · " ค้าง) · ผลลัพธ์เป็นข้อความล้วน ส่งข้าม server→client ได้
 */
export type UserLabel = {
  name: string;
  /** ว่าง "" = ไม่มีตำแหน่ง */
  position: string;
  /** ข้อความเต็มสำหรับ title / aria-label เช่น "ทดสอบ Project Manager · PM" */
  full: string;
};

export type UserLabelInput = {
  displayName: string | null | undefined;
  positionShortName: string | null | undefined;
  username: string;
};

export function userLabel(input: UserLabelInput): UserLabel {
  const name = input.displayName?.trim() || input.username.trim();
  const position = input.positionShortName?.trim() ?? "";
  return { name, position, full: position ? `${name} · ${position}` : name };
}
