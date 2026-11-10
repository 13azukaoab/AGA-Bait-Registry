/** รวมชื่อ class — ข้ามค่าที่เป็น false/null/undefined (ไม่เพิ่ม dependency) */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
