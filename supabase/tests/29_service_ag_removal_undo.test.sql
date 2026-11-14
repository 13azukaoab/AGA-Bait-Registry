-- M14 (20261112170000): ลบ/แก้การเข้าที่ถอดกล่อง AG → ย้อนสถานะกล่องกลับเป็นค่าก่อนถอด (DECISIONS 2.22 ก)
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(54);

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_table('public', 'station_ag_removals', 'station_ag_removals exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.station_ag_removals'::regclass), true,
  'RLS on station_ag_removals');
SELECT table_privs_are('public', 'station_ag_removals', 'anon', ARRAY[]::text[], 'anon has no privilege on station_ag_removals');
SELECT table_privs_are('public', 'station_ag_removals', 'authenticated', ARRAY['SELECT'],
  'users can only read station_ag_removals (writes go through the RPC)');
SELECT is_definer('public', 'service_ag_removal_capture', ARRAY['uuid', 'uuid[]'], 'capture helper is SECURITY DEFINER (gated)');
SELECT is_definer('public', 'service_ag_removal_restore', ARRAY['uuid', 'uuid[]'], 'restore helper is SECURITY DEFINER (gated)');
SELECT ok(NOT has_function_privilege('anon', 'public.service_ag_removal_capture(uuid, uuid[])', 'EXECUTE'),
  'anon cannot call the capture helper');
SELECT ok(NOT has_function_privilege('anon', 'public.service_ag_removal_restore(uuid, uuid[])', 'EXECUTE'),
  'anon cannot call the restore helper');
SELECT isnt_definer('public', 'save_service_visit', ARRAY['jsonb'], 'save_service_visit stays SECURITY INVOKER');
SELECT isnt_definer('public', 'delete_service_visit', ARRAY['uuid'], 'delete_service_visit stays SECURITY INVOKER');
SELECT ok(NOT has_function_privilege('anon', 'public.save_service_visit(jsonb)', 'EXECUTE'), 'anon still cannot call save_service_visit');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_service_visit(uuid)', 'EXECUTE'), 'anon still cannot call delete_service_visit');

-- =====================================================================
-- seed
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec-prov@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',          'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder',      'user_a3', 'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'recorder prov', 'user_a4', 'recorder', '{province}');
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Central');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'S-1', '2026-01-15', 1, 50000, now());
-- AG-1 ใช้งาน · AG-2 รอถอด · AG-3 ใช้งาน
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'AG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'AG', 2, 'pending_removal'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'AG', 3, 'active');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a;
GRANT SELECT ON _t TO PUBLIC;

-- payload พื้นฐาน: ข้ามทุกจุด AG (D10) + รายการสถานะ
CREATE FUNCTION pg_temp.payload(p_visit uuid, p_date date, p_statuses jsonb, p_extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', p_visit, 'contract_id', '00000000-0000-0000-0000-0000000000d1',
                            'visit_date', p_date, 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true,
                            'station_statuses', p_statuses) || p_extra
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(uuid, date, jsonb, jsonb) TO PUBLIC;

CREATE FUNCTION pg_temp.st(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT status::text FROM stations WHERE id = p_id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.st(uuid) TO PUBLIC;

-- =====================================================================
-- 1. ถอดในการเข้า V1 แล้วลบ V1 → กลับเป็นค่าก่อนถอด
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);

SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f1', '2026-01-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"},
    {"station_id": "00000000-0000-0000-0000-0000000000e2", "status": "removed"}]'))$$,
  'V1 removes AG-1 (active) and AG-2 (pending_removal)');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'removed', 'AG-1 is removed after V1');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e2'), 'removed', 'AG-2 is removed after V1');
SELECT results_eq(
  $$SELECT station_id::text, prev_status::text FROM station_ag_removals
     WHERE visit_id = '00000000-0000-0000-0000-0000000000f1' ORDER BY station_id$$,
  $$VALUES ('00000000-0000-0000-0000-0000000000e1', 'active'), ('00000000-0000-0000-0000-0000000000e2', 'pending_removal')$$,
  'V1 keeps the status each box had before it was removed');

-- กันปลอม: เขียนตารางเอง / เรียกตัวช่วยตรงไม่ได้
SELECT throws_ok($$INSERT INTO station_ag_removals (station_id, visit_id, prev_status, removed_at_set)
                   VALUES ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f1', 'active', now())$$,
  '42501', NULL, 'recorder cannot write station_ag_removals directly');
SELECT throws_ok($$SELECT public.service_ag_removal_restore('00000000-0000-0000-0000-0000000000f1', NULL)$$,
  '42501', NULL, 'recorder cannot call the restore helper directly');
SELECT throws_ok($$SELECT public.service_ag_removal_capture('00000000-0000-0000-0000-0000000000f1',
                   ARRAY['00000000-0000-0000-0000-0000000000e3']::uuid[])$$,
  '42501', NULL, 'recorder cannot call the capture helper directly');

-- บันทึกซ้ำ (retry) ไม่ทับค่าก่อนถอด
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f1', '2026-01-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"},
    {"station_id": "00000000-0000-0000-0000-0000000000e2", "status": "removed"}]'))$$,
  'saving V1 again (retry) still works');
SELECT is((SELECT prev_status::text FROM station_ag_removals WHERE station_id = '00000000-0000-0000-0000-0000000000e1'),
  'active', 'retry does not overwrite the status before removal');

-- การเข้าอื่น (V2) สั่ง AG-1 กลับมาใช้งาน → ไม่ได้ (ไม่ปลุกกล่องที่ถอดในการเข้าอื่น)
-- M15: V2 ลงวันก่อน V1 (2.25 ข: ถ้า V2 ลงวันหลัง จะลบ V1 ไม่ได้ — เทสใน 30)
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2', '2026-01-10',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "active"}]'))$$,
  'V2 saves while asking AG-1 (removed in V1) to be active');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'removed', 'another visit cannot wake a box removed in V1');

-- หัวหน้างานนอกขอบเขต ลบ V1 ไม่ได้
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$,
  '42501', NULL, 'recorder outside the division cannot delete V1');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'removed', 'AG-1 untouched after the refused delete');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$, 'recorder deletes V1');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'active', 'AG-1 is back to active after deleting V1');
SELECT is((SELECT removed_at FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e1'), NULL,
  'AG-1 removed_at is cleared again');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e2'), 'pending_removal', 'AG-2 is back to pending_removal');
SELECT is((SELECT count(*)::int FROM station_ag_removals), 0, 'no removal records are left for V1');

RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'stations' AND action = 'update'
                    AND row_id = '00000000-0000-0000-0000-0000000000e1'
                    AND old_data ->> 'status' = 'removed' AND new_data ->> 'status' = 'active'),
  'the restore of AG-1 is written to audit_log');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'stations' AND action = 'update'
                    AND row_id = '00000000-0000-0000-0000-0000000000e1'
                    AND changed_by = '00000000-0000-0000-0000-0000000000a3'
                    AND new_data ->> 'status' = 'active'),
  'audit_log names the recorder who deleted the visit');

-- =====================================================================
-- 2. แก้การเข้าเดิมแล้วเอาติ๊กถอดออก → ย้อนได้เฉพาะการเข้าที่เป็นคนถอด
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"}]'))$$,
  'V3 removes AG-1');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "pending_removal"}]'))$$,
  'editing V3: AG-1 changed from removed to pending_removal');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'pending_removal',
  'the visit that removed AG-1 can untick the removal (status from the payload)');
SELECT is((SELECT removed_at FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e1'), NULL,
  'removed_at is cleared after the untick');
SELECT is((SELECT count(*)::int FROM station_ag_removals WHERE visit_id = '00000000-0000-0000-0000-0000000000f3'), 0,
  'the removal record of V3 is gone after the untick');
-- ติ๊กถอดใหม่ในการแก้ครั้งถัดไป → เก็บค่าก่อนถอดรอบใหม่
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"}]'))$$,
  'editing V3 again: AG-1 removed again');
SELECT is((SELECT prev_status::text FROM station_ag_removals WHERE visit_id = '00000000-0000-0000-0000-0000000000f3'),
  'pending_removal', 're-removal keeps the new status before removal');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f3')$$, 'delete V3');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'pending_removal', 'AG-1 back to pending_removal');
-- คืน AG-1 เป็น active ผ่านการเข้าปกติ (V2 แก้) เพื่อใช้ในข้อถัดไป
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2', '2026-01-10',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "active"}]'))$$,
  'V2 sets AG-1 back to active (normal status change)');

-- =====================================================================
-- 3. มีการเปลี่ยนหลังการถอด → ไม่ย้อนทับ
-- =====================================================================
-- 3a. host แก้วันถอดเองหลังจากนั้น → ลบการเข้าแล้วกล่องยังเป็น removed (ค่าของ host)
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f4', '2026-04-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e3", "status": "removed"}]'))$$,
  'V4 removes AG-3');
RESET ROLE;
UPDATE stations SET removed_at = '2026-04-01 10:00+07' WHERE id = '00000000-0000-0000-0000-0000000000e3';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f4')$$,
  'delete V4 after the host changed the removal');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e3'), 'removed', 'a later change is not overwritten (AG-3 stays removed)');
SELECT is((SELECT removed_at FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e3'), '2026-04-01 10:00+07'::timestamptz,
  'the host''s removal time is kept');

-- 3b. เลขเดิมถูกใช้กับกล่องใหม่ (การเข้าที่ลงวันก่อน แต่บันทึกทีหลัง) → ลบการเข้าที่ถอดไม่ได้ (SV002) ไม่ใช่ 23505
--     M15: ถ้าการเข้าที่ฝังใหม่ลงวันหลังกว่า จะได้ SV005 ก่อน (เทสใน 30) → ที่นี่ใช้วันก่อนเพื่อคงการทดสอบ SV002
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f5', '2026-05-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"}]'))$$,
  'V5 removes AG-1');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f6', '2026-05-10', '[]',
  '{"works": [{"id": "00000000-0000-0000-0000-00000000b001", "kind": "added", "station_type": "AG", "station_nos": [1]}]}'))$$,
  'V6 installs a new AG-1 (same number reused)');
SELECT throws_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f5')$$,
  'SV002', NULL, 'deleting V5 would clash with the new AG-1 → SV002');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'removed', 'old AG-1 stays removed after the refused delete');
SELECT ok(EXISTS (SELECT 1 FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f5'), 'V5 still exists');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f6')$$, 'delete V6 first');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f5')$$, 'then V5 can be deleted');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'active', 'old AG-1 is active again');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
