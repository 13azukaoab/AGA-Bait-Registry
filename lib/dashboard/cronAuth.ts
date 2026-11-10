/**
 * ตรวจสิทธิ์การเรียก endpoint ของ Auto Sync (SPEC §9.2)
 *
 * Vercel Cron แนบ header `Authorization: Bearer <CRON_SECRET>` มาให้ทุกครั้ง
 * กฎที่สำคัญ: **ไม่ได้ตั้ง `CRON_SECRET` = ปฏิเสธทุกคำขอ (fail closed)**
 * ถ้าปล่อยผ่านเมื่อไม่มี secret คนนอกจะยิง endpoint ให้ระบบ commit ขึ้น repo Dashboard ได้
 */
export function isAuthorizedCronRequest(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret) return false; // ไม่มี secret = ปฏิเสธเสมอ
  if (!authorizationHeader) return false;
  return authorizationHeader === `Bearer ${secret}`;
}
