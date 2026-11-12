-- M13 (20261112160000): ข้อมูลติดตั้งของกล่อง AG ที่ฝังใหม่ในการเข้าเดียวกัน — ไม่นับเป็นรอบ F
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(35);

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_column('public', 'stations', 'install_bait_g', 'stations.install_bait_g exists');
SELECT col_type_is('public', 'stations', 'install_bait_g', 'integer', 'install_bait_g is int');
SELECT has_function('public', 'service_work_set_installs', ARRAY['uuid', 'jsonb'], 'service_work_set_installs exists');
SELECT is_definer('public', 'service_work_set_installs', ARRAY['uuid', 'jsonb'], 'service_work_set_installs is SECURITY DEFINER (gated)');
SELECT ok(NOT has_function_privilege('anon', 'public.service_work_set_installs(uuid, jsonb)', 'EXECUTE'),
  'anon cannot call service_work_set_installs');
SELECT has_trigger('public', 'stations', 'stations_install_bait_guard', 'install bait guard trigger exists');

-- =====================================================================
-- seed
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}');
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Central');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'S-1', '2026-01-15', 1, 50000, now());
INSERT INTO stations (id, contract_id, type, station_no) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'IG', 1),
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000d1', 'AG', 1);

-- CHECK: ใช้ได้เฉพาะ AG · หาร 50 ลงตัว
SELECT throws_ok($$UPDATE stations SET install_bait_g = 100 WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '23514', NULL, 'install bait on an IG station is rejected (AG only)');
SELECT throws_ok($$UPDATE stations SET install_bait_g = 120 WHERE id = '00000000-0000-0000-0000-0000000000e8'$$,
  '23514', NULL, 'install bait must be a multiple of 50 g');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a;
GRANT SELECT ON _t TO PUBLIC;

CREATE FUNCTION pg_temp.payload(p_visit uuid, p_date date, p_extra jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', p_visit, 'contract_id', '00000000-0000-0000-0000-0000000000d1',
                            'visit_date', p_date, 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', jsonb_build_array((SELECT a FROM _t))) || p_extra
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(uuid, date, jsonb) TO PUBLIC;

-- การเข้าครั้งที่ 1: ตรวจ AG-1 + ฝัง AG-3, AG-4 ใหม่ พร้อมเหยื่อ/ป้าย
CREATE TEMP TABLE _p AS SELECT pg_temp.payload('00000000-0000-0000-0000-0000000000f1', '2026-01-20',
  jsonb_build_object(
    'checks', jsonb_build_array(
      jsonb_build_object('station_id', '00000000-0000-0000-0000-0000000000e8', 'bait_added_g', 50, 'bait_eaten_pct', 25)),
    'works', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-0000-0000-00000000a001', 'kind', 'added', 'station_type', 'AG',
                         'station_nos', jsonb_build_array(3, 4),
                         'installs', jsonb_build_array(
                           jsonb_build_object('station_no', 3, 'bait_added_g', 100, 'point_label', 'ห้องครัว'),
                           jsonb_build_object('station_no', 4, 'bait_added_g', 150)))))) AS j;
GRANT SELECT ON _p TO PUBLIC;

-- =====================================================================
-- บันทึก (หัวหน้างาน)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);

SELECT throws_ok($$SELECT public.save_service_visit((SELECT jsonb_set(j, '{works,0,installs,0,station_no}', '5') FROM _p))$$,
  'SV001', NULL, 'install for a number outside the work is refused (SV001)');
SELECT throws_ok($$SELECT public.save_service_visit((SELECT jsonb_set(j, '{works,0,station_type}', '"IG"') FROM _p))$$,
  '22023', NULL, 'installs on a non-AG work are refused (22023)');
SELECT throws_ok($$SELECT public.save_service_visit((SELECT jsonb_set(j, '{works,0,installs,1,station_no}', '3') FROM _p))$$,
  '22023', NULL, 'duplicate station_no in installs is refused (22023)');
SELECT throws_ok($$SELECT public.service_work_set_installs('00000000-0000-0000-0000-00000000a001', '[]')$$,
  '42501', NULL, 'recorder cannot call service_work_set_installs directly');

SELECT lives_ok($$SELECT public.save_service_visit((SELECT j FROM _p))$$, 'save with new AG boxes + install data in one call');
SELECT lives_ok($$SELECT public.save_service_visit((SELECT j FROM _p))$$, 'retrying the same payload is fine');

-- ผู้ใช้แก้ install_bait_g ตรงไม่ได้
SELECT throws_ok($$UPDATE stations SET install_bait_g = 200
                    WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND type = 'AG' AND station_no = 3$$,
  '42501', NULL, 'recorder cannot change install bait directly (42501)');
RESET ROLE;

SELECT results_eq(
  $$SELECT station_no, install_bait_g, point_label FROM stations
     WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND type = 'AG' ORDER BY station_no$$,
  $$VALUES (1, NULL::int, NULL::text), (3, 100, 'ห้องครัว'), (4, 150, NULL)$$,
  'install bait + label stored on the new AG boxes only');
SELECT is((SELECT count(*)::int FROM station_checks sc JOIN stations s ON s.id = sc.station_id
            WHERE sc.visit_id = '00000000-0000-0000-0000-0000000000f1' AND s.station_no IN (3, 4) AND s.type = 'AG'), 0,
  'install data creates no station_checks rows (installation is not an F round)');
SELECT results_eq(
  $$SELECT bait_inside_g, install_bait_g FROM v_service_materials WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'$$,
  $$VALUES (300, 250)$$,
  'materials: inside bait = 50 (check) + 250 (install) · install column 250');

-- =====================================================================
-- แก้: เปลี่ยนเหยื่อ AG-3 · เอา AG-4 ออกจากรายการ (= ไม่มีเหยื่อติดตั้ง) · ไม่ส่ง point_label = ป้ายคงเดิม
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit((SELECT jsonb_set(j, '{works,0,installs}',
                    '[{"station_no": 3, "bait_added_g": 200}]') FROM _p))$$, 'edit install data');
RESET ROLE;
SELECT results_eq(
  $$SELECT station_no, install_bait_g, point_label FROM stations
     WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND type = 'AG' AND station_no IN (3, 4) ORDER BY station_no$$,
  $$VALUES (3, 200, 'ห้องครัว'), (4, NULL::int, NULL::text)$$,
  'edit: AG-3 200 g (label kept) · AG-4 cleared');

-- ไม่ส่ง key installs = ไม่แตะข้อมูลติดตั้ง
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit((SELECT j #- '{works,0,installs}' FROM _p))$$, 'save without installs key');
RESET ROLE;
SELECT is((SELECT install_bait_g FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
             AND type = 'AG' AND station_no = 3), 200, 'omitting installs leaves install data untouched');

-- host แก้ตรงได้
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE stations SET install_bait_g = 250
                   WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND type = 'AG' AND station_no = 3$$,
  'host can correct install bait directly');
RESET ROLE;

-- =====================================================================
-- การติดตามครั้งแรกหลังติดตั้ง = F1 (SPEC §7.5)
-- =====================================================================
CREATE TEMP TABLE _ids AS SELECT
  (SELECT id FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND type = 'AG' AND station_no = 3) AS ag3;
GRANT SELECT ON _ids TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2', '2026-02-20',
                   jsonb_build_object('skip_all_ag', true, 'checks', jsonb_build_array(
                     jsonb_build_object('station_id', (SELECT ag3 FROM _ids), 'bait_added_g', 50, 'bait_eaten_pct', 25)))))$$,
  'next visit checks AG-3');
RESET ROLE;
SELECT is((SELECT follow_up_no FROM station_checks WHERE visit_id = '00000000-0000-0000-0000-0000000000f2'
             AND station_id = (SELECT ag3 FROM _ids)), 1,
  'first follow-up after installation is F1');
SELECT is((SELECT follow_up_no FROM station_checks WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'
             AND station_id = '00000000-0000-0000-0000-0000000000e8'), 1,
  'AG-1 checked in visit 1 is F1 (unchanged by the install data)');

-- =====================================================================
-- ลบ/ย้อน: ใช้กติกาเดิม (SV005 ถ้าการเข้าถัดไปใช้กล่องแล้ว) · ลบแล้วกล่อง + ข้อมูลติดตั้งหายไป
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$,
  'SV005', NULL, 'visit 1 cannot be deleted while visit 2 uses AG-3 (SV005)');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f2')$$, 'delete visit 2');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$, 'delete visit 1');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
             AND type = 'AG' AND station_no IN (3, 4)), 0, 'deleting the visit removes the added boxes and their install data');

-- =====================================================================
-- บั๊ก SV001 (ศูนย์กลางเพิ่มเข้า M13): ผลตรวจจุด AG + "ถอดแล้ว" ในการเข้าเดียวกัน
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-10',
                   '{"checks": [{"station_id": "00000000-0000-0000-0000-0000000000e8", "bait_added_g": 50, "bait_eaten_pct": 50}]}'))$$,
  'visit 3 checks AG-1');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f4', '2026-03-20',
                   '{"checks": [{"station_id": "00000000-0000-0000-0000-0000000000e8", "bait_eaten_pct": 100}],
                     "station_statuses": [{"station_id": "00000000-0000-0000-0000-0000000000e8", "status": "removed"}]}'))$$,
  'result + "removed" for the same AG box in one visit saves (no SV001)');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f4', '2026-03-20',
                   '{"checks": [{"station_id": "00000000-0000-0000-0000-0000000000e8", "bait_eaten_pct": 100}],
                     "station_statuses": [{"station_id": "00000000-0000-0000-0000-0000000000e8", "status": "removed"}]}'))$$,
  'saving that visit again (retry/edit) still works after the box is removed');
RESET ROLE;
SELECT is((SELECT status::text FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e8'), 'removed',
  'AG-1 is removed after the save');
SELECT is((SELECT follow_up_no FROM station_checks WHERE visit_id = '00000000-0000-0000-0000-0000000000f4'
             AND station_id = '00000000-0000-0000-0000-0000000000e8'), 2,
  'the last result before removal counts as the next F (F2)');

SELECT * FROM finish();
ROLLBACK;
