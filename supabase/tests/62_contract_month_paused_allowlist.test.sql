-- SEC-05 (20261115360000): contract_month_paused() เป็น allowlist — DECISIONS 2.109 (หลัง go-live)
--   * ยังเป็น SECURITY DEFINER + search_path เดิม · สิทธิ์ EXECUTE เดิม (anon ไม่ได้ · authenticated/service_role ได้)
--   * บริบทของระบบได้ผลจริง: postgres ไม่มี JWT (migration/seed) · service_role (cron/นำเข้า)
--     → ด่าน routine ช่วงพัก (CP009) ของ visits_pause_guard ยังทำงานตอนนำเข้า
--   * host / admin / recorder ได้ผลจริง
--   * viewer / ล็อกอินแต่ไม่มีโปรไฟล์ / บัญชีถูกปิด (is_active = false) → false เสมอ (จุดที่ SEC-05 ปิด)
--   * ผู้เรียกจริง: list_pending_missed_services (recorder) ยังไม่นับเดือนที่พักเป็นตกบริการ
-- ข้อมูลสมมติทั้งหมด (ไม่ใช่ข้อมูลลูกค้าจริง)
BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'noprofile@test.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'disabled@test.local');
-- a6 ไม่มีแถวใน profiles (current_app_role() = NULL) · a7 มีโปรไฟล์แต่ถูกปิด (current_app_role() = NULL)
INSERT INTO profiles (user_id, display_name, username, role, division_scope, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}', true),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}',          true),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}',          true),
  ('00000000-0000-0000-0000-0000000000a5', 'viewer',   'user_a5', 'viewer',   '{central}',          true),
  ('00000000-0000-0000-0000-0000000000a7', 'disabled', 'user_a7', 'recorder', '{central}',          false);

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || p, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;
-- ล้างผู้ใช้ใน JWT (set_config(..., true) อยู่ข้าม RESET ROLE ได้ จึงต้องล้างเอง)
CREATE FUNCTION pg_temp.no_user() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '', true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.no_user() TO PUBLIC;
CREATE FUNCTION pg_temp.paused(p_c text, p_month date) RETURNS boolean LANGUAGE sql AS
  $$ SELECT public.contract_month_paused(pg_temp.id(p_c), p_month) $$;
GRANT EXECUTE ON FUNCTION pg_temp.paused(text, date) TO PUBLIC;
CREATE FUNCTION pg_temp.pending(p_c text, p_month date) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.list_pending_missed_services()
                  WHERE contract_id = pg_temp.id(p_c) AND missed_month = p_month)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.pending(text, date) TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Allowlist Alpha (สมมติ)');

-- d1 พักตั้งแต่ m(-2) (ยังพักอยู่) · d2 เทียบ (ไม่พัก · ไม่มีการเข้า → m(-1) เป็นตกบริการ)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at, status) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'AL-1', pg_temp.m(-6), 12, 24000, pg_temp.m(-6) + 2, 'active'),
  (pg_temp.id('d2'), pg_temp.id('c1'), 'AL-2', pg_temp.m(-6), 12, 24000, pg_temp.m(-6) + 2, 'active');

-- =====================================================================
-- โครงสร้าง: DEFINER + search_path + สิทธิ์เดิม
-- =====================================================================
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.contract_month_paused(uuid, date)'::regprocedure)
          AND (SELECT 'search_path=public, pg_temp' = ANY (proconfig)
                 FROM pg_proc WHERE oid = 'public.contract_month_paused(uuid, date)'::regprocedure),
  'contract_month_paused stays SECURITY DEFINER with search_path = public, pg_temp');
SELECT ok(NOT has_function_privilege('anon', 'public.contract_month_paused(uuid, date)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.contract_month_paused(uuid, date)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.contract_month_paused(uuid, date)', 'EXECUTE'),
  'grants unchanged: anon no · authenticated and service_role yes');

-- host พักสัญญา d1 ย้อนหลังตั้งแต่ m(-2)
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok(format('SELECT public.pause_contract(%L, %L, %L)', pg_temp.id('d1'), pg_temp.m(-2) + 9, 'ค้างชำระ (สมมติ)'),
  'test setup: host pauses d1 from month -2');
RESET ROLE;
SELECT pg_temp.no_user();

-- =====================================================================
-- บริบทของระบบ (ต้องได้ผลจริง ไม่งั้นด่านในการนำเข้า/ปิดเดือนอัตโนมัติหลุด)
-- =====================================================================
SELECT ok(pg_temp.paused('d1', pg_temp.m(0)) AND pg_temp.paused('d1', pg_temp.m(-2))
          AND NOT pg_temp.paused('d1', pg_temp.m(-3)) AND NOT pg_temp.paused('d2', pg_temp.m(0)),
  'postgres without a JWT (migration / seed) gets the real answer');
SELECT throws_ok($$INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time)
                   VALUES (pg_temp.id('d1'), pg_temp.m(-1) + 3, 'routine', '09:00', '10:00')$$,
  'CP009', NULL, 'postgres: routine visit in a paused month is still refused (visits_pause_guard)');

SET LOCAL ROLE service_role;
SELECT ok(pg_temp.paused('d1', pg_temp.m(0)) AND NOT pg_temp.paused('d1', pg_temp.m(-3)),
  'service_role (cron / import) gets the real answer');
SELECT throws_ok($$INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time)
                   VALUES (pg_temp.id('d1'), pg_temp.m(-1) + 4, 'routine', '09:00', '10:00')$$,
  'CP009', NULL, 'service_role import: routine visit in a paused month is still refused');
RESET ROLE;

-- =====================================================================
-- ผู้ใช้ปลายทาง (authenticated): allowlist host / admin / recorder
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT ok(pg_temp.paused('d1', pg_temp.m(0)), 'host gets the real answer');
SELECT pg_temp.as_user('a2');
SELECT ok(pg_temp.paused('d1', pg_temp.m(0)), 'admin gets the real answer');
SELECT pg_temp.as_user('a3');
SELECT ok(pg_temp.paused('d1', pg_temp.m(0)), 'recorder gets the real answer');
SELECT pg_temp.as_user('a5');
SELECT ok(NOT pg_temp.paused('d1', pg_temp.m(0)), 'viewer always gets false (unchanged)');
SELECT pg_temp.as_user('a6');
SELECT ok(NOT pg_temp.paused('d1', pg_temp.m(0)), 'SEC-05: logged-in user without a profile gets false');
SELECT pg_temp.as_user('a7');
SELECT ok(NOT pg_temp.paused('d1', pg_temp.m(0)), 'SEC-05: deactivated account (is_active = false) gets false');

-- ผู้เรียกจริง: รายการตกบริการของ recorder ยังไม่นับเดือนที่พัก (d2 ไม่พัก → ยังนับ)
SELECT pg_temp.as_user('a3');
SELECT ok(NOT pg_temp.pending('d1', pg_temp.m(-1)) AND pg_temp.pending('d2', pg_temp.m(-1)),
  'caller path: list_pending_missed_services (recorder) skips the paused month but keeps the unpaused contract');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
