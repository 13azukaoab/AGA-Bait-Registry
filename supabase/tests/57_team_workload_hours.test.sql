-- DECISIONS 2.88 (20261115310000): teams.workload_hours · team_workload_hours() · save_team_workload_hours()
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon + request.jwt.claim.sub
-- ตัวเลขชม. ในไฟล์นี้เป็น **ข้อมูลสมมติ** ใช้ทดสอบเท่านั้น
BEGIN;
SELECT plan(34);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer',   'user_a4', 'viewer',   '{central}');

CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || p, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;

INSERT INTO teams (id, code, name, kind) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'W1', 'ทีม W1', 'service'),
  ('00000000-0000-0000-0000-0000000000b2', 'W2', 'ทีม W2', 'service');

-- =====================================================================
-- 1. โครงสร้าง + คอลัมน์ + ฟังก์ชัน
-- =====================================================================
SELECT has_column('public', 'teams', 'workload_hours', 'teams.workload_hours exists');
SELECT col_is_null('public', 'teams', 'workload_hours', 'workload_hours is nullable (NULL = use the global value)');
SELECT is((SELECT workload_hours FROM teams WHERE code = 'W1'), NULL::numeric, 'a new team defaults to NULL');
SELECT isnt_definer('public', 'team_workload_hours', ARRAY['uuid'], 'team_workload_hours is SECURITY INVOKER');
SELECT isnt_definer('public', 'save_team_workload_hours', ARRAY['uuid', 'numeric', 'boolean'], 'save_team_workload_hours is SECURITY INVOKER');
SELECT ok(NOT has_function_privilege('anon', 'public.team_workload_hours(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.save_team_workload_hours(uuid, numeric, boolean)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.team_workload_hours(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.save_team_workload_hours(uuid, numeric, boolean)', 'EXECUTE'),
  'anon cannot execute the new functions; authenticated can');

-- =====================================================================
-- 2. CHECK
-- =====================================================================
SELECT throws_ok($$UPDATE teams SET workload_hours = 0 WHERE code = 'W1'$$, '23514', NULL, 'CHECK rejects 0');
SELECT throws_ok($$UPDATE teams SET workload_hours = -5 WHERE code = 'W1'$$, '23514', NULL, 'CHECK rejects a negative value');
SELECT throws_ok($$UPDATE teams SET workload_hours = 300.01 WHERE code = 'W1'$$, '23514', NULL, 'CHECK rejects a value above 300');
SELECT lives_ok($$UPDATE teams SET workload_hours = 300 WHERE code = 'W1'$$, 'CHECK accepts exactly 300');
UPDATE teams SET workload_hours = NULL WHERE code = 'W1';
DELETE FROM audit_log WHERE table_name = 'teams';   -- เริ่มนับ audit จากศูนย์ (ข้ามแถวจากข้อมูลตั้งต้นด้านบน)

-- =====================================================================
-- 3. อ่านค่า: NULL → ค่ากลาง · ตั้งทับ → ค่าของทีม
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a4');
SELECT is(public.team_workload_hours('00000000-0000-0000-0000-0000000000b1'), 30::numeric,
  'NULL team value → global value (viewer can read)');
SELECT throws_ok($$SELECT public.team_workload_hours('00000000-0000-0000-0000-0000000000ff')$$, 'AG004', NULL,
  'unknown team → AG004');
RESET ROLE;
UPDATE app_settings SET workload_hours_per_person = 28;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT is(public.team_workload_hours('00000000-0000-0000-0000-0000000000b1'), 28::numeric, 'follows a changed global value (admin)');
RESET ROLE;
UPDATE teams SET workload_hours = 40.5 WHERE code = 'W2';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT is(public.team_workload_hours('00000000-0000-0000-0000-0000000000b2'), 40.5::numeric, 'an override is returned (recorder)');
SELECT is(public.team_workload_hours('00000000-0000-0000-0000-0000000000b1'), 28::numeric, 'other teams still use the global value');
RESET ROLE;
UPDATE teams SET workload_hours = NULL WHERE code = 'W2';
DELETE FROM audit_log WHERE table_name = 'teams';

-- =====================================================================
-- 4. save_team_workload_hours: สิทธิ์
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 35, true)$$, '42501', NULL, 'admin → 42501');
SELECT pg_temp.as_user('a3');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 35, true)$$, '42501', NULL, 'recorder → 42501');
SELECT pg_temp.as_user('a4');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 35, true)$$, '42501', NULL, 'viewer → 42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 35, true)$$, '42501', NULL, 'anon → 42501');
RESET ROLE;
SELECT is((SELECT workload_hours FROM teams WHERE code = 'W1'), NULL::numeric, 'no non-host call changed the team');

-- =====================================================================
-- 5. host: บันทึก · ยืนยัน · ช่วงค่า · audit · ล้างค่า
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 35, false)$$, 'TM007', NULL, 'confirm = false → TM007');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 35, NULL)$$, 'TM007', NULL, 'confirm = NULL → TM007');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', NULL, false)$$, 'TM007', NULL, 'reset also needs the confirm flag');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 0, true)$$, 'WL001', NULL, '0 → WL001');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 300.5, true)$$, 'WL001', NULL, 'above 300 → WL001');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 30.123, true)$$, 'WL001', NULL, 'more than 2 decimals → WL001');
SELECT throws_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000ff', 35, true)$$, 'AG004', NULL, 'unknown team → AG004');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'teams'), 0, 'rejected calls wrote no audit row');

SELECT is((SELECT workload_hours || '|' || effective_hours FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 35.5, true)),
  '35.50|35.50', 'host save returns the saved value and the effective value');
SELECT is(public.team_workload_hours('00000000-0000-0000-0000-0000000000b1'), 35.5::numeric, 'the saved override is what the read function returns');
SELECT lives_ok($$SELECT * FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', 35.5, true)$$, 'saving the same value is fine');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name = 'teams' AND action = 'update' AND row_id = '00000000-0000-0000-0000-0000000000b1'
              AND old_data ->> 'workload_hours' IS NULL AND new_data ->> 'workload_hours' = '35.50'
              AND changed_by = '00000000-0000-0000-0000-0000000000a1'), 1,
  'exactly one audit row (old NULL → new 35.50, by the host); the no-op save wrote none');

SELECT is((SELECT coalesce(workload_hours::text, 'null') || '|' || effective_hours FROM public.save_team_workload_hours('00000000-0000-0000-0000-0000000000b1', NULL, true)),
  'null|28', 'reset to NULL returns NULL + the global value');
SELECT is(public.team_workload_hours('00000000-0000-0000-0000-0000000000b1'), 28::numeric, 'after reset the team follows the global value again');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
