/**
 * /customers — ทะเบียนลูกค้า/สัญญา (SPEC §8 จอ 3 · mockup FINAL docs/mockup/aga-bait-registry-prototype.html `#registry`)
 *
 * Logic summary:
 *   * เฉพาะ host / admin / recorder — ด่านที่ middleware (สิทธิ์ตามเมนูใน nav-items.ts) + ตรวจซ้ำที่นี่ด้วย canAccessPath
 *     viewer ห้ามเข้า (PDPA — มีชื่อลูกค้า) เด้งกลับหน้าแรกของตน · ด่านจริงคือ RLS ที่ฐานข้อมูล
 *     RLS ให้ host/admin/recorder อ่านสัญญาได้ทุกสาขาโดยตั้งใจ (M21)
 *   * server โหลดข้อมูลอ้างอิง (สาขา/เขต + เกณฑ์ Tier) + หน้าแรก 1 หน้า (50 แถว · keyset) ด้วย Supabase client ของผู้ใช้จริง
 *     (ไม่ใช้ service role) แล้วส่งให้ RegistryClient · ตัวกรองเริ่มต้นอ่านจาก URL (เฉพาะ id/enum — ไม่มีคำค้น)
 *   * อ่านพลาด = หน้าแจ้งข้อผิดพลาดเป็นภาษาไทย (แสดงแค่รหัส ไม่แสดงตัวเลขสมมติ)
 *   * ⚠ PDPA: มีชื่อลูกค้า — ห้าม console.log ข้อมูล · error log ได้แค่ code
 */
import { redirect } from "next/navigation";

import { RegistryClient } from "@/components/customers/RegistryClient";
import { loadRegistryPage, loadRegistryRefs, todayBangkok } from "@/components/customers/registryData";
import { filtersFromParams } from "@/components/customers/registryFilters";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, Param>> }) {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/customers")) redirect(homeForRole(profile.role));

  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (first !== undefined) params.set(k, first);
  }
  const filters = filtersFromParams(params);

  const supabase = await createClient();
  const today = todayBangkok();
  const refs = await loadRegistryRefs(supabase);
  const page = refs.ok ? await loadRegistryPage(supabase, { refs: refs.data, today }, filters, "", null) : null;

  if (!refs.ok || !page || !page.ok) {
    const code = !refs.ok ? refs.code : page && !page.ok ? page.code : "UNKNOWN";
    console.error("[customers] load error code", code);
    return (
      <div className="p-4">
        <Alert variant="danger" title="เปิดทะเบียนลูกค้า/สัญญาไม่ได้">
          โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ (รหัส {code})
        </Alert>
      </div>
    );
  }

  return <RegistryClient role={profile.role} today={today} refs={refs.data} initialFilters={filters} initial={page.data} />;
}
