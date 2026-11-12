-- ก้อน ① schema หน้ากรอกข้อมูลทำบริการ (SPEC v1.8 §8.1 · 20261112120000)
--   visits.start_time / end_time (บังคับ) · duration_min คำนวณเอง · visit_teams (หลายทีมต่อการเข้า)
--   ลบ visits.team_id · view v_visit_team_minutes (หลายทีม = นับเต็มทุกทีม — DECISIONS 2.14)
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(28);

-- ---------- โครงสร้าง ----------
SELECT has_column('public', 'visits', 'start_time', 'visits.start_time');
SELECT has_column('public', 'visits', 'end_time', 'visits.end_time');
SELECT col_not_null('public', 'visits', 'start_time', 'start_time is required');
SELECT col_not_null('public', 'visits', 'end_time', 'end_time is required');
SELECT is((SELECT attgenerated::text FROM pg_attribute
            WHERE attrelid = 'public.visits'::regclass AND attname = 'duration_min'),
  's', 'duration_min is a stored generated column (users cannot type it)');
SELECT hasnt_column('public', 'visits', 'team_id', 'visits.team_id is gone (moved to visit_teams)');
SELECT has_table('public', 'visit_teams', 'visit_teams exists');
SELECT col_is_pk('public', 'visit_teams', ARRAY['visit_id', 'team_id'], 'visit_teams PK is (visit_id, team_id)');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.visit_teams'::regclass), true,
  'RLS is enabled on visit_teams');
SELECT table_privs_are('public', 'visit_teams', 'anon', ARRAY[]::text[], 'anon has no privilege on visit_teams');
SELECT has_trigger('public', 'visit_teams', 'audit_visit_teams', 'visit_teams changes are audited');
SELECT has_view('public', 'v_visit_team_minutes', 'v_visit_team_minutes exists');
SELECT ok((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class
            WHERE oid = 'public.v_visit_team_minutes'::regclass),
  'view runs with the caller''s RLS (security_invoker)');
SELECT table_privs_are('public', 'v_visit_team_minutes', 'anon', ARRAY[]::text[], 'anon cannot read the view');

-- ---------- seed ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}');
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1), 'Central'),
  ('00000000-0000-0000-0000-0000000000c2', (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1), 'Province');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'V-1', '2026-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', 'V-2', '2026-01-15', 1, 50000);
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-02-10', 'routine', '09:00', '10:30'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2', '2026-02-10', 'routine', '13:00', '14:00');
CREATE TEMP TABLE _t AS
  SELECT (SELECT id FROM teams WHERE code = 'A') AS a, (SELECT id FROM teams WHERE code = 'B') AS b;
GRANT SELECT ON _t TO PUBLIC;

-- ---------- เวลา ----------
SELECT is((SELECT duration_min FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'), 90,
  'duration_min = end_time - start_time in minutes');
SELECT throws_ok($$INSERT INTO visits (contract_id, visit_date, visit_type)
                   VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-02-11', 'routine')$$,
  '23502', NULL, 'a visit without start/end time is refused');
SELECT throws_ok($$INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time)
                   VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-02-11', 'routine', '10:00', '10:00')$$,
  '23514', NULL, 'end_time must be after start_time (no overnight visits yet)');
SELECT throws_ok($$UPDATE visits SET duration_min = 5 WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  '428C9', NULL, 'duration_min cannot be written directly');

-- ---------- ทีม (สิทธิ์) ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$INSERT INTO visit_teams (visit_id, team_id)
                  SELECT '00000000-0000-0000-0000-0000000000f1'::uuid, a FROM _t
                  UNION ALL SELECT '00000000-0000-0000-0000-0000000000f1'::uuid, b FROM _t$$,
  'recorder adds two teams to a visit in scope');
SELECT throws_ok($$INSERT INTO visit_teams (visit_id, team_id)
                   SELECT '00000000-0000-0000-0000-0000000000f2'::uuid, a FROM _t$$,
  '42501', NULL, 'recorder cannot add teams to a visit outside their division');
SELECT is((SELECT count(*)::int FROM v_visit_team_minutes WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'), 2,
  'view has one row per team of the visit');
SELECT is((SELECT sum(minutes)::int FROM v_visit_team_minutes WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'), 180,
  'each team gets the full 90 minutes (two teams = 180, DECISIONS 2.14)');
SELECT lives_ok($$DELETE FROM visit_teams WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'
                    AND team_id = (SELECT b FROM _t)$$,
  'recorder removes a team');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$INSERT INTO visit_teams (visit_id, team_id)
                   SELECT '00000000-0000-0000-0000-0000000000f1'::uuid, b FROM _t$$,
  '42501', NULL, 'admin cannot write service teams (recorder/host only)');
SELECT is((SELECT count(*)::int FROM visit_teams WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'), 1,
  'admin can read visit teams');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM v_visit_team_minutes$$, '42501', NULL, 'anon is refused on the view');
RESET ROLE;

-- ---------- audit (เหมือน M3: การเพิ่มไม่ลง · การลบลง พร้อมบริบท) ----------
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'visit_teams' AND action = 'insert'), 0,
  'adding teams is not audited (same as visits / station_checks, M3)');
SELECT results_eq(
  $$SELECT contract_id, month_key FROM audit_log WHERE table_name = 'visit_teams' AND action = 'delete'$$,
  $$VALUES ('00000000-0000-0000-0000-0000000000d1'::uuid, '2026-02'::text)$$,
  'removing a team is audited with contract and month');

SELECT * FROM finish();
ROLLBACK;
