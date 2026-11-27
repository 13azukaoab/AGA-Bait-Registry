-- =====================================================================
-- SEC-05 (ผลตรวจความปลอดภัย 27 พ.ย. 2026 · DECISIONS 2.109 "หลัง go-live")
-- contract_month_paused(): เปลี่ยนด่านจาก denylist ("ไม่ใช่ viewer") เป็น allowlist
--
-- ปัญหาเดิม (20261115300001_contract_pause.sql:130):
--   `current_app_role() IS DISTINCT FROM 'viewer'` — ค่า NULL (ล็อกอินแต่ไม่มีโปรไฟล์ /
--   บัญชีถูกปิด is_active = false) ผ่านเงื่อนไข → ถามได้ว่าสัญญา id นี้พักเดือนนี้ไหม
--
-- ด่านใหม่ — ตอบผลจริงเมื่อเข้าข้อใดข้อหนึ่ง (ไม่เข้า = false เสมอ · ไม่ raise เหมือนเดิม):
--   1) ผู้ใช้ตำแหน่งพนักงาน: current_app_role() IN ('host','admin','recorder')
--   2) บริบทของระบบ (ไม่ใช่คำขอของผู้ใช้ปลายทาง): role ของ session ไม่ใช่ `authenticated` / `anon`
--      และ JWT ไม่ได้บอกว่าเป็น `authenticated` / `anon`
--        - service_role (cron, สคริปต์นำเข้า ผ่าน PostgREST) → role = 'service_role'
--        - ต่อฐานข้อมูลตรงด้วย postgres (migration, seed, pgTAP ตอนเตรียมข้อมูล) → role = 'none'
--      ต้องมีข้อนี้เพราะ trigger ที่เรียกฟังก์ชันนี้ (visits_pause_guard → CP009,
--      missed_resolutions_pause_origin / missed_notes_pause_guard → CP012) และ
--      central_unready_branches (เรียกจาก close_month_part ทั้งโดย host และ service_role)
--      ต้องเห็นเดือนที่พักจริง ไม่งั้นด่านจะหลุดเงียบๆ ตอนนำเข้าข้อมูล/ปิดเดือนอัตโนมัติ
--   หมายเหตุ: current_setting('role') ไม่เปลี่ยนตอนเข้า SECURITY DEFINER (เปลี่ยนแค่ current_user)
--   และ current_app_role() อ่าน auth.uid() จาก JWT → ผู้เรียกที่เป็น DEFINER ยังเห็น role ของคนเรียกจริง
--   (แพทเทิร์นเดียวกับ start_sync_log / close_month_part · 20261115250000 · 20261115270000)
--
-- ผลต่อพฤติกรรม: แคบลงอย่างเดียว — เปลี่ยนเฉพาะ "ล็อกอินเป็น authenticated แต่ role = NULL" (false แทนผลจริง)
--   viewer = false เหมือนเดิม · host/admin/recorder/service_role/postgres = ผลจริงเหมือนเดิม
-- signature / return / SECURITY DEFINER / search_path / สิทธิ์ EXECUTE เหมือนเดิมทุกอย่าง
-- ตรงกับ lib/rules/pause.ts `isPausedMonth` (สูตรเดือนไม่เปลี่ยน)
-- เทส: supabase/tests/62_contract_month_paused_allowlist.test.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION public.contract_month_paused(p_contract_id uuid, p_month date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM contract_pauses p
     WHERE p.contract_id = p_contract_id
       AND p.paused_month <= date_trunc('month', p_month::timestamp)::date
       AND (p.resume_month IS NULL OR date_trunc('month', p_month::timestamp)::date < p.resume_month)
       -- SEC-05: allowlist ตำแหน่งพนักงาน · หรือบริบทของระบบ (service_role / postgres ไม่มีคำขอของผู้ใช้)
       AND (current_app_role() IN ('host', 'admin', 'recorder')
            OR (coalesce(nullif(current_setting('role', true), ''), 'none') NOT IN ('authenticated', 'anon')
                AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon'))))
$$;

COMMENT ON FUNCTION public.contract_month_paused(uuid, date) IS
  'M29 + SEC-05: true when the contract is paused in the month. Real answer only for host/admin/recorder or system context (service_role / direct postgres); any other end-user caller (viewer, no profile, deactivated) always gets false.';

REVOKE ALL ON FUNCTION public.contract_month_paused(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_month_paused(uuid, date) TO authenticated, service_role;
