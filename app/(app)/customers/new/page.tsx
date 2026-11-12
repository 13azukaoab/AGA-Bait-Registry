/**
 * /customers/new — เปิดงานเข้าทะเบียนบริการ (SPEC §8 จอ "เปิดงาน" · mockup FINAL `docs/mockup/admin-add-customer.html`)
 *
 * Logic summary:
 *   * สิทธิ์เข้าหน้า = host, admin (ด่านที่ middleware.ts จากตารางเมนู) · ที่นี่เช็กซ้ำเป็นด่านสำรอง
 *   * server อ่านข้อมูลอ้างอิง (สาขา/เขต/ทีม/ประเภทลูกค้า/เกณฑ์ Tier) + สัญญาที่เริ่มในเดือน `?month=YYYY-MM`
 *     ด้วย Supabase client ของผู้ใช้จริง (RLS ทำงาน · ไม่ใช้ service role) แล้วส่งให้ client component
 *   * อ่านข้อมูลไม่ได้ (เช่น ฐานข้อมูลล่ม) = หน้าแจ้งข้อผิดพลาดที่บอกชัด ไม่แสดงตัวเลขสมมติ
 *   * ช่องที่ schema ยังไม่มี 6 ช่อง ซ่อนไว้ — ดู components/customers-new/config.ts
 */
import { redirect } from "next/navigation";

import { NewContractsClient } from "@/components/customers-new/NewContractsClient";
import { loadMasterData, loadMonthContracts } from "@/components/customers-new/data";
import { currentBangkokMonth, monthChoices, resolveMonth } from "@/components/customers-new/months";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/customers/new")) redirect(homeForRole(profile.role));

  const params = await searchParams;
  const rawMonth = Array.isArray(params.month) ? params.month[0] : params.month;
  const current = currentBangkokMonth();
  const month = resolveMonth(rawMonth, current);

  const supabase = await createClient();
  const [{ master, error: masterError }, month_] = await Promise.all([
    loadMasterData(supabase),
    loadMonthContracts(supabase, month, profile.role),
  ]);

  if (!master || masterError) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านข้อมูลอ้างอิงไม่ได้">
          โหลดรายชื่อสาขา/ทีม/เกณฑ์ Tier ไม่สำเร็จ จึงยังเปิดหน้านี้ไม่ได้ ลองรีเฟรชหน้า
          หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
        </Alert>
      </div>
    );
  }
  if (master.tierRules.length === 0 || master.branches.length === 0) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="ข้อมูลอ้างอิงยังไม่ครบ">
          ไม่พบรายชื่อสาขาหรือเกณฑ์ Tier ในระบบ — แจ้งผู้ดูแลระบบให้ตรวจตาราง branches / tier_rules
        </Alert>
      </div>
    );
  }
  if (month_.error) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านรายการสัญญาไม่ได้">
          โหลดสัญญาของเดือนนี้ไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 max-[640px]:p-3">
      <NewContractsClient
        role={profile.role}
        month={month}
        monthChoices={monthChoices(current)}
        master={master}
        saved={month_.rows}
        truncated={month_.truncated}
      />
    </div>
  );
}
