/**
 * /service — ลงข้อมูลทำบริการประจำเดือน (SPEC §8.1 หน้า 5 · mockup FINAL `docs/mockup/aga-bait-registry-prototype.html#service`)
 *
 * Logic summary:
 *   * สิทธิ์เข้าหน้า = host, recorder (ด่านที่ middleware.ts จากตารางเมนู · ที่นี่เช็กซ้ำเป็นด่านสำรอง)
 *   * server อ่านข้อมูลอ้างอิง (เขต/สาขา/ทีมบริการ+ติดตั้ง(teams.kind)/เกณฑ์ Tier) + รายชื่อสัญญาของเดือน/สาขาที่เลือก (`?zone=&branch=&month=`)
 *     ด้วย Supabase client ของผู้ใช้จริง (RLS ทำงาน · ไม่ใช้ service role) แล้วส่งให้ client component
 *   * อ่านข้อมูลไม่ได้ = หน้าแจ้งข้อผิดพลาดที่บอกชัด ไม่แสดงตัวเลขสมมติ
 *   * โหมดบันทึกบริการชดเชย (DECISIONS 2.96): `?contract=<uuid>&makeup=<YYYY-MM>` — ตรวจที่ server ว่าเดือนที่ตกยังค้างอยู่จริง (list_pending_missed_services)
 *     และบัญชีมีสิทธิ์ (host เสมอ · หัวหน้างานเฉพาะที่ยังไม่เลยเพดาน) ก่อนเปิดฟอร์ม · ไม่ผ่าน = หน้าแจ้งเหตุผล (ไม่ตกไปบันทึกเป็นบริการประจำเดือนธรรมดา)
 *     ค่าใน URL มีแต่ id/เดือน (PDPA) · ไม่มี query ชุดนี้ = หน้าทำงานเหมือนเดิมทุกอย่าง
 *   * รายละเอียดของแต่ละราย (สถานี/การเข้า/ผลตรวจ) โหลดตอนเลือกรายใน client — ดู components/service/ServiceClient.tsx
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { loadContractList, loadMakeupTarget, loadServiceMaster } from "@/components/service/data";
import { MAKEUP_BLOCK_MESSAGE, canRecordMakeup, parseMakeupParams, type MakeupBlockReason } from "@/components/service/makeup";
import { currentBangkokMonth, resolveMonth } from "@/lib/service/months";
import { ServiceClient } from "@/components/service/ServiceClient";
import { Alert } from "@/components/ui";
import { canAccessPath, homeForRole } from "@/lib/auth/access";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

export default async function ServicePage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: Param; branch?: Param; month?: Param; contract?: Param; makeup?: Param }>;
}) {
  const profile = await requireProfile();
  if (!canAccessPath(profile.role, "/service")) redirect(homeForRole(profile.role));

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

  // ---------- โหมดบันทึกบริการชดเชย ----------
  if (params.contract !== undefined || params.makeup !== undefined) {
    const target = parseMakeupParams(first(params.contract), first(params.makeup));
    if (!target) return <MakeupBlocked reason="not_found" />;
    const r = await loadMakeupTarget(supabase, target.contractId, target.missedMonth, currentMonth, master.zones, master.branches, master.tierRules);
    if (!r.ok) return <MakeupBlocked reason={r.reason} />;
    if (!canRecordMakeup(profile.role, r.pastDeadline)) return <MakeupBlocked reason="past_deadline" />;
    return (
      <div className="p-4 max-[640px]:p-3">
        <ServiceClient
          key={`makeup|${target.contractId}|${target.missedMonth}`}
          master={master}
          zoneId={r.zoneId}
          branchId={r.item.branchId}
          month={currentMonth}
          currentMonth={currentMonth}
          initialItems={[r.item]}
          truncated={false}
          makeup={{ missedMonth: target.missedMonth, deadlineMonth: r.deadlineMonth, pastDeadline: r.pastDeadline }}
        />
      </div>
    );
  }

  const zone = master.zones.find((z) => z.id === first(params.zone)) ?? master.zones[0];
  if (!zone) return null;
  const zoneBranches = master.branches.filter((b) => b.zoneId === zone.id);
  const branchParam = first(params.branch);
  const branch = zoneBranches.find((b) => b.id === branchParam);

  const list = await loadContractList(
    supabase,
    month,
    (branch ? [branch] : zoneBranches).map((b) => b.id),
    master.tierRules,
  );
  if (list.error) {
    return (
      <div className="p-4">
        <Alert variant="danger" title="อ่านรายชื่อสัญญาไม่ได้">
          โหลดสัญญาของเดือนนี้ไม่สำเร็จ ลองรีเฟรชหน้า หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 max-[640px]:p-3">
      <ServiceClient
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

/** หน้าแจ้งเหตุผลที่เปิดโหมดชดเชยไม่ได้ + ทางกลับ */
function MakeupBlocked({ reason }: { reason: MakeupBlockReason }) {
  const m = MAKEUP_BLOCK_MESSAGE[reason];
  return (
    <div className="p-4 max-[640px]:p-3">
      <Alert variant="warn" title={m.title}>
        {m.body}
      </Alert>
      <p className="mt-3">
        <Link
          href="/todo"
          className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface px-3 text-[13px] text-fg no-underline hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          กลับไปสถานะทะเบียนบริการ
        </Link>
      </p>
    </div>
  );
}
