-- M43 (20261115330000 · DECISIONS 2.93): ตรวจภายใน ติ๊กได้เฉพาะ routine + inside_inspection_summary
--   * CHECK visits_internal_inspection_routine_only (23514): problem/follow_up + true → ไม่ผ่าน · routine true/false/NULL ผ่าน
--   * ครอบทั้งทาง INSERT / UPDATE ตรง และ save_service_visit (ทางที่ถูกต้องยังใช้ได้)
--   * inside_inspection_summary: นับการเข้า + สัญญาไม่ซ้ำ ต่อ สาขา × ทีม · ตัวกรองสาขา · เดือนอื่นไม่ปน
--     host ทุกสาขา · admin/recorder เฉพาะขอบเขต · viewer/anon → 42501 · p_month ไม่ใช่วันที่ 1 → II001
-- ข้อมูลสมมติทั้งหมด
BEGIN;
SELECT plan(43);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec2@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope, position_code) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',      'user_a1', 'host',     '{central,province}', 'pm'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',     'user_a2', 'admin',    '{central}',          'job_admin'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder',  'user_a3', 'recorder', '{central}',          'supervisor'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer',    'user_a4', 'viewer',   '{central}',          NULL),
  ('00000000-0000-0000-0000-0000000000a5', 'recorder2', 'user_a5', 'recorder', '{province}',         'supervisor');

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.bc() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.bc() TO PUBLIC;
CREATE FUNCTION pg_temp.bp() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.bp() TO PUBLIC;
CREATE FUNCTION pg_temp.team(p text) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM teams WHERE code = p ORDER BY id LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.team(text) TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), pg_temp.bc(), 'Alpha (สมมติ)'),
  (pg_temp.id('c2'), pg_temp.bp(), 'Beta province (สมมติ)');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'II-1', '2026-01-15', 12, 50000, now()),
  (pg_temp.id('d2'), pg_temp.id('c1'), 'II-2', '2026-01-15', 12, 50000, now()),
  (pg_temp.id('d3'), pg_temp.id('c2'), 'II-3', '2026-01-15', 12, 50000, now()),
  (pg_temp.id('d4'), pg_temp.id('c1'), 'II-4', '2026-01-15', 12, 50000, now());
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  (pg_temp.id('e1'), pg_temp.id('d4'), 'AG', 1, 'active');

-- =====================================================================
-- 1. กฎ routine เท่านั้น (INSERT ตรงเป็น postgres — CHECK ยังบังคับ)
-- =====================================================================
SELECT has_check('public', 'visits', 'visits has CHECK constraints');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.visits'::regclass
                    AND conname = 'visits_internal_inspection_routine_only' AND contype = 'c'),
  'constraint visits_internal_inspection_routine_only exists');
-- ฐานข้อมูลที่ reset ใหม่ไม่มีแถวเดิมผิดกฎ → constraint ต้อง validated
SELECT ok((SELECT convalidated FROM pg_constraint WHERE conname = 'visits_internal_inspection_routine_only'),
  'constraint is validated (no pre-existing violating rows on a fresh DB)');

SELECT throws_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time, internal_inspection)
    VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-03-01', 'problem', '09:00', '10:00', true)$$,
  '23514', NULL, 'problem visit with internal_inspection = true is refused');
SELECT throws_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time, internal_inspection)
    VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-03-01', 'follow_up', '09:00', '10:00', true)$$,
  '23514', NULL, 'follow_up visit with internal_inspection = true is refused');
SELECT lives_ok(
  $$INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time, internal_inspection)
    VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-03-05', 'routine', '09:00', '10:00', true)$$,
  'routine visit with internal_inspection = true is accepted');
SELECT lives_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time, internal_inspection)
    VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-02-05', 'routine', '09:00', '10:00', false)$$,
  'routine visit with internal_inspection = false is accepted');
SELECT lives_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time, internal_inspection)
    VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-05-05', 'routine', '09:00', '10:00', NULL)$$,
  'routine visit with internal_inspection = NULL is accepted');
SELECT lives_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time, internal_inspection)
    VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-03-06', 'problem', '09:00', '10:00', false),
           ('00000000-0000-0000-0000-0000000000d1', '2026-03-07', 'follow_up', '09:00', '10:00', NULL)$$,
  'problem / follow_up visits with false / NULL are accepted');

-- UPDATE ตรง: เปลี่ยน routine(true) เป็น problem ไม่ได้ · ติ๊กบน problem ไม่ได้
SELECT throws_ok(
  $$UPDATE visits SET visit_type = 'problem' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  '23514', NULL, 'changing a routine visit that has internal_inspection = true to problem is refused');
SELECT throws_ok(
  $$UPDATE visits SET internal_inspection = true
     WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND visit_type = 'problem'$$,
  '23514', NULL, 'ticking internal_inspection on an existing problem visit is refused');
SELECT is((SELECT visit_type::text FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'routine',
  'the refused UPDATE left the routine visit unchanged');

-- =====================================================================
-- 2. save_service_visit (ทางที่ถูกต้อง) ยังใช้ได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(jsonb_build_object(
    'visit_id', '00000000-0000-0000-0000-0000000000f4', 'contract_id', '00000000-0000-0000-0000-0000000000d4',
    'visit_date', '2026-03-10', 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
    'team_ids', jsonb_build_array(pg_temp.team('A')), 'skip_all_ag', true, 'internal_inspection', true))$$,
  'save_service_visit: routine visit with internal_inspection = true is saved');
SELECT throws_ok($$SELECT public.save_service_visit(jsonb_build_object(
    'visit_id', '00000000-0000-0000-0000-0000000000f5', 'contract_id', '00000000-0000-0000-0000-0000000000d4',
    'visit_date', '2026-03-11', 'visit_type', 'problem', 'start_time', '09:00', 'end_time', '10:30',
    'team_ids', jsonb_build_array(pg_temp.team('A')), 'skip_all_ag', true, 'internal_inspection', true))$$,
  '23514', NULL, 'save_service_visit: problem visit with internal_inspection = true is refused');
SELECT lives_ok($$SELECT public.save_service_visit(jsonb_build_object(
    'visit_id', '00000000-0000-0000-0000-0000000000f5', 'contract_id', '00000000-0000-0000-0000-0000000000d4',
    'visit_date', '2026-03-11', 'visit_type', 'problem', 'start_time', '09:00', 'end_time', '10:30',
    'team_ids', jsonb_build_array(pg_temp.team('A')), 'skip_all_ag', true, 'internal_inspection', false))$$,
  'save_service_visit: problem visit with internal_inspection = false is saved');
RESET ROLE;
SELECT is((SELECT internal_inspection FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f4'), true,
  'the routine visit stored internal_inspection = true');

-- =====================================================================
-- 3. ข้อมูลสำหรับสรุป (เดือน มี.ค. 2026) — เป็น postgres
--   สาขากลาง ทีม A: f1(d1) · f2(d1) · f3(d2) · f4(d4, จาก RPC) = 4 การเข้า / 3 สัญญา (d1,d2,d4)
--   สาขากลาง ทีม B: f3(d2) = 1 / 1 · ไม่นับ: routine false · problem · เดือนอื่น
--   สาขาจังหวัด ไม่มีทีม: f6(d3) = 1 / 1
-- =====================================================================
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time, internal_inspection) VALUES
  (pg_temp.id('f2'), pg_temp.id('d1'), '2026-03-20', 'routine', '09:00', '10:00', true),
  (pg_temp.id('f3'), pg_temp.id('d2'), '2026-03-12', 'routine', '09:00', '10:00', true),
  (pg_temp.id('f6'), pg_temp.id('d3'), '2026-03-08', 'routine', '09:00', '10:00', true),
  (pg_temp.id('f7'), pg_temp.id('d2'), '2026-03-14', 'routine', '09:00', '10:00', false),
  (pg_temp.id('f8'), pg_temp.id('d2'), '2026-04-10', 'routine', '09:00', '10:00', true),
  (pg_temp.id('f9'), pg_temp.id('d3'), '2026-05-01', 'routine', '09:00', '10:00', true),
  (pg_temp.id('fa'), pg_temp.id('d3'), '2026-05-31', 'routine', '09:00', '10:00', true),
  (pg_temp.id('fb'), pg_temp.id('d3'), '2026-06-01', 'routine', '09:00', '10:00', true);
INSERT INTO visit_teams (visit_id, team_id) VALUES
  (pg_temp.id('f1'), pg_temp.team('A')),
  (pg_temp.id('f2'), pg_temp.team('A')),
  (pg_temp.id('f3'), pg_temp.team('A')),
  (pg_temp.id('f3'), pg_temp.team('B')),
  (pg_temp.id('f7'), pg_temp.team('A')),
  (pg_temp.id('f8'), pg_temp.team('A'));

CREATE FUNCTION pg_temp.sum_row(p_branch uuid, p_team text) RETURNS text LANGUAGE sql AS $$
  SELECT s.inspection_count || '/' || s.contract_count
    FROM public.inside_inspection_summary('2026-03-01') s
   WHERE s.branch_id = p_branch
     AND NOT s.is_branch_total
     AND s.team_id IS NOT DISTINCT FROM (CASE WHEN p_team IS NULL THEN NULL ELSE pg_temp.team(p_team) END)
$$;
CREATE FUNCTION pg_temp.tot_row(p_branch uuid) RETURNS text LANGUAGE sql AS $$
  SELECT s.inspection_count || '/' || s.contract_count
    FROM public.inside_inspection_summary('2026-03-01') s
   WHERE s.branch_id = p_branch AND s.is_branch_total AND s.team_id IS NULL AND s.team_name IS NULL
$$;
GRANT EXECUTE ON FUNCTION pg_temp.tot_row(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.sum_row(uuid, text) TO PUBLIC;

-- โครงสร้าง / สิทธิ์ฟังก์ชัน
SELECT has_function('public', 'inside_inspection_summary', ARRAY['date', 'uuid'], 'inside_inspection_summary exists');
SELECT ok(has_function_privilege('authenticated', 'public.inside_inspection_summary(date, uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.inside_inspection_summary(date, uuid)', 'EXECUTE'),
  'RPC: authenticated may execute · anon may not');
SELECT ok((SELECT NOT prosecdef AND provolatile = 's' AND proconfig::text LIKE '%search_path%'
            FROM pg_proc WHERE oid = 'public.inside_inspection_summary(date, uuid)'::regprocedure),
  'RPC is SECURITY INVOKER · STABLE · pinned search_path');

-- =====================================================================
-- 4. สรุป — host
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT is(pg_temp.sum_row(pg_temp.bc(), 'A'), '4/3', 'host: central team A = 4 inspections / 3 distinct contracts');
SELECT is(pg_temp.sum_row(pg_temp.bc(), 'B'), '1/1', 'host: central team B = 1 / 1 (multi-team visit counted for each team)');
SELECT is(pg_temp.sum_row(pg_temp.bp(), NULL), '1/1', 'host: province visit without a team = 1 / 1 with NULL team');
SELECT is(pg_temp.tot_row(pg_temp.bc()), '4/3',
  'host: central branch total = 4 / 3 (multi-team visit counted once, not 5 / 4)');
SELECT is(pg_temp.tot_row(pg_temp.bp()), '1/1', 'host: province branch total = 1 / 1');
SELECT is((SELECT count(*)::int FROM public.inside_inspection_summary('2026-03-01')), 5,
  'host: 5 rows in March (3 team rows + 2 branch totals; non-routine / false / other months not counted)');
SELECT is((SELECT count(*)::int FROM public.inside_inspection_summary('2026-03-01', pg_temp.bc())), 3,
  'host: branch filter (central) = 3 rows (A, B, total)');
SELECT is((SELECT count(*)::int FROM public.inside_inspection_summary('2026-03-01', pg_temp.bp())), 2,
  'host: branch filter (province) = 2 rows (no-team row + total)');
SELECT is((SELECT inspection_count || '/' || contract_count FROM public.inside_inspection_summary('2026-04-01') WHERE team_id = pg_temp.team('A') AND NOT is_branch_total),
  '1/1', 'host: April counts only its own visit (1 / 1)');
SELECT is((SELECT inspection_count FROM public.inside_inspection_summary('2026-05-01', pg_temp.bp()) WHERE is_branch_total), 2,
  'host: month boundaries — May 1st and May 31st counted, June 1st not');
SELECT is((SELECT count(*)::int FROM public.inside_inspection_summary('2026-07-01')), 0, 'host: month without data = no rows');
SELECT ok((SELECT branch_name IS NOT NULL AND (team_id IS NULL OR team_name IS NOT NULL)
             FROM public.inside_inspection_summary('2026-03-01') LIMIT 1),
  'rows carry branch name and team name (no customer / contract identifiers in the columns)');

-- admin (central)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT is((SELECT count(*)::int FROM public.inside_inspection_summary('2026-03-01')), 3, 'admin (central): sees central rows only (A, B, total)');
SELECT is((SELECT count(*)::int FROM public.inside_inspection_summary('2026-03-01', pg_temp.bp())), 0,
  'admin (central): out-of-scope branch filter returns no rows');

-- recorder (central)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is(pg_temp.sum_row(pg_temp.bc(), 'A'), '4/3', 'recorder (central): sees the central team A row');
SELECT is((SELECT count(*)::int FROM public.inside_inspection_summary('2026-03-01', pg_temp.bp())), 0,
  'recorder (central): province branch returns no rows');

-- recorder (province)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', true);
SELECT is((SELECT count(*)::int FROM public.inside_inspection_summary('2026-03-01')), 2, 'recorder (province): sees only province rows (no-team row + total)');
SELECT is((SELECT count(*)::int FROM public.inside_inspection_summary('2026-03-01', pg_temp.bc())), 0,
  'recorder (province): central branch returns no rows');

-- viewer / anon / ไม่มีโปรไฟล์
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok($$SELECT * FROM public.inside_inspection_summary('2026-03-01')$$, '42501', NULL, 'viewer is refused (42501)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', true);
SELECT throws_ok($$SELECT * FROM public.inside_inspection_summary('2026-03-01')$$, '42501', NULL, 'user without a profile is refused (42501)');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.inside_inspection_summary('2026-03-01')$$, '42501', NULL, 'anon is refused (42501)');
RESET ROLE;

-- =====================================================================
-- 5. p_month ต้องเป็นวันที่ 1
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$SELECT * FROM public.inside_inspection_summary('2026-03-15')$$, 'II001', NULL, 'p_month = 15th is refused (II001)');
SELECT throws_ok($$SELECT * FROM public.inside_inspection_summary(NULL)$$, 'II001', NULL, 'p_month = NULL is refused (II001)');
SELECT lives_ok($$SELECT * FROM public.inside_inspection_summary('2026-03-01')$$, 'p_month = 1st is accepted');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
