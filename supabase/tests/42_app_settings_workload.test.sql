-- M25 (20261115170000): app_settings แถวเดียว · go_live_month (postgres เท่านั้น) · save_workload_threshold (host + audit)
--   · M20b (เกณฑ์ Tier ห้ามก่อน go-live · ชุดตั้งต้น 2000-01-01 ยกเว้น) · oldest_open_month floor = go_live_month()
--   · teams.headcount · ด่านประเภททีม TM003 · audit ทีม/ประเภทลูกค้า · ag_box_counts_by_branch (ตัวเลข + สิทธิ์)
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/service_role/anon + request.jwt.claim.sub
-- เดือนอ้างจากเดือนปัจจุบัน (Asia/Bangkok) ผ่าน pg_temp.m(n) → เทสไม่พังเมื่อเวลาผ่านไป
-- ตัวเลขเกณฑ์ Tier / กล่อง AG ในไฟล์นี้เป็น **ข้อมูลสมมติ** ใช้ทดสอบเท่านั้น
BEGIN;
SELECT plan(87);

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
CREATE FUNCTION pg_temp.tier(n int) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT format('SELECT public.save_tier_rule_set(%L::jsonb)',
                   jsonb_build_object('effective_month', to_char(pg_temp.m(n), 'YYYY-MM'),
                                      'min_m', 40000, 'min_l', 60000, 'min_xl', 120000, 'reason', 'ทดสอบ M25')) $$;
GRANT EXECUTE ON FUNCTION pg_temp.tier(int) TO PUBLIC;

-- =====================================================================
-- 1. app_settings: โครงสร้าง + แถวเดียว + สิทธิ์
-- =====================================================================
SELECT has_table('public', 'app_settings', 'app_settings exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_settings'::regclass), 'RLS is enabled on app_settings');
SELECT is((SELECT count(*)::int FROM app_settings), 1, 'exactly one settings row is seeded');
SELECT is((SELECT go_live_month FROM app_settings), DATE '2026-10-01', 'go_live_month seed = 2026-10-01 (owner decision)');
SELECT is((SELECT workload_hours_per_person FROM app_settings), 30::numeric, 'workload seed = 30 h/person/month');
SELECT throws_ok($$INSERT INTO app_settings (singleton) VALUES (true)$$, '23505', NULL, 'a second row is refused (PK)');
SELECT throws_ok($$INSERT INTO app_settings (singleton) VALUES (false)$$, '23514', NULL, 'singleton must be true');
SELECT throws_ok($$DELETE FROM app_settings$$, 'AS001', NULL, 'the settings row cannot be deleted (even by postgres)');
SELECT throws_ok($$TRUNCATE app_settings$$, 'AS001', NULL, 'the settings table cannot be truncated');
SELECT throws_ok($$UPDATE app_settings SET go_live_month = '2026-10-15'$$, '23514', NULL, 'go_live_month must be the 1st');
SELECT throws_ok($$UPDATE app_settings SET workload_hours_per_person = 0$$, '23514', NULL, 'workload must be > 0');
SELECT ok(NOT has_table_privilege('anon', 'public.app_settings', 'SELECT'), 'anon has no SELECT on app_settings');
SELECT ok(has_table_privilege('authenticated', 'public.app_settings', 'SELECT'), 'authenticated can SELECT app_settings');
SELECT ok(NOT has_table_privilege('authenticated', 'public.app_settings', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.app_settings', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.app_settings', 'DELETE'),
  'authenticated has no write privilege on app_settings');
SELECT ok(NOT has_table_privilege('service_role', 'public.app_settings', 'UPDATE')
          AND NOT has_table_privilege('service_role', 'public.app_settings', 'DELETE'),
  'service_role has no write privilege on app_settings');
SELECT ok(NOT has_function_privilege('anon', 'public.go_live_month()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.workload_hours_per_person()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.save_workload_threshold(numeric)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.ag_box_counts_by_branch(date)', 'EXECUTE'),
  'anon cannot execute any M25 function');
SELECT ok(NOT has_function_privilege('authenticated', 'public.app_settings_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.teams_kind_guard()', 'EXECUTE'),
  'users cannot call the M25 trigger functions');
SELECT is_definer('public', 'go_live_month', ARRAY[]::text[], 'go_live_month() is SECURITY DEFINER');
SELECT isnt_definer('public', 'ag_box_counts_by_branch', ARRAY['date'], 'ag_box_counts_by_branch is SECURITY INVOKER');

-- postgres (ผู้ดูแลฐานข้อมูล) แก้ go_live_month ได้ — คืนค่าเดิมทันที
SELECT lives_ok($$UPDATE app_settings SET go_live_month = '2026-09-01'$$, 'postgres can change go_live_month');
SELECT is(public.go_live_month(), DATE '2026-09-01', 'go_live_month() reads the new value');
UPDATE app_settings SET go_live_month = '2026-10-01';

-- authenticated (ทุก role) อ่านได้ แก้ไม่ได้
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a4');
SELECT is((SELECT count(*)::int FROM app_settings), 1, 'viewer can read the settings row');
SELECT is(public.go_live_month(), DATE '2026-10-01', 'viewer reads go_live_month() through the helper');
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$UPDATE app_settings SET go_live_month = '2026-01-01'$$, '42501', NULL,
  'host cannot change go_live_month (no UPDATE privilege)');
SELECT throws_ok($$UPDATE app_settings SET workload_hours_per_person = 99$$, '42501', NULL,
  'host cannot write workload directly (RPC only)');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE app_settings SET go_live_month = '2026-01-01'$$, '42501', NULL,
  'service_role cannot change go_live_month (GRANT layer — the session_user trigger layer cannot be exercised here because pgTAP runs as postgres)');
SELECT is(public.workload_hours_per_person(), 30::numeric, 'service_role reads workload through the helper');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM app_settings$$, '42501', NULL, 'anon cannot read app_settings');
RESET ROLE;
SELECT is((SELECT go_live_month FROM app_settings), DATE '2026-10-01', 'go_live_month unchanged after refused writes');

-- =====================================================================
-- 2. save_workload_threshold (host เท่านั้น · ลง audit)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT throws_ok($$SELECT public.save_workload_threshold(35)$$, '42501', NULL, 'recorder cannot save the workload threshold');
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$SELECT public.save_workload_threshold(35)$$, '42501', NULL, 'admin cannot save the workload threshold');
SELECT pg_temp.as_user('a4');
SELECT throws_ok($$SELECT public.save_workload_threshold(35)$$, '42501', NULL, 'viewer cannot save the workload threshold');
SELECT pg_temp.as_user('a5');
SELECT throws_ok($$SELECT public.save_workload_threshold(35)$$, '42501', NULL, 'a user without a profile cannot save');
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$SELECT public.save_workload_threshold(0)$$, 'WL001', NULL, '0 is refused (WL001)');
SELECT throws_ok($$SELECT public.save_workload_threshold(300.01)$$, 'WL001', NULL, 'over 300 is refused (WL001)');
SELECT throws_ok($$SELECT public.save_workload_threshold(12.345)$$, 'WL001', NULL, 'more than 2 decimals is refused (WL001)');
SELECT throws_ok($$SELECT public.save_workload_threshold(NULL)$$, 'WL001', NULL, 'NULL is refused (WL001)');
SELECT is(public.save_workload_threshold(35.5), 35.5::numeric, 'host saves 35.5 and gets the saved value back');
SELECT is(public.workload_hours_per_person(), 35.5::numeric, 'helper returns the new threshold');
SELECT is(public.save_workload_threshold(35.5), 35.5::numeric, 'saving the same value again is a no-op');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.save_workload_threshold(40)$$, '42501', NULL, 'service_role cannot call the workload RPC');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'app_settings' AND changed_by IS NULL), 2,
  'the two postgres go_live_month changes above are audited too (changed_by NULL)');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'app_settings'
            AND changed_by = '00000000-0000-0000-0000-0000000000a1'), 1,
  'one audit row for the host workload change (no row for the no-op save)');
SELECT is((SELECT (old_data ->> 'workload_hours_per_person') || '→' || (new_data ->> 'workload_hours_per_person')
                  || '|' || action::text || '|' || changed_by::text
             FROM audit_log WHERE table_name = 'app_settings'
              AND changed_by = '00000000-0000-0000-0000-0000000000a1'),
  '30.00→35.50|update|00000000-0000-0000-0000-0000000000a1', 'audit row has old/new value, action and the host');
SELECT is((SELECT updated_by FROM app_settings), '00000000-0000-0000-0000-0000000000a1'::uuid, 'updated_by = host');
SELECT is((SELECT go_live_month FROM app_settings), DATE '2026-10-01', 'the workload RPC does not touch go_live_month');

-- =====================================================================
-- 3. M20b: เกณฑ์ Tier ห้ามก่อน go-live · ชุดตั้งต้น 2000-01-01 ยกเว้น
-- =====================================================================
UPDATE app_settings SET go_live_month = pg_temp.m(0);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.tier(-1), 'TR005', NULL, 'RPC: a rule set before the go-live month is refused (TR005)');
SELECT lives_ok(pg_temp.tier(0), 'RPC: a rule set at the go-live month is accepted');
RESET ROLE;
SELECT throws_ok(format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
                          (%L, 'S', 0, 39999.99), (%L, 'M', 40000, 59999.99),
                          (%L, 'L', 60000, 119999.99), (%L, 'XL', 120000, NULL)$$,
                        pg_temp.m(-2), pg_temp.m(-2), pg_temp.m(-2), pg_temp.m(-2)),
  'TR005', NULL, 'trigger path: a direct insert before go-live is refused even for postgres (TR005)');
SELECT lives_ok($$UPDATE tier_rules SET change_reason = 'ชุดตั้งต้น (ทดสอบ M25)' WHERE effective_month = '2000-01-01'$$,
  'the 2000-01-01 baseline set is exempt and can still be edited');
SELECT is((SELECT count(*)::int FROM tier_rules_for_month(pg_temp.m(-3))), 4,
  'months before go-live still resolve to the baseline set');
SELECT is((SELECT min(effective_month) FROM tier_rules WHERE effective_month > '2000-01-01'), pg_temp.m(0),
  'no rule set exists before the go-live month');

-- =====================================================================
-- 4. oldest_open_month: floor = go_live_month()
-- =====================================================================
UPDATE app_settings SET go_live_month = pg_temp.m(-2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT oldest_open_month || '|' || is_behind FROM public.oldest_open_month() WHERE scope = 'central'),
  pg_temp.m(-2) || '|true', 'no closure → the go-live month is the oldest open month (behind)');
RESET ROLE;
-- แถว legacy ที่เดือนหลัง go-live ไม่เลื่อน floor อีกแล้ว (M24 เคยเดา go-live จาก legacy เดือนล่าสุด)
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source)
SELECT upper(to_char(pg_temp.m(-1), 'MON.YY')), b.id, 'legacy' FROM branches b ORDER BY b.name LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT oldest_open_month FROM public.oldest_open_month() WHERE scope = 'central'), pg_temp.m(-2),
  'legacy snapshot rows no longer move the floor');
RESET ROLE;
UPDATE app_settings SET go_live_month = pg_temp.m(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT oldest_open_month || '|' || is_behind FROM public.oldest_open_month() WHERE scope = 'province'),
  pg_temp.m(0) || '|false', 'go-live in the future → current month, not behind');
RESET ROLE;
UPDATE app_settings SET go_live_month = '2026-10-01';

-- =====================================================================
-- 5. teams.headcount + ด่านประเภททีม + audit ทีม
-- =====================================================================
SELECT has_column('public', 'teams', 'headcount', 'teams.headcount exists');
SELECT col_default_is('public', 'teams', 'headcount', '0', 'headcount defaults to 0');
SELECT has_trigger('public', 'teams', 'teams_kind_guard', 'teams has the kind guard trigger');
SELECT has_trigger('public', 'teams', 'audit_teams', 'teams has an audit trigger');
SELECT has_trigger('public', 'customer_types', 'audit_customer_types', 'customer_types has an audit trigger');

INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT b.id FROM branches b WHERE b.division = 'central' ORDER BY b.name LIMIT 1), 'Central'),
  ('00000000-0000-0000-0000-0000000000c2', (SELECT b.id FROM branches b WHERE b.division = 'province' ORDER BY b.name LIMIT 1), 'Province');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'M25-1', pg_temp.m(-6), 1, 50000, now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', 'M25-2', pg_temp.m(-6), 1, 50000, now());
-- ทีม: T1 ผูกสัญญา · T2 ผูกการเข้า · T3 ว่าง
INSERT INTO teams (id, code, name, kind) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'T1', 'ทีม T1', 'service'),
  ('00000000-0000-0000-0000-0000000000b2', 'T2', 'ทีม T2', 'service'),
  ('00000000-0000-0000-0000-0000000000b3', 'T3', 'ทีม T3', 'install');
INSERT INTO contract_teams (contract_id, team_id) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1');
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', pg_temp.m(0),      'routine', '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', pg_temp.m(-1),     'routine', '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', pg_temp.m(-1) + 9, 'routine', '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', pg_temp.m(-2),     'routine', '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d2', pg_temp.m(0),      'routine', '09:00', '10:00');
INSERT INTO visit_teams (visit_id, team_id) VALUES
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b2');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok($$UPDATE teams SET headcount = 5 WHERE code = 'T3'$$, 'host sets a team headcount');
SELECT throws_ok($$UPDATE teams SET headcount = 100 WHERE code = 'T3'$$, '23514', NULL, 'headcount over 99 is refused');
SELECT throws_ok($$UPDATE teams SET headcount = -1 WHERE code = 'T3'$$, '23514', NULL, 'negative headcount is refused');
SELECT throws_ok($$UPDATE teams SET kind = 'supervisor' WHERE code = 'T1'$$, 'TM003',
  'เปลี่ยนทีม T1 เป็นทีมหัวหน้างานไม่ได้ เพราะยังมีงานผูกอยู่ (สัญญา 1 · การเข้าบริการ 0)',
  'a team linked to a contract cannot become a supervisor team (TM003, Thai message)');
SELECT throws_ok($$UPDATE teams SET kind = 'supervisor' WHERE code = 'T2'$$, 'TM003', NULL,
  'a team linked to a visit cannot become a supervisor team (TM003)');
SELECT lives_ok($$UPDATE teams SET kind = 'service' WHERE code = 'T1'$$, 'other kind changes are still allowed');
SELECT lives_ok($$UPDATE teams SET kind = 'supervisor' WHERE code = 'T3'$$, 'a team without linked work can become a supervisor team');
SELECT lives_ok($$UPDATE teams SET kind = 'install' WHERE code = 'T3'$$, 'a supervisor team can change back');
SELECT pg_temp.as_user('a2');
UPDATE teams SET headcount = 9 WHERE code = 'T3';
RESET ROLE;
SELECT is((SELECT headcount FROM teams WHERE code = 'T3'), 5, 'admin cannot change headcount (RLS: 0 rows)');
SELECT throws_ok($$UPDATE teams SET kind = 'supervisor' WHERE code = 'T2'$$, 'TM003', NULL,
  'the kind guard also applies to postgres');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name = 'teams' AND action = 'update' AND row_id = '00000000-0000-0000-0000-0000000000b3'
              AND old_data ->> 'headcount' = '0' AND new_data ->> 'headcount' = '5'
              AND changed_by = '00000000-0000-0000-0000-0000000000a1'), 1,
  'headcount change is audited with old/new value and the host');
SELECT ok((SELECT count(*) FROM audit_log WHERE table_name = 'teams' AND action = 'insert'
            AND row_id = '00000000-0000-0000-0000-0000000000b1') = 1, 'team insert is audited');

-- audit ประเภทลูกค้า
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok($$INSERT INTO customer_types (code, label, group_label, sort_order)
                  VALUES ('m25_test', 'ประเภททดสอบ M25', 'ทดสอบ', 9990)$$, 'host adds a customer type');
SELECT lives_ok($$UPDATE customer_types SET label = 'ประเภททดสอบ M25 (แก้)' WHERE code = 'm25_test'$$,
  'host renames a customer type');
RESET ROLE;
SELECT is((SELECT string_agg(action::text, ',' ORDER BY changed_at, action::text) FROM audit_log
            WHERE table_name = 'customer_types' AND new_data ->> 'code' = 'm25_test'
              AND changed_by = '00000000-0000-0000-0000-0000000000a1'),
  'insert,update', 'customer type insert + update are audited (by the host)');
SELECT is((SELECT old_data ->> 'label' FROM audit_log WHERE table_name = 'customer_types' AND action = 'update'
            AND new_data ->> 'code' = 'm25_test'), 'ประเภททดสอบ M25', 'audit keeps the old label');

-- =====================================================================
-- 6. ag_box_counts_by_branch
--    c1 (ส่วนกลาง): AG 3 กล่องใช้งาน (active / pending_removal / eliminated) + removed + lost + IG
--      m(0): AG1, AG2 checked · AG3 ไม่ได้ตรวจ · IG checked  → ag_checked 2
--      m(-1): AG1 สองครั้ง (นับไม่ซ้ำ = 1) → ag_checked_prev 1 · m(-2): AG2 (นอกช่วง)
--    c2 (ต่างจังหวัด): AG 1 กล่อง · m(0) checked
-- =====================================================================
INSERT INTO stations (id, contract_id, type, station_no, status, removed_at) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', 'AG', 1, 'active',          NULL),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', 'AG', 2, 'pending_removal', NULL),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d1', 'AG', 3, 'eliminated',      NULL),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d1', 'AG', 4, 'removed',         now()),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000d1', 'AG', 5, 'lost',            NULL),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000d1', 'IG', 1, 'active',          NULL),
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000d2', 'AG', 1, 'active',          NULL);
INSERT INTO station_checks (visit_id, station_id, checked) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', true),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', true),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f3', false),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f6', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f1', true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f1', true),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000f2', true),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000f7', true);

CREATE TEMP TABLE _ag AS
SELECT (SELECT branch_id FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c1') AS x,
       (SELECT branch_id FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c2') AS p;
GRANT SELECT ON _ag TO PUBLIC;
CREATE FUNCTION pg_temp.ag(p_branch uuid, p_month date) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT ag_in_use || '|' || ag_checked || '|' || ag_checked_prev || '|' || coalesce(ag_in_use_prev::text, 'null')
       FROM public.ag_box_counts_by_branch(p_month) WHERE branch_id = p_branch $$;
GRANT EXECUTE ON FUNCTION pg_temp.ag(uuid, date) TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is(pg_temp.ag((SELECT x FROM _ag), NULL), '3|2|1|null',
  'host, current month, central branch: 3 boxes in use · 2 checked · 1 last month · no in-use history');
SELECT is(pg_temp.ag((SELECT p FROM _ag), NULL), '1|1|0|null', 'host, current month, province branch');
SELECT is(pg_temp.ag((SELECT x FROM _ag), pg_temp.m(-1) + 14), '3|1|1|null',
  'month m(-1) (any day of the month): 1 box checked (twice → counted once) · m(-2) 1 box');
SELECT is((SELECT count(*)::int FROM public.ag_box_counts_by_branch()), (SELECT count(*)::int FROM branches),
  'host sees every branch (branches without boxes = 0)');
SELECT pg_temp.as_user('a3');
SELECT is(pg_temp.ag((SELECT x FROM _ag), NULL), '3|2|1|null', 'central recorder sees its own branch');
SELECT is((SELECT count(*)::int FROM public.ag_box_counts_by_branch() WHERE branch_id = (SELECT p FROM _ag)), 0,
  'central recorder does not see province branches');
SELECT is((SELECT count(*)::int FROM public.ag_box_counts_by_branch()),
          (SELECT count(*)::int FROM branches WHERE division = 'central'), 'central recorder sees only central branches');
SELECT pg_temp.as_user('a2');
SELECT is(pg_temp.ag((SELECT x FROM _ag), NULL), '3|2|1|null', 'admin sees its division');
SELECT pg_temp.as_user('a4');
SELECT throws_ok($$SELECT * FROM public.ag_box_counts_by_branch()$$, '42501', NULL, 'viewer cannot read AG box counts');
SELECT pg_temp.as_user('a5');
SELECT throws_ok($$SELECT * FROM public.ag_box_counts_by_branch()$$, '42501', NULL, 'a user without a profile cannot read');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.ag_box_counts_by_branch()$$, '42501', NULL, 'anon cannot read AG box counts');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
