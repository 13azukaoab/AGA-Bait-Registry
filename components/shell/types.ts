/**
 * ชนิดข้อมูลกลางของโครงหน้า (app shell)
 *
 * Role ใช้เป็น prop เท่านั้น — shell ไม่รู้ว่าผู้ใช้ล็อกอินอย่างไร (หมวด BE เป็นคนต่อของจริง)
 * ผู้ใช้เห็นแต่ชื่อตำแหน่งภาษาไทย (ROLE_LABELS) ไม่เห็นคำว่า host / recorder
 */
export type Role = "host" | "admin" | "recorder" | "viewer";

export const ROLES: readonly Role[] = ["host", "admin", "recorder", "viewer"];

/** ชื่อตำแหน่งที่แสดงบนจอ (ภาษาไทยล้วน) */
export const ROLE_LABELS: Record<Role, string> = {
  host: "ส่วนกลาง",
  admin: "แอดมินเปิดงาน",
  recorder: "หัวหน้างาน",
  viewer: "ผู้บริหาร",
};

/** ตัวเลือกเดือนในแถบบน */
export type MonthOption = {
  /** ค่าที่ส่งกลับ เช่น `2026-10` (รูปแบบ YYYY-MM) */
  value: string;
  /** ข้อความที่แสดง เช่น `ตุลาคม 2026` */
  label: string;
};
