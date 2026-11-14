/**
 * /bait — กล่อง AG นอกรอบประจำเดือน (mockup FINAL `docs/mockup/aga-bait-registry-prototype.html#bait` · DECISIONS 2.37, 2.38)
 *
 * Logic summary:
 *   * สิทธิ์เข้าหน้า = host, recorder (ด่านที่ middleware.ts จากตารางเมนู · ที่นี่เช็กซ้ำเป็นด่านสำรอง) · admin เด้งกลับหน้าแรกของตัวเอง
 *   * server อ่านข้อมูลอ้างอิง + รายชื่อสัญญาของเดือน/สาขาที่เลือก (`?zone=&branch=&month=`) ด้วย Supabase client ของผู้ใช้จริง
 *     (RLS ทำงาน · ไม่ใช้ service role) — ชุดเดียวกับ /service แต่รวมสัญญาที่หมดช่วงบริการแล้วแต่ยังมีกล่อง AG ค้าง
 *   * บันทึกผ่าน `save_service_visit` โดยตั้ง `visit_type = follow_up` เอง — ดู components/bait/BaitClient.tsx
 *   * อ่านข้อมูลไม่ได้ = หน้าแจ้งข้อผิดพลาดที่บอกชัด ไม่แสดงตัวเลขสมมติ
 */
import { redirect } from "next/navigation";

import { BaitClient } from "@/components/bait/BaitClient";
import { loadContractList, loadServiceMaster } from "@/components/service/data";
import { currentBangkokMonth, resolveMonth } from "@/components/service/months";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

export default async function BaitPage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: Param; branch?: Param; month?: Param }>;
}) {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/bait")) redirect(homeForRole(profile.role));

  const params = await searchParams;
  const currentMonth = currentBangkokMonth();
  const month = resolveMonth(first(params.month), currentMonth);

  const supabase = await createClient();
  const { master, error } = await loadServiceMaster(supabase);

  if (!master || error) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านข้อมูลอ้างอิงไม่ได้">
          โหลดรายชื่อเขต/สาขา/ทีม/เกณฑ์ Tier ไม่สำเร็จ จึงยังเปิดหน้านี้ไม่ได้ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
        </Alert>
      </div>
    );
  }
  if (master.zones.length === 0 || master.branches.length === 0 || master.tierRules.length === 0) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="ข้อมูลอ้างอิงยังไม่ครบ">
          ไม่พบเขต สาขา หรือเกณฑ์ Tier ในระบบ — แจ้งผู้ดูแลระบบให้ตรวจตาราง zones / branches / tier_rules
        </Alert>
      </div>
    );
  }

  const zone = master.zones.find((z) => z.id === first(params.zone)) ?? master.zones[0];
  if (!zone) return null;
  const zoneBranches = master.branches.filter((b) => b.zoneId === zone.id);
  const branch = zoneBranches.find((b) => b.id === first(params.branch));

  const list = await loadContractList(
    supabase,
    month,
    (branch ? [branch] : zoneBranches).map((b) => b.id),
    master.tierRules,
    { includeAgOutsideMonth: true },
  );
  if (list.error) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านรายชื่อสัญญาไม่ได้">
          โหลดสัญญาไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 max-[640px]:p-3">
      <BaitClient
        key={`${zone.id}|${branch?.id ?? ""}|${month}`}
        master={master}
        zoneId={zone.id}
        branchId={branch?.id ?? ""}
        month={month}
        currentMonth={currentMonth}
        initialItems={list.items}
        truncated={list.truncated}
      />
    </div>
  );
}
