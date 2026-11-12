-- ก้อน ② schema หน้ากรอกข้อมูลทำบริการ (20261112130000 + 20261112130100)
--   สถานะ lost/withdrawn · เลขสถานีแยกชนิด (ใช้เลขเดิมได้ถ้าไม่ซ้ำกับที่ใช้งาน) · สิทธิ์ recorder บน stations
--   ผลตรวจรายสถานี + "ไม่ได้ตรวจ" · F นับเฉพาะที่ตรวจ + คำนวณใหม่ · ตั้งสถานีเดือนแรก / ย้ายตอน Renew
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(63);

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_column('public', 'stations', 'station_no', 'stations.station_no');
SELECT has_column('public', 'stations', 'point_label', 'stations.point_label');
SELECT has_index('public', 'stations', 'stations_in_use_no_key', 'unique number per contract/type among stations in use');
SELECT has_column('public', 'contracts', 'stations_initialized_at', 'contracts.stations_initialized_at');
SELECT ok('lost' = ANY (enum_range(NULL::station_status)::text[]), 'station_status has lost');
SELECT ok('withdrawn' = ANY (enum_range(NULL::station_status)::text[]), 'station_status has withdrawn');
SELECT has_column('public', 'station_checks', 'checked', 'station_checks.checked');
SELECT col_default_is('public', 'station_checks', 'checked', 'true', 'checked defaults to true');
SELECT has_table('public', 'station_transfers', 'station_transfers exists');
SELECT table_privs_are('public', 'station_transfers', 'anon', ARRAY[]::text[], 'anon has no privilege on station_transfers');
SELECT table_privs_are('public', 'station_transfers', 'authenticated', ARRAY['SELECT'],
  'authenticated may only read station_transfers (written by the system function)');
SELECT is_definer('public', 'initialize_contract_stations', ARRAY['uuid', 'integer[]', 'integer[]', 'uuid[]'],
  'initialize_contract_stations is security definer (checks permissions itself)');
SELECT ok(NOT has_function_privilege('anon', 'public.initialize_contract_stations(uuid, integer[], integer[], uuid[])', 'EXECUTE'),
  'anon cannot call initialize_contract_stations');

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
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, renewed_from_contract_id) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'OLD',  '2025-01-15', 1, 50000, NULL),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'X',    '2026-01-15', 1, 50000, NULL),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c2', 'PROV', '2026-01-15', 1, 50000, NULL),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000c1', 'X2',   '2026-01-15', 1, 50000, NULL);
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, status, cancelled_at) VALUES
  ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000c1', 'CANCEL', '2026-01-15', 1, 50000, 'cancelled', now());
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, renewed_from_contract_id) VALUES
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'NEW',  '2026-01-15', 1, 50000, '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000c1', 'NEW3', '2026-01-15', 1, 50000, '00000000-0000-0000-0000-0000000000d1');
-- สัญญาเก่า: IG-1..3 ใช้งาน · IG-4 หาย · AG-1 ใช้งาน
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'IG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'IG', 2, 'active'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'IG', 3, 'active'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', 'IG', 4, 'lost'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d1', 'AG', 1, 'active'),
-- สัญญา X: สำหรับทดสอบสิทธิ์และ F
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000d3', 'IG', 2, 'active'),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000d3', 'AG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000d3', 'IG', 4, 'lost'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000d6', 'IG', 1, 'active');
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d3', '2026-01-10', 'follow_up', '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d3', '2026-02-10', 'follow_up', '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d3', '2026-03-10', 'follow_up', '09:00', '10:00'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d1', '2025-06-10', 'follow_up', '09:00', '10:00');
-- AG-1 ของ X: ม.ค. ตรวจ · ก.พ. ไม่ได้ตรวจ · มี.ค. ตรวจ
INSERT INTO station_checks (id, visit_id, station_id, checked, bait_added_g) VALUES
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e7', true,  100),
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e7', false, NULL),
  ('00000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e7', true,  50),
-- AG-1 ของสัญญาเก่า: ตรวจ 1 ครั้ง (F1)
  ('00000000-0000-0000-0000-000000000b04', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000e5', true,  100);

CREATE FUNCTION pg_temp.fno(p uuid) RETURNS int LANGUAGE sql AS
  $$SELECT follow_up_no FROM public.station_checks WHERE id = p$$;

-- =====================================================================
-- F: นับเฉพาะที่ตรวจ · คำนวณใหม่เมื่อแก้/ลบ
-- =====================================================================
SELECT results_eq(
  $$SELECT pg_temp.fno('00000000-0000-0000-0000-000000000b01'), pg_temp.fno('00000000-0000-0000-0000-000000000b02'),
           pg_temp.fno('00000000-0000-0000-0000-000000000b03')$$,
  $$VALUES (1, NULL::int, 2)$$, 'F counts checked rounds only (Jan F1 · Feb not checked · Mar F2)');

UPDATE station_checks SET follow_up_no = 99 WHERE id = '00000000-0000-0000-0000-000000000b03';
SELECT is(pg_temp.fno('00000000-0000-0000-0000-000000000b03'), 2, 'a typed F number is overwritten on update');

UPDATE visits SET visit_date = '2026-04-10' WHERE id = '00000000-0000-0000-0000-0000000000f1';
SELECT results_eq(
  $$SELECT pg_temp.fno('00000000-0000-0000-0000-000000000b01'), pg_temp.fno('00000000-0000-0000-0000-000000000b03')$$,
  $$VALUES (2, 1)$$, 'moving the January visit to April renumbers the station (Mar F1 · Apr F2)');

DELETE FROM station_checks WHERE id = '00000000-0000-0000-0000-000000000b03';
SELECT is(pg_temp.fno('00000000-0000-0000-0000-000000000b01'), 1, 'deleting the March check renumbers April to F1');

UPDATE station_checks SET checked = true WHERE id = '00000000-0000-0000-0000-000000000b02';
SELECT results_eq(
  $$SELECT pg_temp.fno('00000000-0000-0000-0000-000000000b02'), pg_temp.fno('00000000-0000-0000-0000-000000000b01')$$,
  $$VALUES (1, 2)$$, 'marking February as checked renumbers (Feb F1 · Apr F2)');

SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name = 'station_checks' AND action = 'update'
              AND (old_data - 'follow_up_no') = (new_data - 'follow_up_no')), 0,
  'system renumbering alone is not written to audit_log');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name = 'station_checks' AND action = 'update'
              AND (old_data ->> 'checked') IS DISTINCT FROM (new_data ->> 'checked')), 1,
  'a real change (checked) is still audited');

-- =====================================================================
-- ข้อมูลผลตรวจ
-- =====================================================================
SELECT lives_ok($$INSERT INTO station_checks (visit_id, station_id, bait_added_g)
                  VALUES ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e6', 250)$$,
  'bait 250 g (over 200, step 50) is accepted');
SELECT throws_ok($$INSERT INTO station_checks (visit_id, station_id, bait_added_g)
                   VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e6', 230)$$,
  '23514', NULL, 'bait not divisible by 50 is refused');
SELECT throws_ok($$INSERT INTO station_checks (visit_id, station_id, bait_added_g)
                   VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e6', 5050)$$,
  '23514', NULL, 'bait over 5,000 g is refused');
SELECT throws_ok($$INSERT INTO station_checks (visit_id, station_id, bait_eaten_pct)
                   VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e6', 30)$$,
  '23514', NULL, 'bait eaten must be 0/25/50/75/100');
SELECT throws_ok($$INSERT INTO station_checks (visit_id, station_id, checked, bait_added_g)
                   VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e6', false, 50)$$,
  '23514', NULL, 'a not-checked point cannot carry results');
SELECT throws_ok($$INSERT INTO station_checks (visit_id, station_id, termite_group, bait_added_g)
                   VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e6', 'garden', 50)$$,
  '23514', NULL, 'garden termites get powder, not bait');
SELECT throws_ok($$INSERT INTO station_checks (visit_id, station_id, termite_group, powder_points)
                   VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e6', 'subterranean', 3)$$,
  '23514', NULL, 'powder points only for garden termites');
SELECT throws_ok($$INSERT INTO station_checks (visit_id, station_id)
                   VALUES ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e6')$$,
  '23505', NULL, 'one result per station per visit');

-- =====================================================================
-- สิทธิ์หัวหน้างานบน stations
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$INSERT INTO stations (contract_id, type, station_no) VALUES ('00000000-0000-0000-0000-0000000000d3', 'IG', 5)$$,
  'recorder adds a new station in scope');
SELECT lives_ok($$INSERT INTO stations (contract_id, type, station_no) VALUES ('00000000-0000-0000-0000-0000000000d3', 'IG', 4)$$,
  'recorder reuses the number of a lost station');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no) VALUES ('00000000-0000-0000-0000-0000000000d3', 'IG', 2)$$,
  '23505', NULL, 'a number already in use on the contract is refused');
SELECT throws_ok($$INSERT INTO stations (contract_id, type) VALUES ('00000000-0000-0000-0000-0000000000d3', 'IG')$$,
  '42501', NULL, 'recorder cannot add a station without a number');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, status) VALUES ('00000000-0000-0000-0000-0000000000d3', 'IG', 9, 'removed')$$,
  '42501', NULL, 'recorder cannot add a station that is not active');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no) VALUES ('00000000-0000-0000-0000-0000000000d4', 'IG', 1)$$,
  '42501', NULL, 'recorder cannot add stations outside their division');
SELECT lives_ok($$UPDATE stations SET status = 'lost', point_label = 'หน้าบ้าน' WHERE id = '00000000-0000-0000-0000-0000000000e6'$$,
  'recorder changes status and point label');
SELECT throws_ok($$UPDATE stations SET station_no = 7 WHERE id = '00000000-0000-0000-0000-0000000000e7'$$,
  '42501', NULL, 'recorder cannot renumber a station');
SELECT throws_ok($$UPDATE stations SET contract_id = '00000000-0000-0000-0000-0000000000d6' WHERE id = '00000000-0000-0000-0000-0000000000e7'$$,
  '42501', NULL, 'recorder cannot move a station to another contract directly');
DELETE FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e7';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e7'), 1,
  'recorder cannot delete stations');
SELECT is((SELECT status::text FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e6'), 'lost',
  'status change saved');

-- =====================================================================
-- ตั้งสถานีเดือนแรก / ย้ายตอน Renew
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d2', '{1}')$$,
  '42501', NULL, 'admin cannot set up stations (recorder / host only)');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d4', '{1}')$$,
  '42501', NULL, 'recorder cannot set up stations outside their division');
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d2', '{1,1}')$$,
  'SV009', NULL, 'duplicate new numbers are refused (SV009)');
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d6', '{}', '{}',
                     ARRAY['00000000-0000-0000-0000-0000000000e1']::uuid[])$$,
  'SV008', NULL, 'a contract that is not a renewal cannot take stations (SV008)');
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d2', '{}', '{}',
                     ARRAY['00000000-0000-0000-0000-0000000000e4']::uuid[])$$,
  'SV008', NULL, 'a lost station cannot be moved (SV008)');
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d5', '{3}', '{}',
                     ARRAY['00000000-0000-0000-0000-0000000000e3']::uuid[])$$,
  'SV009', NULL, 'a new number cannot collide with a moved station (SV009)');

-- หัวหน้างานเลือกย้าย IG-1, IG-2, AG-1 · ไม่ย้าย IG-3 · เพิ่ม IG-3 ใหม่ + IC-1, IC-2
SELECT is(public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d2', '{3}', '{1,2}',
            ARRAY['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2',
                  '00000000-0000-0000-0000-0000000000e5']::uuid[]),
  6, 'renewal set-up: 3 moved + 3 new stations in use');
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d2', '{9}')$$,
  'SV007', NULL, 'stations can be set up only once per contract (SV007)');

-- AG-1 ที่ย้ายมา: เข้าบริการครั้งแรกของสัญญาใหม่ → F นับต่อเป็น F2
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time)
  VALUES ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000d2', '2026-02-10', 'follow_up', '09:00', '10:00');
INSERT INTO station_checks (id, visit_id, station_id, bait_added_g)
  VALUES ('00000000-0000-0000-0000-000000000b05', '00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000e5', 50);
RESET ROLE;

SELECT is(pg_temp.fno('00000000-0000-0000-0000-000000000b05'), 2, 'moved AG box keeps counting F (F2 on the new contract)');
SELECT is((SELECT count(*)::int FROM station_transfers
            WHERE from_contract_id = '00000000-0000-0000-0000-0000000000d1'
              AND to_contract_id = '00000000-0000-0000-0000-0000000000d2'), 3,
  'every moved station is recorded in station_transfers');
SELECT is((SELECT count(*)::int FROM visits v JOIN station_checks sc ON sc.visit_id = v.id
            WHERE v.contract_id = '00000000-0000-0000-0000-0000000000d1'), 1,
  'service history of the old contract stays with the old contract');
SELECT set_eq(
  $$SELECT type::text || '-' || station_no FROM stations
     WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND status IN ('active', 'eliminated', 'pending_removal')$$,
  $$VALUES ('IG-3')$$,
  'the station not chosen stays on the old contract (goes to the collection list)');
SELECT ok((SELECT stations_initialized_at IS NOT NULL FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'),
  'the new contract is marked as set up');

-- ลบสัญญา Renew ที่เปิดผิด → สถานีที่ย้ายเข้ามา (IG ไม่มีผลตรวจ) ต้องคืนกลับสัญญาเดิม ไม่หาย
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT is(public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d5', '{}', '{}',
            ARRAY['00000000-0000-0000-0000-0000000000e3']::uuid[]),
  1, 'host moves IG-3 into a second renewal');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok($$SELECT public.delete_job_opening('00000000-0000-0000-0000-0000000000d5')$$,
  'admin deletes the mistaken renewal (no service results)');
RESET ROLE;
SELECT is((SELECT contract_id FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e3'),
  '00000000-0000-0000-0000-0000000000d1'::uuid,
  'the moved station returns to the old contract instead of being deleted');
SELECT is((SELECT count(*)::int FROM station_transfers WHERE to_contract_id = '00000000-0000-0000-0000-0000000000d5'), 0,
  'transfer records of the deleted renewal are removed');

-- ฟังก์ชันภายในเรียกจากภายนอกไม่ได้
SELECT ok(NOT has_function_privilege('authenticated', 'public.compute_follow_up_no(uuid, uuid, uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.compute_follow_up_no(uuid, uuid, uuid)', 'EXECUTE'),
  'compute_follow_up_no is internal');
SELECT ok(NOT has_function_privilege('authenticated', 'public.renumber_station_follow_ups(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.renumber_station_follow_ups(uuid)', 'EXECUTE'),
  'renumber_station_follow_ups is internal');

-- ---------- แก้ตามผลตรวจของศูนย์กลาง ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$UPDATE stations SET created_at = now() - interval '1 day' WHERE id = '00000000-0000-0000-0000-0000000000e9'$$,
  '42501', NULL, 'recorder cannot change created_at of a station');
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d7', '{1}')$$,
  'AG007', NULL, 'recorder cannot set up stations of a cancelled contract (AG007, DECISIONS 3.11)');
SELECT throws_ok($$SELECT public.initialize_contract_stations('00000000-0000-0000-0000-0000000000d6', '{1}')$$,
  'SV009', NULL, 'a new number that collides with a station already in use on the contract gives SV009 (not a raw 23505)');
RESET ROLE;
SELECT ok((SELECT prosrc LIKE '%pg_advisory_xact_lock%' FROM pg_proc WHERE proname = 'set_follow_up_no'),
  'F numbering takes a per-station lock (concurrent saves of one station)');
SELECT ok((SELECT prosrc LIKE '%pg_advisory_xact_lock%' FROM pg_proc WHERE proname = 'renumber_station_follow_ups'),
  'F renumbering takes the same per-station lock');

SELECT * FROM finish();
ROLLBACK;
