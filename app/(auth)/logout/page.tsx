/**
 * หน้ายืนยันออกจากระบบ — ปุ่มในแถบบน (`logoutHref`) ชี้มาที่หน้านี้
 * การออกจากระบบจริงเป็น POST ไป server action (ดู `actions.ts` ว่าทำไมไม่ใช้ GET)
 */
import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentProfile } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/access";

import { PAGE_TITLE, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../ui";
import { logoutAction } from "./actions";

export const metadata: Metadata = {
  title: "ออกจากระบบ — AGA Bait Registry",
};

export default async function LogoutPage() {
  const profile = await getCurrentProfile();
  const backHref = profile ? homeForRole(profile.role) : "/login";

  return (
    <div className="flex flex-col gap-4">
      <h1 className={PAGE_TITLE}>ออกจากระบบ</h1>

      <p className="text-center text-[13px] leading-relaxed text-fg-muted">
        {profile
          ? `ออกจากระบบของ ${profile.displayName ?? profile.username} ใช่หรือไม่`
          : "ไม่พบการเข้าสู่ระบบ"}
      </p>

      <form action={logoutAction}>
        <button type="submit" className={PRIMARY_BUTTON}>
          ออกจากระบบ
        </button>
      </form>

      <Link href={backHref} className={`${SECONDARY_BUTTON} block text-center`}>
        กลับหน้าเดิม
      </Link>
    </div>
  );
}
