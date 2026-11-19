/**
 * /material — สรุปงานบริการรายเดือน (mockup FINAL `#material` + DECISIONS 2.88 / 2.89 / 2.90)
 *
 * Logic summary:
 *   * สิทธิ์เข้าหน้า = host, admin, recorder (ด่านที่ middleware.ts จากตารางเมนู · ที่นี่เช็กซ้ำเป็นด่านสำรอง) · viewer เด้งกลับหน้าแรก
 *   * server โหลดข้อมูลด้วย Supabase client ของผู้ใช้จริง (RLS · ไม่ใช้ service role) ผ่าน components/material/materialData.ts
 *     → admin เห็นเฉพาะส่วนงานที่ RLS ให้ · ไม่มีชื่อลูกค้าในหน้านี้ (PDPA)
 *   * `?month=YYYY-MM&branch=<uuid>&tab=mat|team` — ค่าที่ไม่ถูกต้องถอยกลับเป็นค่าเริ่มต้น (ไม่ error)
 *   * อ่านพลาด = แสดงข้อความไทยทั่วไป · log เฉพาะรหัสสั้น ไม่ log ข้อมูล
 */
import { redirect } from "next/navigation";

import { MaterialPage, type MaterialTab } from "@/components/material/MaterialPage";
import { loadMaterialPage } from "@/components/material/materialData";
import { buildMaterialView } from "@/components/material/viewModel";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { currentBangkokMonth, resolveMonth } from "@/lib/service/months";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

export default async function MaterialRoute({
  searchParams,
}: {
  searchParams: Promise<{ month?: Param; branch?: Param; tab?: Param }>;
}) {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/material")) redirect(homeForRole(profile.role));

  const params = await searchParams;
  const currentMonth = currentBangkokMonth();
  const month = resolveMonth(first(params.month), currentMonth);
  const tab: MaterialTab = first(params.tab) === "team" ? "team" : "mat";

  const supabase = await createClient();
  const { data, error } = await loadMaterialPage(supabase, month);

  if (!data || error) {
    console.error("[material] load failed");
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านข้อมูลหน้านี้ไม่ได้">
          โหลดสรุปงานบริการรายเดือนไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
        </Alert>
      </div>
    );
  }

  const wanted = first(params.branch);
  const branchId = wanted && data.branches.some((b) => b.id === wanted) ? wanted : null;
  const view = buildMaterialView(data, branchId);

  return <MaterialPage data={data} view={view} tab={tab} branchId={branchId} currentMonth={currentMonth} />;
}
