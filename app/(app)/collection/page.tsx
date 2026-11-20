/**
 * /collection — ลูกค้ารอเก็บสถานี (SPEC §7.8 · §8 จอ 14 · DECISIONS 2.42 / 2.50 · mockup FINAL #collect)
 *
 * Logic summary:
 *   * host + recorder บันทึกได้ · admin ดูอย่างเดียว · viewer เข้าไม่ได้ — ด่านที่ middleware (สิทธิ์ตามเมนู nav-items.ts)
 *     + ตรวจซ้ำที่นี่ด้วย canAccessPath (ไม่ผ่านเด้งกลับหน้าแรกของตน) · สิทธิ์จริงอยู่ที่ RLS + RPC ใน DB
 *   * server โหลดสัญญาที่หมดแล้วด้วย client ของผู้ใช้จริง (ไม่ใช้ service role) แล้วส่งให้ CollectionClient
 *   * อ่านพลาด = หน้าแจ้งผิดพลาดภาษาไทย (แสดงแค่รหัส ไม่แสดงตัวเลขสมมติ)
 *   * ⚠ PDPA: มีชื่อลูกค้า — ห้าม console.log ข้อมูล · error log ได้แค่ code
 */
import { redirect } from "next/navigation";

import { loadCollection } from "@/components/collection/collectionData";
import { CollectionClient } from "@/components/collection/CollectionClient";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { currentBangkokMonth, todayBangkok } from "@/lib/service/months";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CollectionPage() {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/collection")) redirect(homeForRole(profile.role));

  const supabase = await createClient();
  const result = await loadCollection(supabase, { today: todayBangkok(), currentMonth: currentBangkokMonth() });

  if (!result.ok) {
    console.error("[collection] load error code", result.code);
    return (
      <div className="p-4">
        <Alert variant="danger" title="เปิดหน้าลูกค้ารอเก็บสถานีไม่ได้">
          โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ (รหัส {result.code})
        </Alert>
      </div>
    );
  }

  return (
    <CollectionClient
      rows={result.rows}
      teams={result.teams}
      held={result.held}
      truncated={result.truncated}
      role={profile.role}
      divisionScope={profile.divisionScope}
      currentMonth={currentBangkokMonth()}
      today={todayBangkok()}
    />
  );
}
