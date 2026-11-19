-- DECISIONS 2.90 (20261115320000): material_usage_summary(p_month, p_branch_id)
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon + request.jwt.claim.sub
-- ตัวเลขวัสดุในไฟล์นี้เป็น **ข้อมูลสมมติ** ใช้ทดสอบเท่านั้น
BEGIN;
SELECT plan(26);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'noprofile@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer',   'user_a4', 'viewer',   '{central}');

CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || p, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;
-- สรุปแถวเป็นข้อความ รูปแบบ group/sale:visits,outside,inside,powder_pts,powder_g,timber,install
CREATE FUNCTION pg_temp.rows(p_branch uuid DEFAULT NULL) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT coalesce(string_agg(s.work_group || '/' || s.sale_type || ':' || s.visit_count || ',' || s.bait_outside_g || ','
                                || s.bait_inside_g || ',' || s.powder_points || ',' || s.powder_g || ',' || s.timber_pcs || ','
                                || s.install_bait_g, ' ; ' ORDER BY s.work_group, s.sale_type, s.bait_outside_g DESC), '')
       FROM public.material_usage_summary(pg_temp.m(-1), p_branch) s $$;
GRANT EXECUTE ON FUNCTION pg_temp.rows(uuid) TO PUBLIC;

-- สาขา: central / province (สาขาแรกของแต่ละส่วนงาน)
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT b.id FROM branches b WHERE b.division = 'central' ORDER BY b.name LIMIT 1), 'Central'),
  ('00000000-0000-0000-0000-0000000000c2', (SELECT b.id FROM branches b WHERE b.division = 'province' ORDER BY b.name LIMIT 1), 'Province');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'MU-1', pg_temp.m(-6), 12, 50000, 'new',   now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'MU-3', pg_temp.m(-6), 12, 50000, 'renew', now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', 'MU-2', pg_temp.m(-6), 12, 50000, 'new',   now());
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', 'IG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', 'AG', 2, 'active'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d1', 'IC', 3, 'active'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d3', 'IG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000d2', 'IG', 1, 'active');
INSERT INTO visits (id, contract_id, visit_date, visit_type, makeup_for_month, start_time, end_time) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', pg_temp.m(-1) + 0, 'routine',   NULL,          '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', pg_temp.m(-1) + 1, 'routine',   pg_temp.m(-2), '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', pg_temp.m(-1) + 2, 'problem',   NULL,          '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', pg_temp.m(-1) + 3, 'follow_up', NULL,          '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d3', pg_temp.m(-1) + 4, 'routine',   NULL,          '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000d2', pg_temp.m(-1) + 5, 'routine',   NULL,          '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000d1', pg_temp.m(-2) + 5, 'routine',   NULL,          '09:00', '10:00');
INSERT INTO station_checks (visit_id, station_id, checked, bait_added_g, powder_points, timber_replaced) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', true, 100, 0, false),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', true,  40, 0, false),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f3', true,   0, 2, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f1', true,  50, 0, false),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f1', true,  10, 3, false),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000f1', true,   5, 0, false),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000f4', true,  70, 0, true),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000f5', true,  30, 0, false),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000f1', true, 999, 9, true);

-- =====================================================================
-- 1. สิทธิ์ + ตรวจ input
-- =====================================================================
SELECT ok(NOT has_function_privilege('anon', 'public.material_usage_summary(date, uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.material_usage_summary(date, uuid)', 'EXECUTE'),
  'anon cannot execute; authenticated can');
SELECT isnt_definer('public', 'material_usage_summary', ARRAY['date', 'uuid'], 'material_usage_summary is SECURITY INVOKER');
SELECT volatility_is('public', 'material_usage_summary', ARRAY['date', 'uuid'], 'stable', 'material_usage_summary is STABLE');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a4');
SELECT throws_ok($$SELECT * FROM public.material_usage_summary(pg_temp.m(-1))$$, '42501', NULL, 'viewer → 42501');
SELECT pg_temp.as_user('a5');
SELECT throws_ok($$SELECT * FROM public.material_usage_summary(pg_temp.m(-1))$$, '42501', NULL, 'no profile → 42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.material_usage_summary(pg_temp.m(-1))$$, '42501', NULL, 'anon → 42501');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$SELECT * FROM public.material_usage_summary(pg_temp.m(-1) + 1)$$, 'MU001', NULL, 'not the 1st of the month → MU001');
SELECT throws_ok($$SELECT * FROM public.material_usage_summary(NULL)$$, 'MU001', NULL, 'NULL month → MU001');

-- =====================================================================
-- 2. host: จัดกลุ่มตาม work_group × sale_type
-- =====================================================================
SELECT is((SELECT count(*)::int FROM public.material_usage_summary(pg_temp.m(-1))), 5, 'host: 5 groups in the month');
SELECT is(pg_temp.rows(),
  'makeup/new:1,50,0,0,0.0,0,0 ; problem/new:2,15,0,3,0.9,0,0 ; routine/new:1,100,40,2,0.6,1,0 ; routine/new:1,30,0,0,0.0,0,0 ; routine/renew:1,70,0,0,0.0,2,0',
  'host: grouped values per work_group / sale_type / branch');
SELECT is((SELECT visit_count FROM public.material_usage_summary(pg_temp.m(-1)) WHERE work_group = 'problem'), 2,
  'problem + follow_up visits are one work group');
SELECT is((SELECT count(*)::int FROM public.material_usage_summary(pg_temp.m(-1)) WHERE work_group = 'makeup'), 1,
  'a routine visit with makeup_for_month is the makeup group');
SELECT is((SELECT sum(bait_outside_g) FROM public.material_usage_summary(pg_temp.m(-1))),
          (SELECT sum(bait_outside_g) FROM v_service_materials WHERE visit_date >= pg_temp.m(-1) AND visit_date < pg_temp.m(0)),
  'totals equal the underlying v_service_materials rows (bait outside)');
SELECT is((SELECT sum(visit_count) FROM public.material_usage_summary(pg_temp.m(-1))),
          (SELECT count(*) FROM visits WHERE visit_date >= pg_temp.m(-1) AND visit_date < pg_temp.m(0)),
  'visit counts add up to the visits in the month');
SELECT is((SELECT sum(timber_pcs) + sum(powder_points) FROM public.material_usage_summary(pg_temp.m(-1))),
          (SELECT sum(timber_pcs) + sum(powder_points) FROM v_service_materials WHERE visit_date >= pg_temp.m(-1) AND visit_date < pg_temp.m(0)),
  'totals equal the underlying rows (timber + powder points)');
SELECT is((SELECT count(*)::int FROM public.material_usage_summary(pg_temp.m(-2))), 1, 'another month only returns its own visits');
SELECT is((SELECT count(*)::int FROM public.material_usage_summary(pg_temp.m(-3))), 0, 'a month with no visits → no rows');

-- ตัวกรองสาขา
SELECT is(pg_temp.rows((SELECT branch_id FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c2')),
  'routine/new:1,30,0,0,0.0,0,0', 'host: branch filter → province only');
SELECT is((SELECT count(*)::int FROM public.material_usage_summary(pg_temp.m(-1), '00000000-0000-0000-0000-0000000000ff')), 0,
  'unknown branch → no rows');
SELECT is((SELECT count(DISTINCT branch_id)::int FROM public.material_usage_summary(pg_temp.m(-1))), 2, 'host sees both branches');
RESET ROLE;

-- =====================================================================
-- 3. admin / recorder: เฉพาะสาขาในขอบเขต (central)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT is((SELECT count(*)::int FROM public.material_usage_summary(pg_temp.m(-1))), 4, 'recorder (central): 4 groups, province hidden');
SELECT is((SELECT count(*)::int FROM public.material_usage_summary(pg_temp.m(-1),
            (SELECT branch_id FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c2'))), 0,
  'recorder asking for an out-of-scope branch gets nothing');
SELECT is(pg_temp.rows((SELECT branch_id FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c1')),
  'makeup/new:1,50,0,0,0.0,0,0 ; problem/new:2,15,0,3,0.9,0,0 ; routine/new:1,100,40,2,0.6,1,0 ; routine/renew:1,70,0,0,0.0,2,0',
  'recorder: in-scope branch values');
SELECT pg_temp.as_user('a2');
SELECT is((SELECT count(*)::int FROM public.material_usage_summary(pg_temp.m(-1))), 4, 'admin (central): 4 groups');
SELECT is((SELECT count(DISTINCT branch_id)::int FROM public.material_usage_summary(pg_temp.m(-1))), 1, 'admin sees one branch only');
RESET ROLE;

SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proargnames) a
                       WHERE p.proname = 'material_usage_summary' AND a ~ '(contract|customer|phone)'),
  'result columns carry no customer / contract identifiers');

SELECT * FROM finish();
ROLLBACK;
