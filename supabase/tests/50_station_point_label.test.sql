-- M37 (20261115240000): แก้ป้ายจุดกล่อง AG อย่างเดียว — set_station_point_label + ปิดการแก้ป้ายตรง (REST) ทุก role
--   * host / recorder ในขอบเขต แก้ได้ · admin / viewer / anon / recorder นอกขอบเขต → 42501
--   * เฉพาะ AG (SV012) · เฉพาะ active / pending_removal (SV013) · btrim + ว่าง = NULL · เกิน 40 ตัวอักษร → 22001
--   * ไม่สร้าง visits / station_checks · status / pending_removal_month คงเดิม · audit 1 แถว (old/new + actor_position_code)
--   * REST ตรง (admin / recorder / host) → SV014 · save_service_visit (station_labels) ยังแก้ได้
-- ข้อมูลสมมติทั้งหมด
BEGIN;
SELECT plan(45);

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
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Test AG');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'TST-PL', '2026-01-15', 12, 50000, now());
-- AG-1 ใช้งาน · AG-2 รอถอด · AG-3 ถอดแล้ว · AG-4 กำจัดแล้ว · AG-5 หาย · AG-6 ถอนออก · IG-1 ใช้งาน
INSERT INTO stations (id, contract_id, type, station_no, status, removed_at, point_label) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'AG', 1, 'active',          NULL,         NULL),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'AG', 2, 'pending_removal', NULL,         'old-2'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'AG', 3, 'removed',         '2026-02-01', 'old-3'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', 'AG', 4, 'eliminated',      NULL,         'old-4'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d1', 'AG', 5, 'lost',            NULL,         'old-5'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000d1', 'AG', 6, 'withdrawn',       '2026-02-01', 'old-6'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'IG', 1, 'active',          NULL,         'ig-old');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a,
  (SELECT pending_removal_month FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e2') AS prm2;
GRANT SELECT ON _t TO PUBLIC;
CREATE FUNCTION pg_temp.lbl(p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT point_label FROM stations WHERE id = ('00000000-0000-0000-0000-0000000000' || p_id)::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.lbl(text) TO PUBLIC;
CREATE FUNCTION pg_temp.sid(p_id text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000000000' || p_id)::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sid(text) TO PUBLIC;

-- =====================================================================
-- โครงสร้าง / สิทธิ์ฟังก์ชัน
-- =====================================================================
SELECT has_function('public', 'set_station_point_label', ARRAY['uuid', 'text'], 'set_station_point_label exists');
SELECT ok(has_function_privilege('authenticated', 'public.set_station_point_label(uuid, text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.set_station_point_label(uuid, text)', 'EXECUTE'),
  'RPC: authenticated may execute · anon may not');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.set_station_point_label(uuid, text)'::regprocedure)
          AND (SELECT proconfig::text LIKE '%search_path%' FROM pg_proc WHERE oid = 'public.set_station_point_label(uuid, text)'::regprocedure),
  'RPC is SECURITY DEFINER with a pinned search_path');
SELECT has_trigger('public', 'stations', 'stations_rpc_only_point_label', 'REST guard trigger exists');
SELECT ok(NOT has_function_privilege('authenticated', 'public.stations_point_label_rpc_only()', 'EXECUTE'),
  'guard function is not callable by users');
SELECT is((SELECT max(tgname) FROM pg_trigger
            WHERE tgrelid = 'public.stations'::regclass AND NOT tgisinternal
              AND tgtype & 2 = 2),                                             -- BEFORE triggers
  'stations_rpc_only_point_label', 'the guard is the last BEFORE trigger on stations (old guards fire first)');

-- =====================================================================
-- 1. RPC — สิทธิ์
-- =====================================================================
SET LOCAL ROLE authenticated;
-- host
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT results_eq(
  $$SELECT station_id, point_label FROM public.set_station_point_label(pg_temp.sid('e2'), '  ห้องครัว  ')$$,
  $$VALUES (pg_temp.sid('e2'), 'ห้องครัว'::text)$$,
  'host edits the label of a pending_removal AG box (trimmed) and gets the row back');
-- recorder ในขอบเขต
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e1'), 'ห้องนอน')$$,
  'recorder in scope edits the label of an active AG box');
SELECT is(pg_temp.lbl('e1'), 'ห้องนอน', 'the recorder label is saved');
-- recorder นอกขอบเขต
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', true);
SELECT throws_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e1'), 'x')$$,
  '42501', NULL, 'recorder out of scope → 42501');
SELECT throws_ok($$SELECT * FROM public.set_station_point_label('00000000-0000-0000-0000-00000000ffff', 'x')$$,
  '42501', NULL, 'recorder with an unknown id → 42501 (does not reveal whether it exists)');
-- admin
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e1'), 'x')$$,
  '42501', NULL, 'admin → 42501 (DECISIONS 2.65)');
-- viewer
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e1'), 'x')$$,
  '42501', NULL, 'viewer → 42501');
RESET ROLE;
-- anon
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.set_station_point_label('00000000-0000-0000-0000-0000000000e1', 'x')$$,
  '42501', NULL, 'anon → 42501 (no EXECUTE)');
RESET ROLE;
SELECT is(pg_temp.lbl('e1'), 'ห้องนอน', 'refused calls left the label unchanged');

-- =====================================================================
-- 2. RPC — ชนิด / สถานะ / ค่า
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('b1'), 'x')$$,
  'SV012', NULL, 'IG station → SV012');
SELECT throws_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e3'), 'x')$$,
  'SV013', NULL, 'removed box → SV013');
SELECT throws_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e4'), 'x')$$,
  'SV013', NULL, 'eliminated box → SV013');
SELECT throws_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e5'), 'x')$$,
  'SV013', NULL, 'lost box → SV013');
SELECT throws_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e6'), 'x')$$,
  'SV013', NULL, 'withdrawn box → SV013');
SELECT throws_ok($$SELECT * FROM public.set_station_point_label('00000000-0000-0000-0000-00000000ffff', 'x')$$,
  'AG004', NULL, 'host with an unknown id → AG004');
SELECT throws_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e1'), repeat('ก', 41))$$,
  '22001', NULL, '41 characters → 22001');
SELECT lives_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e1'), repeat('ก', 40))$$,
  '40 Thai characters (more than 40 bytes) are allowed');
SELECT lives_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e1'), '   ')$$,
  'blank label is accepted');
SELECT is(pg_temp.lbl('e1'), NULL, 'blank label → NULL');
SELECT lives_ok($$SELECT * FROM public.set_station_point_label(pg_temp.sid('e1'), NULL)$$,
  'NULL label on an already empty label is a no-op');
RESET ROLE;
SELECT is(pg_temp.lbl('e3') || pg_temp.lbl('e4') || pg_temp.lbl('e5') || pg_temp.lbl('e6') || pg_temp.lbl('b1'),
  'old-3old-4old-5old-6ig-old', 'refused stations keep their labels');

-- =====================================================================
-- 3. RPC ไม่แตะอย่างอื่น + audit
-- =====================================================================
SELECT is((SELECT count(*)::int FROM visits WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'), 0,
  'no visit rows were created');
SELECT is((SELECT count(*)::int FROM station_checks sc JOIN stations s ON s.id = sc.station_id
            WHERE s.contract_id = '00000000-0000-0000-0000-0000000000d1'), 0,
  'no station_checks rows were created');
SELECT is((SELECT status::text FROM stations WHERE id = pg_temp.sid('e2')), 'pending_removal', 'AG-2 status unchanged');
SELECT is((SELECT pending_removal_month FROM stations WHERE id = pg_temp.sid('e2')), (SELECT prm2 FROM _t),
  'AG-2 pending_removal_month unchanged');
SELECT is((SELECT status::text FROM stations WHERE id = pg_temp.sid('e1')), 'active', 'AG-1 status unchanged');
SELECT results_eq(
  $$SELECT old_data ->> 'point_label', new_data ->> 'point_label', changed_by, actor_position_code
      FROM audit_log WHERE table_name = 'stations' AND row_id = '00000000-0000-0000-0000-0000000000e2' AND action = 'update'$$,
  $$VALUES ('old-2'::text, 'ห้องครัว'::text, '00000000-0000-0000-0000-0000000000a1'::uuid, 'pm'::text)$$,
  'exactly one audit row for the host edit (old → new, actor, position)');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'stations' AND row_id = pg_temp.sid('e1')
            AND action = 'update' AND actor_position_code = 'supervisor' AND changed_by = '00000000-0000-0000-0000-0000000000a3'),
  1, 'the recorder edit is audited with the recorder position');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'stations' AND row_id = pg_temp.sid('e1')
            AND action = 'update'), 3, 'AG-1: 3 real changes → 3 audit rows (the no-op NULL call wrote none)');

-- =====================================================================
-- 4. REST ตรง: แก้ป้ายไม่ได้ทุก role (SV014)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$UPDATE stations SET point_label = 'admin' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  'SV014', NULL, 'admin direct update of point_label → SV014');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, point_label)
                   VALUES ('00000000-0000-0000-0000-0000000000d1', 'AG', 9, 'admin')$$,
  'SV014', NULL, 'admin direct insert with a point_label → SV014');
SELECT lives_ok($$UPDATE stations SET code = 'AG-01' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  'admin still updates other fields of the same row');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$UPDATE stations SET point_label = 'rec' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  'SV014', NULL, 'recorder direct update of point_label → SV014');
SELECT throws_ok($$UPDATE stations SET point_label = 'rec', station_no = 8 WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '42501', NULL, 'older guards fire first (recorder renumber → 42501, not SV014)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$UPDATE stations SET point_label = 'host' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  'SV014', NULL, 'host direct update of point_label → SV014');
RESET ROLE;
SELECT is(pg_temp.lbl('e1'), NULL, 'AG-1 label unchanged after the refused REST updates');

-- =====================================================================
-- 5. ทางเดิมที่ถูกต้อง: save_service_visit (station_labels) ยังแก้ป้ายได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(jsonb_build_object(
    'visit_id', '00000000-0000-0000-0000-0000000000f1', 'contract_id', '00000000-0000-0000-0000-0000000000d1',
    'visit_date', '2026-01-20', 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
    'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true,
    'station_labels', jsonb_build_array(jsonb_build_object('station_id', '00000000-0000-0000-0000-0000000000e1',
                                                           'point_label', ' หลังบ้าน '))))$$,
  'recorder saves a visit with station_labels');
RESET ROLE;
SELECT is(pg_temp.lbl('e1'), 'หลังบ้าน', 'save_service_visit still sets the label (aga.service_visit gate)');
-- ระบบ (postgres) แก้ตรงได้ (นำเข้า / แก้ข้อมูล)
UPDATE stations SET point_label = 'sys' WHERE id = '00000000-0000-0000-0000-0000000000e3';
SELECT is(pg_temp.lbl('e3'), 'sys', 'system (postgres) may still set labels directly');

SELECT * FROM finish();
ROLLBACK;
