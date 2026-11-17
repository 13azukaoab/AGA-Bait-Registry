/**
 * /customers/[id] — รายละเอียดลูกค้า (SPEC §8 หน้า 4 · mockup FINAL `docs/mockup/customer-detail.html`)
 *
 * Logic summary:
 *   * สิทธิ์เข้าหน้า = host, admin, recorder (ด่านที่ middleware จากตารางเมนู `/customers` · ที่นี่เช็กซ้ำเป็นด่านสำรอง)
 *     viewer เข้าไม่ได้ (PDPA — มีชื่อ/ที่อยู่/เบอร์ลูกค้า) · RLS ที่ฐานข้อมูลเป็นด่านจริง
 *   * `[id]` ต้องเป็น UUID ไม่งั้น 404 ทันที (ไม่ยิงฐานข้อมูลด้วยค่าแปลกๆ)
 *   * server โหลดข้อมูลทั้งหมดด้วย Supabase client ของผู้ใช้จริง (RLS · ไม่ใช้ service role) ผ่าน components/customer-detail/data.ts
 *   * ไม่พบ/ไม่มีสิทธิ์อ่านลูกค้ารายนี้ = 404 · อ่านพลาด = แสดงข้อความชัดเจน ไม่แสดงตัวเลขสมมติ · ไม่ log ข้อมูลลูกค้า
 *   * ลิงก์เจาะจงจากหน้าอื่น: ?tab=&contract=&station=&status=&type= (ไม่ใส่ข้อมูลลูกค้าใน URL)
 */
import { notFound, redirect } from "next/navigation";

import { CustomerDetailClient, type InitialView } from "@/components/customer-detail/CustomerDetailClient";
import { loadCustomerDetail } from "@/components/customer-detail/data";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Param = string | string[] | undefined;
const first = (p: Param): string | undefined => (Array.isArray(p) ? p[0] : p);

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: Param; contract?: Param; station?: Param; status?: Param; type?: Param }>;
}) {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/customers")) redirect(homeForRole(profile.role));

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;

  const supabase = await createClient();
  const { data, notFound: missing, error } = await loadCustomerDetail(supabase, { customerId: id, role: profile.role, myTeamId: profile.teamId });
  if (missing) notFound();

  if (!data || error) {
    console.error("[customer-detail] load error");
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านข้อมูลหน้านี้ไม่ได้">
          โหลดรายละเอียดลูกค้าไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
        </Alert>
      </div>
    );
  }

  const initial: InitialView = {
    tab: first(sp.tab),
    contract: first(sp.contract),
    station: first(sp.station),
    status: first(sp.status),
    type: first(sp.type),
  };
  return <CustomerDetailClient data={data} initial={initial} />;
}
