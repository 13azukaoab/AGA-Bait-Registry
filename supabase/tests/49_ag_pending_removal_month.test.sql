-- M35 ② (20261115225000): stations.pending_removal_month — เดือนที่กล่องเข้าสถานะรอถอด
--   * ผ่านบันทึกบริการ = เดือนของวันเข้า · ทางอื่น = เดือนปัจจุบัน (ไทย) · active = NULL · ถอดแล้ว = เก็บ
--   * ยกเลิกการถอด (ลบการเข้า) → กลับเป็นรอถอดด้วยเดือนเดิม · สถานะไม่เปลี่ยน = ค่าเดิม
--   * ผู้ใช้เขียนคอลัมน์เองไม่ได้ · ระบบ (postgres) ตั้งค่าเองได้ · viewer / anon อ่านไม่ได้ (PDPA)
-- ข้อมูลสมมติทั้งหมด
BEGIN;
SELECT plan(24);

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
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Test AG');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'TST-AG', '2026-01-15', 12, 50000, now());
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'AG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'AG', 3, 'active');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a;
GRANT SELECT ON _t TO PUBLIC;
CREATE FUNCTION pg_temp.payload(p_visit uuid, p_date date, p_statuses jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', p_visit, 'contract_id', '00000000-0000-0000-0000-0000000000d1',
                            'visit_date', p_date, 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true,
                            'station_statuses', p_statuses)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(uuid, date, jsonb) TO PUBLIC;
CREATE FUNCTION pg_temp.prm(p_id text) RETURNS date LANGUAGE sql AS $$
  SELECT pending_removal_month FROM stations WHERE id = ('00000000-0000-0000-0000-0000000000' || p_id)::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.prm(text) TO PUBLIC;
CREATE FUNCTION pg_temp.nowm() RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.nowm() TO PUBLIC;

-- =====================================================================
-- โครงสร้าง
-- =====================================================================
SELECT has_column('public', 'stations', 'pending_removal_month', 'stations.pending_removal_month exists');
SELECT col_type_is('public', 'stations', 'pending_removal_month', 'date', 'pending_removal_month is date');
SELECT has_trigger('public', 'stations', 'stations_pending_removal_month', 'trigger exists');
SELECT ok(NOT has_function_privilege('authenticated', 'public.stations_pending_removal_month()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.stations_pending_removal_month()', 'EXECUTE'),
  'trigger function is not callable by users');
SELECT throws_ok($$UPDATE stations SET pending_removal_month = '2026-01-15'
                    WHERE id = '00000000-0000-0000-0000-0000000000e1'$$, '23514', NULL,
  'CHECK: must be the 1st day of a month');

-- =====================================================================
-- ทางบันทึกบริการ (recorder) — เดือนของวันเข้า ไม่ใช่วันกดบันทึก
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f1', '2026-01-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "pending_removal"}]'))$$,
  'V1 (20 Jan) sets AG-1 to pending_removal');
SELECT is(pg_temp.prm('e1'), '2026-01-01'::date, 'visit path → month of the visit date (Jan 2026)');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2', '2026-02-10',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "pending_removal"}]'))$$,
  'V2 (10 Feb) keeps AG-1 pending_removal');
SELECT is(pg_temp.prm('e1'), '2026-01-01'::date, 'status unchanged → month unchanged');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-05',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"}]'))$$,
  'V3 (5 Mar) removes AG-1');
SELECT is(pg_temp.prm('e1'), '2026-01-01'::date, 'removed → month kept as history');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f3')$$, 'delete V3 (undo removal)');
SELECT is((SELECT status::text FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e1'), 'pending_removal',
  'undo removal → back to pending_removal');
SELECT is(pg_temp.prm('e1'), '2026-01-01'::date, 'undo removal → original month kept (not restarted)');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f4', '2026-03-12',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "active"}]'))$$,
  'V4 sets AG-1 back to active');
SELECT is(pg_temp.prm('e1'), NULL::date, 'back to active → cleared');
SELECT is((SELECT count(*)::int FROM stations WHERE pending_removal_month IS NULL), 2, 'recorder can read the column');

-- =====================================================================
-- ทางอื่น (admin แก้ตรงผ่าน REST) — เดือนปัจจุบัน · เขียนคอลัมน์เองไม่ได้
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
UPDATE stations SET status = 'pending_removal' WHERE id = '00000000-0000-0000-0000-0000000000e3';
SELECT is(pg_temp.prm('e3'), pg_temp.nowm(), 'direct status change → current Bangkok month');
UPDATE stations SET pending_removal_month = '2020-01-01' WHERE id = '00000000-0000-0000-0000-0000000000e3';
SELECT is(pg_temp.prm('e3'), pg_temp.nowm(), 'user cannot write pending_removal_month directly');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
INSERT INTO stations (id, contract_id, type, station_no, status, pending_removal_month) VALUES
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', 'AG', 4, 'active', '2020-01-01');
SELECT is(pg_temp.prm('e4'), NULL::date, 'host INSERT active with a month → ignored (NULL)');

-- =====================================================================
-- viewer / anon (PDPA)
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT is((SELECT count(*)::int FROM stations), 0, 'viewer sees no stations (RLS)');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT pending_removal_month FROM public.stations$$, '42501', NULL, 'anon cannot read stations');
RESET ROLE;

-- =====================================================================
-- ระบบ (postgres) ตั้งค่าเองได้ (นำเข้า / backfill)
-- =====================================================================
UPDATE stations SET pending_removal_month = '2025-06-01' WHERE id = '00000000-0000-0000-0000-0000000000e3';
SELECT is(pg_temp.prm('e3'), '2025-06-01'::date, 'system may set the month explicitly (import / backfill)');
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d1', 'AG', 5, 'pending_removal');
SELECT is(pg_temp.prm('e5'), pg_temp.nowm(), 'system INSERT pending_removal without a month → current month');

SELECT * FROM finish();
ROLLBACK;
