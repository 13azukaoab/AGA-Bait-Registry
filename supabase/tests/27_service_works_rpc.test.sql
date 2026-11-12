-- ก้อน ③ (20261112150000): station_works · save_service_visit / delete_service_visit · v_service_materials
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(56);

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_table('public', 'station_works', 'station_works exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.station_works'::regclass), true, 'RLS on station_works');
SELECT table_privs_are('public', 'station_works', 'anon', ARRAY[]::text[], 'anon has no privilege on station_works');
SELECT has_trigger('public', 'station_works', 'audit_station_works', 'station_works changes are audited');
SELECT isnt_definer('public', 'save_service_visit', ARRAY['jsonb'], 'save_service_visit is SECURITY INVOKER');
SELECT isnt_definer('public', 'delete_service_visit', ARRAY['uuid'], 'delete_service_visit is SECURITY INVOKER');
SELECT ok(NOT has_function_privilege('anon', 'public.save_service_visit(jsonb)', 'EXECUTE'), 'anon cannot call save_service_visit');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_service_visit(uuid)', 'EXECUTE'), 'anon cannot call delete_service_visit');
SELECT ok(NOT has_function_privilege('anon', 'public.service_work_undo(uuid)', 'EXECUTE'), 'anon cannot call service_work_undo');
SELECT has_view('public', 'v_service_materials', 'v_service_materials exists');
SELECT ok((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.v_service_materials'::regclass),
  'materials view runs with the caller''s RLS');
SELECT table_privs_are('public', 'v_service_materials', 'anon', ARRAY[]::text[], 'anon cannot read the materials view');

-- =====================================================================
-- seed
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}');
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1), 'Central'),
  ('00000000-0000-0000-0000-0000000000c2', (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1), 'Province');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'S-1', '2026-01-15', 1, 50000, now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'S-NEW', '2026-01-15', 1, 50000, NULL),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c2', 'S-PROV', '2026-01-15', 1, 50000, now());
-- S-1: IG-1..5 · IC-1..2 · AG-1, AG-2
INSERT INTO stations (id, contract_id, type, station_no) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'IG', 1),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'IG', 2),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'IG', 3),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', 'IG', 4),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d1', 'IG', 5),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000d1', 'IC', 1),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000d1', 'IC', 2),
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000d1', 'AG', 1),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000d1', 'AG', 2);
CREATE TEMP TABLE _t AS
  SELECT (SELECT id FROM teams WHERE code = 'A') AS a, (SELECT id FROM teams WHERE code = 'Z') AS z,
         (SELECT id FROM teams WHERE code = 'Sup') AS sup;
GRANT SELECT ON _t TO PUBLIC;

-- ตัวช่วยสร้าง payload (ส่วนที่ไม่เปลี่ยนบ่อย)
CREATE FUNCTION pg_temp.payload(p_visit uuid, p_contract uuid, p_date date, p_teams uuid[], p_extra jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', p_visit, 'contract_id', p_contract, 'visit_date', p_date,
                            'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', to_jsonb(p_teams)) || p_extra
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(uuid, uuid, date, uuid[], jsonb) TO PUBLIC;

-- การเข้าครั้งที่ 1 (ม.ค.) ของ S-1
CREATE TEMP TABLE _p AS SELECT pg_temp.payload(
  '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-01-20',
  ARRAY[(SELECT a FROM _t)],
  jsonb_build_object(
    'checks', jsonb_build_array(
      jsonb_build_object('station_id', '00000000-0000-0000-0000-0000000000e1', 'termite_group', 'subterranean',
                         'bait_added_g', 100, 'timber_replaced', true),
      jsonb_build_object('station_id', '00000000-0000-0000-0000-0000000000e6', 'termite_group', 'garden', 'powder_points', 3),
      jsonb_build_object('station_id', '00000000-0000-0000-0000-0000000000e8', 'bait_added_g', 50, 'bait_eaten_pct', 25,
                         'termite_caste', 'ทหาร'),
      jsonb_build_object('station_id', '00000000-0000-0000-0000-0000000000e9', 'checked', false)),
    'works', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-0000-0000-00000000a001', 'kind', 'added', 'station_type', 'IG', 'station_nos', jsonb_build_array(7, 6)),
      jsonb_build_object('id', '00000000-0000-0000-0000-00000000a002', 'kind', 'lost', 'station_type', 'IG', 'station_nos', jsonb_build_array(2),
                         'detail', 'หาย อุปกรณ์ไม่พอซ่อม'),
      jsonb_build_object('id', '00000000-0000-0000-0000-00000000a003', 'kind', 'cap_replaced', 'station_type', 'IC', 'station_nos', jsonb_build_array(1))),
    'station_labels', jsonb_build_array(
      jsonb_build_object('station_id', '00000000-0000-0000-0000-0000000000e8', 'point_label', 'ห้องนอน'))
  )) AS j;
GRANT SELECT ON _p TO PUBLIC;

-- =====================================================================
-- บันทึกครั้งแรก (หัวหน้างาน)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit((SELECT j FROM _p))$$, 'recorder saves a whole visit in one call');
SELECT lives_ok($$SELECT public.save_service_visit((SELECT j FROM _p))$$, 'saving the same payload again (retry) is fine');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM visits WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'), 1,
  'a retried save does not create a second visit (client-generated visit id)');
SELECT is((SELECT count(*)::int FROM audit_log WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
             AND table_name IN ('visits', 'station_checks', 'visit_teams', 'station_works')), 0,
  'the identical retry changed nothing, so nothing was audited');
SELECT is((SELECT count(*)::int FROM visit_teams WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'), 1, 'one team saved');
SELECT is((SELECT count(*)::int FROM station_checks WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'), 4, 'four results saved');
SELECT is((SELECT checked FROM station_checks WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'
             AND station_id = '00000000-0000-0000-0000-0000000000e9'), false, 'AG-2 saved as not checked');
SELECT set_eq($$SELECT station_no FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
                 AND type = 'IG' AND status = 'active'$$,
  ARRAY[1, 3, 4, 5, 6, 7], 'IG in use after save: IG-2 lost, IG-6 and IG-7 added');
SELECT is((SELECT status::text FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e2'), 'lost', 'IG-2 marked lost');
SELECT is((SELECT point_label FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e8'), 'ห้องนอน', 'AG point label saved');
SELECT is((SELECT count(*)::int FROM station_works WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'), 3, 'three work rows');
SELECT is((SELECT station_nos FROM station_works WHERE id = '00000000-0000-0000-0000-00000000a001'), ARRAY[6, 7],
  'station numbers stored sorted');
SELECT results_eq(
  $$SELECT bait_outside_g, bait_inside_g, powder_points, powder_g, timber_pcs
      FROM v_service_materials WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'$$,
  $$VALUES (100, 50, 3, 0.9::numeric, 2)$$,
  'materials: outside 100 g · inside 50 g · powder 3 points = 0.9 g · timber IG 2 pieces');

-- =====================================================================
-- ด่านตรวจ
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2',
                     '00000000-0000-0000-0000-0000000000d1', '2026-02-20', ARRAY[(SELECT a FROM _t)], '{}'))$$,
  'SV004', NULL, 'forgetting the AG boxes is refused (SV004, D10)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2',
                     '00000000-0000-0000-0000-0000000000d1', '2026-02-20', ARRAY[(SELECT sup FROM _t)], '{"skip_all_ag": true}'))$$,
  'SV006', NULL, 'team Sup is not accepted on this page (SV006)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2',
                     '00000000-0000-0000-0000-0000000000d1', '2026-02-20', ARRAY[]::uuid[], '{"skip_all_ag": true}'))$$,
  'SV006', NULL, 'at least one team is required (SV006)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f9',
                     '00000000-0000-0000-0000-0000000000d2', '2026-02-20', ARRAY[(SELECT a FROM _t)], '{}'))$$,
  'SV003', NULL, 'stations must be set up first (SV003)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2',
                     '00000000-0000-0000-0000-0000000000d1', '2026-02-20', ARRAY[(SELECT a FROM _t)],
                     '{"skip_all_ag": true, "checks": [{"station_id": "00000000-0000-0000-0000-0000000000e2"}]}'))$$,
  'SV001', NULL, 'a lost station cannot get a result (SV001)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2',
                     '00000000-0000-0000-0000-0000000000d1', '2026-02-20', ARRAY[(SELECT a FROM _t)],
                     '{"skip_all_ag": true, "works": [{"kind": "added", "station_type": "IG", "station_nos": [3]}]}'))$$,
  'SV002', NULL, 'adding a number that is in use is refused (SV002)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2',
                     '00000000-0000-0000-0000-0000000000d1', '2026-02-20', ARRAY[(SELECT a FROM _t)],
                     '{"skip_all_ag": true, "works": [{"kind": "withdrawn", "station_type": "IG", "station_nos": [99]}]}'))$$,
  'SV001', NULL, 'withdrawing a station that does not exist is refused (SV001)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2',
                     '00000000-0000-0000-0000-0000000000d1', '2026-02-20', ARRAY[(SELECT a FROM _t)],
                     '{"skip_all_ag": true, "works": [{"kind": "other", "station_type": "IG", "station_nos": [3]}]}'))$$,
  '23514', NULL, '"other" needs a detail');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3',
                     '00000000-0000-0000-0000-0000000000d4', '2026-02-20', ARRAY[(SELECT a FROM _t)], '{}'))$$,
  '42501', NULL, 'recorder cannot record service outside their division');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT public.save_service_visit((SELECT j FROM _p))$$,
  '42501', NULL, 'admin cannot record service');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f2'), 0,
  'refused calls left no visit behind');

-- =====================================================================
-- การเข้าครั้งที่ 2 (ก.พ.) ข้ามทุกจุด AG · ตรวจ IG-6 ที่ฝังในครั้งที่ 1
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2',
                    '00000000-0000-0000-0000-0000000000d1', '2026-02-20', ARRAY[(SELECT z FROM _t)],
                    jsonb_build_object('skip_all_ag', true, 'checks', jsonb_build_array(
                      jsonb_build_object('station_id', (SELECT id FROM stations
                                                         WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
                                                           AND type = 'IG' AND station_no = 6),
                                         'termite_group', 'subterranean', 'bait_added_g', 50)))))$$,
  'second visit: skip all AG boxes, result on new IG-6');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM station_checks sc JOIN stations s ON s.id = sc.station_id
            WHERE sc.visit_id = '00000000-0000-0000-0000-0000000000f2' AND s.type = 'AG' AND NOT sc.checked), 2,
  'skip all AG = a not-checked row for every AG box');
SELECT is((SELECT follow_up_no FROM station_checks WHERE visit_id = '00000000-0000-0000-0000-0000000000f2'
             AND station_id = '00000000-0000-0000-0000-0000000000e8'), NULL::int,
  'skipped AG box does not get an F number');

-- =====================================================================
-- แก้ครั้งที่ 1
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
-- เอางานฝังใหม่ออก → IG-6 มีผลตรวจในครั้งที่ 2 แล้ว → ย้อนไม่ได้
SELECT throws_ok($$SELECT public.save_service_visit((SELECT j #- '{works,0}' FROM _p))$$,
  'SV005', NULL, 'undoing an add that a later visit already uses is refused (SV005)');
-- เอางาน "หาย" ออก + เปลี่ยนทีมเป็น Z + เปลี่ยนเหยื่อ IG-1 เป็น 150
SELECT lives_ok($$SELECT public.save_service_visit(
                    jsonb_set(jsonb_set((SELECT j #- '{works,1}' FROM _p),
                              '{team_ids}', to_jsonb(ARRAY[(SELECT z FROM _t)])),
                              '{checks,0,bait_added_g}', '150'))$$,
  'edit visit 1: drop the "lost" work, change team and bait');
RESET ROLE;
SELECT is((SELECT status::text FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e2'), 'active',
  'dropping the "lost" work restores IG-2 to its previous status');
SELECT is((SELECT bait_added_g FROM station_checks WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'
             AND station_id = '00000000-0000-0000-0000-0000000000e1'), 150, 'changed bait saved');
SELECT is((SELECT array_agg(t.code ORDER BY t.code) FROM visit_teams vt JOIN teams t ON t.id = vt.team_id
            WHERE vt.visit_id = '00000000-0000-0000-0000-0000000000f1'), ARRAY['Z'], 'team replaced by Z');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'station_checks' AND action = 'update'
             AND contract_id = '00000000-0000-0000-0000-0000000000d1'), 1,
  'only the one changed result is audited (unchanged results are not rewritten)');
SELECT is((SELECT count(*)::int FROM station_checks WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'
             AND station_id = '00000000-0000-0000-0000-0000000000e6'), 1, 'unchanged result kept (not deleted and re-added)');

-- =====================================================================
-- ลบ
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$,
  'SV005', NULL, 'visit 1 cannot be deleted while visit 2 uses the stations it added (SV005)');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f2')$$, 'delete visit 2');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$,
  'now visit 1 can be deleted (its added stations are undone)');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
             AND type = 'IG' AND station_no IN (6, 7)), 0, 'stations added by visit 1 are gone');
SELECT is((SELECT count(*)::int FROM visits WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'), 0,
  'both visits deleted');

-- ติดกล่อง AG ใหม่ (S) แล้วติดตามครั้งแรก = F1 (SPEC §7.5)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f5',
                    '00000000-0000-0000-0000-0000000000d1', '2026-03-10', ARRAY[(SELECT a FROM _t)],
                    jsonb_build_object('skip_all_ag', true, 'works', jsonb_build_array(
                      jsonb_build_object('kind', 'added', 'station_type', 'AG', 'station_nos', jsonb_build_array(3))))))$$,
  'install AG-3 (S) without a result row for it');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f6',
                    '00000000-0000-0000-0000-0000000000d1', '2026-04-10', ARRAY[(SELECT a FROM _t)],
                    jsonb_build_object('skip_all_ag', true, 'checks', jsonb_build_array(
                      jsonb_build_object('station_id', (SELECT id FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
                                                         AND type = 'AG' AND station_no = 3),
                                         'bait_added_g', 50)))))$$,
  'first follow-up of AG-3');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM station_checks sc JOIN stations s ON s.id = sc.station_id
            WHERE sc.visit_id = '00000000-0000-0000-0000-0000000000f5' AND s.type = 'AG' AND s.station_no = 3), 0,
  'the install visit has no result row for the new box (not even "not checked")');
SELECT is((SELECT sc.follow_up_no FROM station_checks sc JOIN stations s ON s.id = sc.station_id
            WHERE sc.visit_id = '00000000-0000-0000-0000-0000000000f6' AND s.type = 'AG' AND s.station_no = 3), 1,
  'the first follow-up after installing is F1');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.save_service_visit('{}'::jsonb)$$, '42501', NULL, 'anon is refused at the GRANT gate');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
