/**
 * หน้าเปลี่ยนรหัสผ่าน — บัญชีใหม่หรือบัญชีที่ host รีเซ็ตให้จะถูกบังคับมาหน้านี้ก่อน
 * เข้าหน้าอื่นได้ (`middleware.ts` + `profiles.must_change_password` · SPEC §6)
 */
import type { Metadata } from "next";

import { requireProfile } from "@/lib/auth/session";

import { ALERT_INFO, PAGE_HELP, PAGE_TITLE } from "../ui";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = {
  title: "เปลี่ยนรหัสผ่าน — AGA Bait Registry",
};

export default async function ChangePasswordPage() {
  const profile = await requireProfile();
  const who = [profile.displayName ?? profile.username, profile.positionName]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <h1 className={PAGE_TITLE}>
        {profile.mustChangePassword ? "ตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน" : "เปลี่ยนรหัสผ่าน"}
      </h1>

      <p className={ALERT_INFO} role="status">
        {profile.mustChangePassword
          ? "บัญชีนี้ยังใช้รหัสผ่านที่ Host ตั้งให้ ต้องตั้งรหัสผ่านใหม่ก่อนเข้าใช้งานหน้าอื่น"
          : "ตั้งรหัสผ่านใหม่สำหรับบัญชีนี้"}
        <br />
        <span className="text-fg">{who}</span>
      </p>

      <ChangePasswordForm />

      <p className={PAGE_HELP}>
        จำรหัสผ่านใหม่ไม่ได้ ต้องให้ <b>Host (QCS ส่วนกลาง Bait)</b> รีเซ็ตให้ —
        ระบบไม่มีการรีเซ็ตรหัสผ่านทางอีเมล
      </p>
    </div>
  );
}
