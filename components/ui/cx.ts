/**
 * cx — รวมชื่อ class เข้าด้วยกัน (ข้ามค่าที่เป็น false/null/undefined)
 * ใช้ภายในชิ้นส่วน UI แทนการลงไลบรารี clsx
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
