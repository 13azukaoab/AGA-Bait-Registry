-- M19b (20261115160000): เปลี่ยนไม้รายสถานี (2.43) + เก็บสถานี IG คืนรายสถานี (2.42 · #collect FINAL)
--   A. เปลี่ยนไม้: บันทึกผ่าน save_service_visit (checks[].timber_replaced) · เลขที่ไม่ใช่ของสัญญา → SV001 ·
--      กล่อง AG เปลี่ยนไม้ไม่ได้ (SV011 ทั้ง RPC และ REST) · view รายเดือนนับจุดไม่ซ้ำ + ชิ้น IG×2 / IC×1
--   B. เก็บ IG: collect_ig_stations / skip_ig_collection — เก็บผู้กด + ทีม · ไม่เก็บ = วันที่ + เหตุผล + ผู้กด
--      · สิทธิ์ host / recorder ในขอบเขต · admin / viewer / นอกขอบเขต → 42501 · ช่องเก็บเขียนตรงไม่ได้ (ยกเว้น host)
--   C. view ทั้ง 3 ตัว: viewer ไม่เห็นแถว · anon อ่านไม่ได้
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated + request.jwt.claim.sub · RESET ROLE เพื่อตรวจ
BEGIN;
SELECT plan(92);

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_trigger('public', 'station_checks', 'station_checks_timber_type_guard', 'station_checks has the timber type guard');
SELECT has_trigger('public', 'stations', 'stations_collection_guard', 'stations has the collection guard');
SELECT has_view('public', 'v_contract_monthly_timber', 'timber monthly view exists');
SELECT has_view('public', 'v_contract_ig_collection', 'IG collection status view exists');
SELECT has_view('public', 'v_ig_collection_monthly', 'IG collection monthly view exists');
SELECT ok((SELECT bool_and(coalesce(reloptions, '{}') @> ARRAY['security_invoker=true'])
             FROM pg_class WHERE relname IN ('v_contract_monthly_timber', 'v_contract_ig_collection', 'v_ig_collection_monthly')
                             AND relnamespace = 'public'::regnamespace),
  'all three views are security_invoker (RLS of the base tables applies)');
SELECT ok(has_function_privilege('authenticated', 'public.collect_ig_stations(uuid, int, date, uuid, int[])', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.skip_ig_collection(uuid, int, date, uuid, text, int[])', 'EXECUTE'),
  'authenticated can call the two collection RPCs');
SELECT ok(NOT has_function_privilege('anon', 'public.collect_ig_stations(uuid, int, date, uuid, int[])', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.skip_ig_collection(uuid, int, date, uuid, text, int[])', 'EXECUTE'),
  'anon cannot call the collection RPCs');
SELECT ok(NOT has_function_privilege('authenticated', 'public.ig_collection_apply(text, uuid, int, date, uuid, text, int[])', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.ig_collection_apply(text, uuid, int, date, uuid, text, int[])', 'EXECUTE'),
  'nobody can call the internal ig_collection_apply directly');
SELECT ok(NOT has_function_privilege('authenticated', 'public.stations_collection_guard()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.station_checks_timber_type_guard()', 'EXECUTE'),
  'users cannot call the trigger functions');
SELECT ok(NOT has_table_privilege('anon', 'public.v_contract_monthly_timber', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.v_contract_ig_collection', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.v_ig_collection_monthly', 'SELECT'),
  'anon has no SELECT on the three views');

-- =====================================================================
-- seed
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local'),
  -- a5: login ได้แต่ไม่มีแถว profiles (role = NULL)
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'noprofile@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer',   'user_a4', 'viewer',   '{central}');
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1), 'Central'),
  ('00000000-0000-0000-0000-0000000000c2', (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1), 'Province');
-- d1 = หมดสัญญาแล้ว (เก็บ IG) · d2 = ยังใช้งาน (เปลี่ยนไม้ + เก็บไม่ได้) · d3 = หมดแล้วแต่อยู่สาขาต่างจังหวัด (นอกขอบเขต recorder)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'TC-1', '2025-01-15', 1, 50000, now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'TC-2', current_date - 400, 3, 90000, now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c2', 'TC-3', '2025-01-15', 1, 50000, now());
-- d4 = สัญญา Renew ของ d1 (ยังไม่ตั้งสถานี) — ทดสอบย้ายสถานีที่เก็บแล้ว (ส่วน D)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, renewed_from_contract_id) VALUES
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c1', 'TC-4', '2026-01-15', 1, 50000,
   '00000000-0000-0000-0000-0000000000d1');
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  -- d1: IG-1..6 ใช้งาน · IG-7 หาย · IC-1 · AG-1
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000000d1', 'IG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-0000000000d1', 'IG', 2, 'active'),
  ('00000000-0000-0000-0000-0000000001b3', '00000000-0000-0000-0000-0000000000d1', 'IG', 3, 'active'),
  ('00000000-0000-0000-0000-0000000001b4', '00000000-0000-0000-0000-0000000000d1', 'IG', 4, 'active'),
  ('00000000-0000-0000-0000-0000000001b5', '00000000-0000-0000-0000-0000000000d1', 'IG', 5, 'active'),
  ('00000000-0000-0000-0000-0000000001b6', '00000000-0000-0000-0000-0000000000d1', 'IG', 6, 'eliminated'),
  ('00000000-0000-0000-0000-0000000001b7', '00000000-0000-0000-0000-0000000000d1', 'IG', 7, 'lost'),
  ('00000000-0000-0000-0000-0000000001c1', '00000000-0000-0000-0000-0000000000d1', 'IC', 1, 'active'),
  ('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000000d1', 'AG', 1, 'active'),
  -- d2: IG-1..3 · IC-1 · AG-1
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000000d2', 'IG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000002b2', '00000000-0000-0000-0000-0000000000d2', 'IG', 2, 'active'),
  ('00000000-0000-0000-0000-0000000002b3', '00000000-0000-0000-0000-0000000000d2', 'IG', 3, 'active'),
  ('00000000-0000-0000-0000-0000000002c1', '00000000-0000-0000-0000-0000000000d2', 'IC', 1, 'active'),
  ('00000000-0000-0000-0000-0000000002e1', '00000000-0000-0000-0000-0000000000d2', 'AG', 1, 'active'),
  -- d3: IG-1
  ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-0000000000d3', 'IG', 1, 'active');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a,
                               (SELECT id FROM teams WHERE kind = 'supervisor' ORDER BY code LIMIT 1) AS sup,
                               (now() AT TIME ZONE 'Asia/Bangkok')::date AS today;
GRANT SELECT ON _t TO PUBLIC;
SELECT ok((SELECT a FROM _t) IS NOT NULL AND (SELECT sup FROM _t) IS NOT NULL,
  'seed: team A and a supervisor team exist (CL003 test is meaningful)');

-- payload ของ d2: ข้ามทุกจุด AG (D10) + checks
CREATE FUNCTION pg_temp.payload(p_visit uuid, p_date date, p_checks jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', p_visit, 'contract_id', '00000000-0000-0000-0000-0000000000d2'::uuid,
                            'visit_date', p_date, 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true,
                            'checks', p_checks)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(uuid, date, jsonb) TO PUBLIC;

CREATE FUNCTION pg_temp.tim(p_id text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('station_id', p_id::uuid, 'timber_replaced', true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.tim(text) TO PUBLIC;

-- =====================================================================
-- A. เปลี่ยนไม้ (recorder ในขอบเขต)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);

-- เดือนที่ 1 การเข้า 1: IG-1 IG-2 IC-1 (หน้าจอพิมพ์ "1 2" ใน IG และ "1" ใน IC)
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f1', '2026-01-10',
  jsonb_build_array(pg_temp.tim('00000000-0000-0000-0000-0000000002b1'), pg_temp.tim('00000000-0000-0000-0000-0000000002b2'),
                    pg_temp.tim('00000000-0000-0000-0000-0000000002c1'))))$$,
  'timber on IG-1, IG-2, IC-1 saves');
-- เดือนที่ 1 การเข้า 2: IG-1 ซ้ำ + IG-3
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2', '2026-01-25',
  jsonb_build_array(pg_temp.tim('00000000-0000-0000-0000-0000000002b1'), pg_temp.tim('00000000-0000-0000-0000-0000000002b3'))))$$,
  'second January visit: timber on IG-1 again and IG-3');
-- เดือนที่ 2: IC-1 + IG-2 ตรวจแต่ไม่เปลี่ยนไม้
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-02-12',
  jsonb_build_array(pg_temp.tim('00000000-0000-0000-0000-0000000002c1'),
                    jsonb_build_object('station_id', '00000000-0000-0000-0000-0000000002b2'))))$$,
  'February visit: timber on IC-1 only');

SELECT is((SELECT count(*)::int FROM station_checks WHERE timber_replaced
             AND visit_id IN ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3')),
  6, 'six per-station timber rows stored (3 + 2 + 1)');

-- เลขที่ไม่มีในสัญญา (สถานีของสัญญาอื่น) → SV001
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f4', '2026-03-10',
  jsonb_build_array(pg_temp.tim('00000000-0000-0000-0000-0000000001b1'))))$$,
  'SV001', NULL, 'timber on a station of another contract is rejected (SV001)');
-- id สถานีที่ไม่มีอยู่จริง → SV001
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f4', '2026-03-10',
  jsonb_build_array(pg_temp.tim('00000000-0000-0000-0000-00000000dead'))))$$,
  'SV001', NULL, 'timber on an unknown station is rejected (SV001)');
-- กล่อง AG ผ่าน RPC → SV011
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f4', '2026-03-10',
  jsonb_build_array(jsonb_build_object('station_id', '00000000-0000-0000-0000-0000000002e1', 'bait_added_g', 50,
                                       'timber_replaced', true))))$$,
  'SV011', NULL, 'timber on an AG box via the RPC is rejected (SV011)');
-- กล่อง AG ผ่าน REST ตรง (แก้แถวผลเดิม) → SV011
RESET ROLE;
INSERT INTO station_checks (visit_id, station_id, bait_added_g)
VALUES ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000002e1', 50)
ON CONFLICT (visit_id, station_id) DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$UPDATE station_checks SET timber_replaced = true
                    WHERE visit_id = '00000000-0000-0000-0000-0000000000f3' AND station_id = '00000000-0000-0000-0000-0000000002e1'$$,
  'SV011', NULL, 'timber on an AG box via a direct update is rejected (SV011)');
-- คู่ควบคุม: แก้ช่องอื่นของแถว AG เดิมได้ (trigger ไม่ได้กันทั้งแถว)
SELECT lives_ok($$UPDATE station_checks SET bait_added_g = 100
                    WHERE visit_id = '00000000-0000-0000-0000-0000000000f3' AND station_id = '00000000-0000-0000-0000-0000000002e1'$$,
  'control: other fields of an AG check row still update');

-- view รายเดือน
SELECT is((SELECT jsonb_build_array(ig_points, ic_points, total_points, timber_pieces)
             FROM v_contract_monthly_timber
            WHERE contract_id = '00000000-0000-0000-0000-0000000000d2' AND month = '2026-01-01'),
  '[3, 1, 4, 7]'::jsonb, 'January: IG 3 points, IC 1 point, 4 points, 7 pieces (IG-1 counted once)');
SELECT is((SELECT ig_station_nos FROM v_contract_monthly_timber
            WHERE contract_id = '00000000-0000-0000-0000-0000000000d2' AND month = '2026-01-01'),
  ARRAY[1, 2, 3], 'January IG station numbers listed once, in order');
SELECT is((SELECT ic_station_nos FROM v_contract_monthly_timber
            WHERE contract_id = '00000000-0000-0000-0000-0000000000d2' AND month = '2026-01-01'),
  ARRAY[1], 'January IC station numbers');
SELECT is((SELECT jsonb_build_array(ig_points, ic_points, total_points, timber_pieces)
             FROM v_contract_monthly_timber
            WHERE contract_id = '00000000-0000-0000-0000-0000000000d2' AND month = '2026-02-01'),
  '[0, 1, 1, 1]'::jsonb, 'February: only IC-1 (1 piece) — a checked IG without timber is not counted');
SELECT is((SELECT count(*)::int FROM v_contract_monthly_timber WHERE contract_id = '00000000-0000-0000-0000-0000000000d2'),
  2, 'only months with timber changes appear');

-- viewer ไม่เห็น (PDPA)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT is((SELECT count(*)::int FROM v_contract_monthly_timber), 0, 'viewer sees no timber rows');
-- admin อ่านได้
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT is((SELECT count(*)::int FROM v_contract_monthly_timber WHERE contract_id = '00000000-0000-0000-0000-0000000000d2'),
  2, 'admin reads the timber view');

-- =====================================================================
-- B. เก็บ IG
-- =====================================================================
-- B1. recorder เก็บ 2 สถานี (ระบุจำนวน) → IG-1, IG-2
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is((public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 2, (SELECT today FROM _t), (SELECT a FROM _t))
          ) - 'station_ids' - 'contract_id',
  jsonb_build_object('kind', 'collected', 'count', 2, 'station_nos', jsonb_build_array(1, 2), 'remaining', 4),
  'recorder collects 2 IG by count: lowest numbers first, 4 remaining (lost IG-7 not counted)');

RESET ROLE;
SELECT is((SELECT jsonb_agg(jsonb_build_array(station_no, collected_by, collected_team_id = (SELECT a FROM _t),
                                              (collected_at AT TIME ZONE 'Asia/Bangkok')::date = (SELECT today FROM _t))
                            ORDER BY station_no)
             FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND collected_at IS NOT NULL),
  jsonb_build_array(jsonb_build_array(1, '00000000-0000-0000-0000-0000000000a3', true, true),
                    jsonb_build_array(2, '00000000-0000-0000-0000-0000000000a3', true, true)),
  'collected_by = recorder, team = A, collected date = the chosen day (Bangkok)');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'stations' AND action = 'update'
                    AND row_id = '00000000-0000-0000-0000-0000000001b1'
                    AND changed_by = '00000000-0000-0000-0000-0000000000a3'
                    AND new_data ->> 'collected_by' = '00000000-0000-0000-0000-0000000000a3'),
  'collection is written to audit_log with the recorder as changed_by');
SET LOCAL ROLE authenticated;

-- B2. ไม่เก็บ: ต้องมีเหตุผล
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.skip_ig_collection('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT a FROM _t), E' 	
 ')$$,
  'CL004', NULL, 'not collected with a blank (spaces / tab / newline) reason is rejected (CL004)');
SELECT throws_ok($$SELECT public.skip_ig_collection('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT a FROM _t), repeat('ก', 301))$$,
  'CL004', NULL, 'a reason longer than 300 characters is rejected (CL004)');
SELECT is((public.skip_ig_collection('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t) - 1, (SELECT a FROM _t),
                                     '  ลูกค้าเทพื้นทับจุด  ') ->> 'remaining')::int,
  3, 'recorder marks 1 IG not collected (with reason) → 3 remaining');
RESET ROLE;
SELECT is((SELECT jsonb_build_array(station_no, not_collected_on = (SELECT today FROM _t) - 1, not_collected_reason,
                                    not_collected_by, not_collected_team_id = (SELECT a FROM _t), collected_at IS NULL)
             FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND not_collected_on IS NOT NULL),
  jsonb_build_array(3, true, 'ลูกค้าเทพื้นทับจุด', '00000000-0000-0000-0000-0000000000a3', true, true),
  'not collected stores date, trimmed reason, who pressed it and the team');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);

-- B3. ข้อผิดพลาด
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 4, (SELECT today FROM _t), (SELECT a FROM _t))$$,
  'CL002', NULL, 'collecting more than remaining is rejected (CL002)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 0, (SELECT today FROM _t), (SELECT a FROM _t))$$,
  'CL002', NULL, 'count 0 is rejected (CL002)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT a FROM _t), ARRAY[1])$$,
  'CL002', NULL, 'an already-collected station number is rejected (CL002)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT a FROM _t), ARRAY[7])$$,
  'CL002', NULL, 'a lost station cannot be collected (CL002)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT a FROM _t), ARRAY[99])$$,
  'CL002', NULL, 'an unknown station number is rejected (CL002)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT a FROM _t), ARRAY[4, 4])$$,
  'CL002', NULL, 'duplicated station numbers are rejected (CL002)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT sup FROM _t))$$,
  'CL003', NULL, 'a supervisor team is rejected (CL003, by teams.kind)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), NULL)$$,
  'CL003', NULL, 'no team is rejected (CL003)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t) + 1, (SELECT a FROM _t))$$,
  'CL005', NULL, 'a future date is rejected (CL005)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, '2024-12-31', (SELECT a FROM _t))$$,
  'CL005', NULL, 'a date before the contract start is rejected (CL005)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, '2025-06-01', (SELECT a FROM _t))$$,
  'CL005', NULL, 'a date while the contract was still running is rejected (CL005)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 2, (SELECT today FROM _t), (SELECT a FROM _t), ARRAY[4])$$,
  'CL002', NULL, 'count and station numbers that disagree are rejected (CL002)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d2', 1, (SELECT today FROM _t), (SELECT a FROM _t))$$,
  'CL001', NULL, 'an active contract cannot be collected yet (CL001)');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-00000000dead', 1, (SELECT today FROM _t), (SELECT a FROM _t))$$,
  'AG004', NULL, 'unknown contract (AG004)');

-- B4. สิทธิ์
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d3', 1, (SELECT today FROM _t), (SELECT a FROM _t))$$,
  '42501', NULL, 'recorder cannot collect for a contract outside the scope');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT a FROM _t))$$,
  '42501', NULL, 'admin cannot collect (read only)');
SELECT throws_ok($$SELECT public.skip_ig_collection('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT a FROM _t), 'x')$$,
  '42501', NULL, 'admin cannot mark not collected');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, (SELECT today FROM _t), (SELECT a FROM _t))$$,
  '42501', NULL, 'viewer cannot collect');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', true);
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-00000000dead', 1, (SELECT today FROM _t), (SELECT a FROM _t))$$,
  '42501', NULL, 'a user without a profile gets 42501 even for an unknown contract (no AG004 probing)');

-- host เก็บด้วยเลขที่ระบุ (IG-5) ได้ทุกสาขา
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT is((public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', NULL, (SELECT today FROM _t), (SELECT a FROM _t), ARRAY[5])
          ) ->> 'remaining',
  '2', 'host collects IG-5 by number → 2 remaining (IG-4, IG-6)');
SELECT lives_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d3', 1, (SELECT today FROM _t), (SELECT a FROM _t))$$,
  'host can collect in any branch');

-- B5. เขียนช่องเก็บตรง (REST) ไม่ได้ — ยกเว้น host
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$UPDATE stations SET point_label = 'rec-ok' WHERE id = '00000000-0000-0000-0000-0000000001b4'$$,
  'control: recorder still updates other station fields (row visible)');
SELECT is((SELECT point_label FROM stations WHERE id = '00000000-0000-0000-0000-0000000001b4'), 'rec-ok', 'control: the label change saved');
SELECT throws_ok($$UPDATE stations SET collected_at = now() WHERE id = '00000000-0000-0000-0000-0000000001b4'$$,
  '42501', NULL, 'recorder cannot set collected_at directly');
SELECT throws_ok($$UPDATE stations SET collected_by = '00000000-0000-0000-0000-0000000000a1' WHERE id = '00000000-0000-0000-0000-0000000001b1'$$,
  '42501', NULL, 'recorder cannot forge collected_by');
SELECT throws_ok($$UPDATE stations SET not_collected_on = current_date, not_collected_reason = 'x' WHERE id = '00000000-0000-0000-0000-0000000001b4'$$,
  '42501', NULL, 'recorder cannot mark not collected directly');
SELECT throws_ok($$UPDATE stations SET collected_at = NULL, collected_by = NULL, collected_team_id = NULL WHERE id = '00000000-0000-0000-0000-0000000001b1'$$,
  '42501', NULL, 'recorder cannot undo a collection directly');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, collected_by)
                   VALUES ('00000000-0000-0000-0000-0000000000d2', 'IG', 9, '00000000-0000-0000-0000-0000000000a3')$$,
  '42501', NULL, 'recorder cannot insert a station with collection fields');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$UPDATE stations SET collected_at = now() WHERE id = '00000000-0000-0000-0000-0000000001b4'$$,
  '42501', NULL, 'admin cannot set collected_at directly');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, collected_at)
                   VALUES ('00000000-0000-0000-0000-0000000000d2', 'IG', 9, now())$$,
  '42501', NULL, 'admin cannot insert a station that is already collected');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE stations SET collected_at = NULL, collected_by = NULL, collected_team_id = NULL
                   WHERE id = '00000000-0000-0000-0000-0000000003b1'$$,
  'host can still correct collection fields directly');
-- CHECK: เก็บแล้วกับไม่เก็บพร้อมกันไม่ได้ · ไม่เก็บต้องมีเหตุผล
SELECT throws_ok($$UPDATE stations SET not_collected_on = current_date, not_collected_reason = 'x'
                    WHERE id = '00000000-0000-0000-0000-0000000001b1'$$,
  '23514', NULL, 'a station cannot be both collected and not collected');
SELECT throws_ok($$UPDATE stations SET not_collected_on = current_date WHERE id = '00000000-0000-0000-0000-0000000001b4'$$,
  '23514', NULL, 'not collected needs a reason (CHECK)');

-- B6. view สรุป
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is((SELECT jsonb_build_array(ig_total, collected, not_collected, remaining)
             FROM v_contract_ig_collection WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'),
  '[6, 3, 1, 2]'::jsonb, 'all outstanding: 6 IG (lost excluded) · 3 collected · 1 not collected · 2 remaining');
SELECT is((SELECT last_collected_on FROM v_contract_ig_collection WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'),
  (SELECT today FROM _t), 'last collected date');
SELECT is((SELECT stations FROM v_ig_collection_monthly
            WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND kind = 'collected'
              AND month = date_trunc('month', (SELECT today FROM _t))::date AND team_id = (SELECT a FROM _t)),
  3, 'done this month: team A collected 3');
SELECT is((SELECT reasons FROM v_ig_collection_monthly
            WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND kind = 'not_collected'),
  ARRAY['ลูกค้าเทพื้นทับจุด'], 'monthly view lists the not-collected reason');
SELECT is((SELECT count(*)::int FROM v_contract_ig_collection WHERE contract_id = '00000000-0000-0000-0000-0000000000d2'),
  1, 'active contracts appear too (screen filters by contract end)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT is((SELECT count(*)::int FROM v_contract_ig_collection) + (SELECT count(*)::int FROM v_ig_collection_monthly),
  0, 'viewer sees no collection rows');

-- =====================================================================
-- D. Renew กับ IG ที่บันทึกแล้ว (DECISIONS 2.50)
--    ① เก็บแล้ว → ไม่ย้าย (ข้ามเฉพาะตัวนั้น) · ② ไม่เก็บ → ย้ายได้ + สัญญาเก่านับ "ย้ายไปสัญญาใหม่" · ③ ยังไม่บันทึก → ย้าย
--    สถานะ d1 ตอนนี้: IG-1,2,5 เก็บแล้ว · IG-3 ไม่เก็บ · IG-4, IG-6 ค้าง · IC-1
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d4', '{}', '{}',
                     ARRAY['00000000-0000-0000-0000-0000000001b4'::uuid, '00000000-0000-0000-0000-0000000003b1'::uuid])$$,
  'SV008', NULL, 'control: a station of another contract still cannot be moved (SV008)');
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d4', '{}', '{}',
                     ARRAY['00000000-0000-0000-0000-0000000001b1'::uuid])$$,
  'SV008', NULL, 'all chosen IG already collected and no new stations → SV008 (contract not left empty)');
SELECT is((SELECT stations_initialized_at FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d4'),
  NULL, 'the refused setup did not mark the new contract as initialized');
-- ข้อมูลเก่า: IC-1 มี collected_at (เขียนตรงก่อน M19b) → ต้องยังย้ายได้ (กฎ ① ใช้กับ IG เท่านั้น)
RESET ROLE;
UPDATE stations SET collected_at = now() WHERE id = '00000000-0000-0000-0000-0000000001c1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is(public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d4', ARRAY[10], '{}',
            ARRAY['00000000-0000-0000-0000-0000000001b1'::uuid,     -- ① เก็บแล้ว
                  '00000000-0000-0000-0000-0000000001b3'::uuid,     -- ② ไม่เก็บ
                  '00000000-0000-0000-0000-0000000001b4'::uuid,     -- ③ ค้าง
                  '00000000-0000-0000-0000-0000000001c1'::uuid]),   -- IC
  4, 'Renew succeeds: IG-3, IG-4, IC-1 moved + new IG-10 (collected IG-1 skipped, no error)');
SELECT is((SELECT jsonb_build_array(contract_id, collected_at IS NOT NULL)
             FROM stations WHERE id = '00000000-0000-0000-0000-0000000001b1'),
  jsonb_build_array('00000000-0000-0000-0000-0000000000d1', true),
  '① collected IG-1 stays on the old contract, still collected');
SELECT is((SELECT jsonb_build_array(contract_id, not_collected_on, not_collected_reason, not_collected_by, not_collected_team_id)
             FROM stations WHERE id = '00000000-0000-0000-0000-0000000001b3'),
  jsonb_build_array('00000000-0000-0000-0000-0000000000d4', NULL::text, NULL::text, NULL::text, NULL::text),
  '② not-collected IG-3 moved to the new contract and its not-collected fields are cleared');
SELECT is((SELECT contract_id FROM stations WHERE id = '00000000-0000-0000-0000-0000000001b4'),
  '00000000-0000-0000-0000-0000000000d4'::uuid, '③ unrecorded IG-4 moved as before');
SELECT is((SELECT count(*)::int FROM station_transfers
            WHERE from_contract_id = '00000000-0000-0000-0000-0000000000d1'
              AND to_contract_id = '00000000-0000-0000-0000-0000000000d4'),
  3, 'three transfer rows (IG-3, IG-4, IC-1) — none for the skipped IG-1');
SELECT is((SELECT jsonb_build_array(ig_total, collected, not_collected, moved_to_renewal, remaining)
             FROM v_contract_ig_collection WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'),
  '[6, 3, 0, 2, 1]'::jsonb,
  'old contract: total stays 6 · 3 collected · IG-3 counts as moved (not as not-collected) · 1 remaining (IG-6)');
SELECT is((SELECT stations FROM v_ig_collection_monthly
            WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND kind = 'moved_to_renewal'),
  2, 'monthly view shows 2 IG moved to the new contract');
SELECT is((SELECT count(*)::int FROM v_ig_collection_monthly
            WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND kind = 'not_collected'),
  0, 'monthly view no longer shows IG-3 as not collected');
SELECT is((SELECT jsonb_build_array(ig_total, not_collected, moved_to_renewal, remaining)
             FROM v_contract_ig_collection WHERE contract_id = '00000000-0000-0000-0000-0000000000d4'),
  '[3, 0, 0, 3]'::jsonb, 'new contract: IG-3, IG-4, IG-10 all in use (pending only after it ends)');
SELECT is((SELECT contract_id FROM stations WHERE id = '00000000-0000-0000-0000-0000000001c1'),
  '00000000-0000-0000-0000-0000000000d4'::uuid, 'legacy IC with collected_at still moved (skip applies to IG only)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT is((SELECT count(*)::int FROM v_contract_ig_collection) + (SELECT count(*)::int FROM v_ig_collection_monthly),
  0, 'viewer still sees no collection rows after transfers exist (moved branch under RLS)');

-- anon อ่าน view ไม่ได้
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT 1 FROM v_contract_monthly_timber$$, '42501', NULL, 'anon cannot read the timber view');
SELECT throws_ok($$SELECT 1 FROM v_contract_ig_collection$$, '42501', NULL, 'anon cannot read the collection view');
SELECT throws_ok($$SELECT 1 FROM v_ig_collection_monthly$$, '42501', NULL, 'anon cannot read the monthly collection view');
SELECT throws_ok($$SELECT public.collect_ig_stations('00000000-0000-0000-0000-0000000000d1', 1, current_date, NULL)$$,
  '42501', NULL, 'anon cannot call the collection RPC');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
