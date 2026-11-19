/**
 * /admin/history — ประวัติการแก้ไข (SPEC §8.2 · หน้า 15 · mockup FINAL `docs/mockup/history-log.html`)
 *
 * Logic summary:
 *   * เฉพาะ host — ด่านที่ middleware (กลุ่ม /admin) + ตรวจซ้ำที่นี่ (role ต้องเป็น host เท่านั้น ไม่ใช่แค่ผ่านกลุ่ม /admin)
 *     และ RLS ของ `audit_log` อนุญาต host อ่านเท่านั้นอีกชั้น · recorder เห็น "แก้หลังปิด" ได้ที่หน้าปิดเดือน ไม่ใช่หน้านี้
 *   * server โหลดข้อมูลอ้างอิง (สาขา/เขต, ผู้ใช้, ตำแหน่ง, สถานะปิดเดือน) ครั้งเดียว · ตัวรายการโหลดต่อใน client แบบ keyset
 *   * ตัวกรองเริ่มต้นอ่านจาก query string — เฉพาะ id / enum / วันที่ (ค่าผิดรูปแบบถูกทิ้ง) · ไม่มีข้อความอิสระใน URL (PDPA)
 *   * อ่านข้อมูลอ้างอิงไม่ได้ = หน้าแจ้งข้อผิดพลาด (ไม่แสดงเหมือนไม่มีประวัติ)
 */
import { redirect } from "next/navigation";

import { HistoryClient } from "@/components/history/HistoryClient";
import { loadContractInfos, loadHistoryRefs } from "@/components/history/historyData";
import { filtersFromParams } from "@/components/history/historyFilters";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { todayBangkok } from "@/lib/service/months";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminHistoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/admin/history") || profile.role !== "host") redirect(homeForRole(profile.role));

  const supabase = await createClient();
  const refs = await loadHistoryRefs(supabase);
  if (!refs.ok) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="เปิดหน้าประวัติการแก้ไขไม่ได้">
          โหลดรายชื่อสาขา/ผู้ใช้/สถานะปิดเดือนไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ (รหัส {refs.code})
        </Alert>
      </div>
    );
  }

  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === "string") params.set(k, val);
  }
  const todayYmd = todayBangkok();
  const initialFilters = filtersFromParams(params, todayYmd);

  let initialContract = null;
  if (initialFilters.contractId) {
    const c = await loadContractInfos(supabase, [initialFilters.contractId]);
    initialContract = c.ok ? (c.data[0] ?? null) : null;
  }

  return (
    <div className="p-4 max-[640px]:p-3">
      <HistoryClient refs={refs.data} todayYmd={todayYmd} initialFilters={initialFilters} initialContract={initialContract} />
    </div>
  );
}
