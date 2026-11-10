/**
 * SPEC §8 จอ 1 — เข้าสู่ระบบ (host / admin / recorder)
 * viewer (ผู้บริหาร) ไม่ต้องล็อกอิน เปิดหน้าสรุป public (`/summary`) ดูได้เลย
 *
 * หน้านี้เป็น server component: อ่านเหตุผลที่ถูกเด้งมา (`?reason=`) และปลายทางที่ขอไว้
 * (`?next=`) แล้วส่งต่อให้ฟอร์มฝั่ง client — การตรวจรหัสผ่านอยู่ใน `actions.ts`
 */
import type { Metadata } from "next";

import { ALERT_INFO, PAGE_HELP, PAGE_TITLE } from "../ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบ — AGA Bait Registry",
};

/** เหตุผลที่ middleware เด้งผู้ใช้กลับมาหน้านี้ */
const REASON_MESSAGES: Record<string, string> = {
  disabled: "บัญชีนี้ถูกปิดการใช้งาน ติดต่อ Host (QCS ส่วนกลาง Bait)",
  "no-profile": "บัญชีนี้ยังไม่ได้ตั้งค่าในระบบ ติดต่อ Host (QCS ส่วนกลาง Bait)",
  "signed-out": "ออกจากระบบแล้ว",
};

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = firstValue(params.next);
  const notice = REASON_MESSAGES[firstValue(params.reason)] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className={PAGE_TITLE}>เข้าสู่ระบบ</h1>

      {notice ? (
        <p className={ALERT_INFO} role="status">
          {notice}
        </p>
      ) : null}

      <LoginForm next={next} />

      <p className={PAGE_HELP}>
        ลืมรหัสผ่านหรือยังไม่มีบัญชี? ติดต่อ <b>Host (QCS ส่วนกลาง Bait)</b>{" "}
        เพื่อรีเซ็ตหรือสร้างบัญชีให้
      </p>
    </div>
  );
}
