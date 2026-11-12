-- M15 (20261112180000): สิทธิ์ผ่าน RPC เท่านั้น + กติกาลบการเข้า (DECISIONS 2.24, 2.25 ข, X9 ค่าชั่วคราว)
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(68);

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_trigger('public', 'stations', 'stations_finished_status_guard', 'stations has the finished-status guard');
SELECT has_trigger('public', 'visits', 'visits_delete_rpc_only', 'visits has the RPC-only delete guard');
SELECT is_definer('public', 'service_ag_removal_guard', ARRAY['uuid', 'uuid[]'], 'guard helper is SECURITY DEFINER (gated)');
SELECT ok(NOT has_function_privilege('anon', 'public.service_ag_removal_guard(uuid, uuid[])', 'EXECUTE'),
  'anon cannot call the guard helper');
SELECT ok(NOT has_function_privilege('authenticated', 'public.visits_delete_rpc_only()', 'EXECUTE'),
  'users cannot call the visits trigger function');
SELECT ok(NOT has_function_privilege('authenticated', 'public.stations_finished_status_guard()', 'EXECUTE'),
  'users cannot call the stations trigger function');
SELECT isnt_definer('public', 'save_service_visit', ARRAY['jsonb'], 'save_service_visit stays SECURITY INVOKER');
SELECT isnt_definer('public', 'delete_service_visit', ARRAY['uuid'], 'delete_service_visit stays SECURITY INVOKER');
SELECT ok(NOT has_function_privilege('anon', 'public.save_service_visit(jsonb)', 'EXECUTE'), 'anon still cannot call save_service_visit');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_service_visit(uuid)', 'EXECUTE'), 'anon still cannot call delete_service_visit');
SELECT table_privs_are('public', 'station_works', 'authenticated', ARRAY['SELECT'],
  'users can still only read station_works');

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
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Central');
-- d1 สัญญาหลัก · d2 สัญญาเปล่า (ทดสอบ admin ลบ) · d3 สัญญาเก่าที่จะถูก Renew เป็น d4
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'G-1', '2026-01-15', 1, 50000, now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'G-2', '2026-01-15', 1, 50000, NULL),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'G-3', '2025-01-15', 1, 50000, now());
-- AG-1, AG-2 ใช้งาน · AG-3 กำจัดแล้ว (d1) · IG-1 ของสัญญาเปล่า d2 · AG-9 ของสัญญาเก่า d3
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'AG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'AG', 2, 'active'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'AG', 3, 'eliminated'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d2', 'IG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000d3', 'AG', 1, 'active');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a;
GRANT SELECT ON _t TO PUBLIC;

-- payload พื้นฐาน: ข้ามทุกจุด AG (D10) + รายการสถานะ
CREATE FUNCTION pg_temp.payload(p_contract uuid, p_visit uuid, p_date date, p_statuses jsonb, p_extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', p_visit, 'contract_id', p_contract,
                            'visit_date', p_date, 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true,
                            'station_statuses', p_statuses) || p_extra
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(uuid, uuid, date, jsonb, jsonb) TO PUBLIC;

CREATE FUNCTION pg_temp.st(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT status::text FROM stations WHERE id = p_id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.st(uuid) TO PUBLIC;

-- =====================================================================
-- 1. (2.24) recorder เปลี่ยนสถานะกล่องที่ถอด/กำจัดแล้วตรงไม่ได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);

SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f1', '2026-01-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"}]'))$$,
  'V1 (Jan) removes AG-1 through the RPC');

SELECT throws_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '42501', NULL, 'recorder cannot wake a removed box directly');
SELECT throws_ok($$UPDATE stations SET status = 'pending_removal', removed_at = NULL
                    WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '42501', NULL, 'recorder cannot move a removed box to pending_removal directly');
SELECT throws_ok($$UPDATE stations SET removed_at = now() - interval '1 day' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '42501', NULL, 'recorder cannot change removed_at of a removed box directly');
SELECT throws_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000e3'$$,
  '42501', NULL, 'recorder cannot change an eliminated station directly');
SELECT lives_ok($$UPDATE stations SET point_label = 'kitchen' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  'recorder can still change the point label of a removed box');
SELECT lives_ok($$UPDATE stations SET collected_at = now() WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  'recorder can still set collected_at of a removed box');
SELECT lives_ok($$UPDATE stations SET status = 'pending_removal' WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  'recorder can still change a box that is in use (active → pending_removal)');
SELECT lives_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  'and back (pending_removal → active)');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'removed', 'AG-1 stays removed after the refused updates');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e3'), 'eliminated', 'AG-3 stays eliminated');

-- host ยังแก้ตรงได้ (ออกแบบ M14 รองรับ "host แก้เอง")
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000e3'$$,
  'host can still change an eliminated station directly');
SELECT lives_ok($$UPDATE stations SET status = 'eliminated' WHERE id = '00000000-0000-0000-0000-0000000000e3'$$,
  'host sets it back');

-- =====================================================================
-- 2. (2.24) ลบ visits / station_works ตรงไม่ได้ — ผ่าน delete_service_visit เท่านั้น
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$DELETE FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  '42501', NULL, 'recorder cannot DELETE a visit directly');
SELECT throws_ok($$DELETE FROM station_works WHERE visit_id = '00000000-0000-0000-0000-0000000000f1'$$,
  '42501', NULL, 'recorder cannot DELETE station_works directly');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$DELETE FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  '42501', NULL, 'host cannot DELETE a visit directly either');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok($$DELETE FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  'admin DELETE runs but RLS gives admin no rows');
-- DECISIONS 1.5: admin ลบสัญญาเปล่า → สถานีหายตาม (ไม่กระทบ)
SELECT lives_ok($$DELETE FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'$$,
  'admin can still delete an empty contract');
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'V1 still exists after the refused deletes');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'removed', 'AG-1 is still removed (no cascade around the restore)');
SELECT ok(NOT EXISTS (SELECT 1 FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'), 'empty contract is gone');
SELECT ok(NOT EXISTS (SELECT 1 FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e4'), 'its station went with it (CASCADE)');

-- service_role (ระบบ/นำเข้า) ยังลบตรงได้
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time)
VALUES ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000d1', '2025-12-01', 'problem', '09:00', '10:00');
SET LOCAL ROLE service_role;
SELECT lives_ok($$DELETE FROM visits WHERE id = '00000000-0000-0000-0000-0000000000fa'$$, 'service_role can still delete a visit');
RESET ROLE;
SELECT ok(NOT EXISTS (SELECT 1 FROM visits WHERE id = '00000000-0000-0000-0000-0000000000fa'), 'the service_role delete went through');

-- =====================================================================
-- 3. (2.25 ข) มีการเข้าครั้งหลังแล้ว → ลบ/เอาติ๊กถอดออกไม่ได้ (SV005)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f2', '2026-02-20', '[]'))$$,
  'V2 (Feb) saved after AG-1 was removed in V1');
SELECT throws_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$,
  'SV005', 'a later visit of this contract exists; delete or edit the later visit first',
  'deleting V1 while V2 (later) exists is refused (SV005, no other data in the message)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f1', '2026-01-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "active"}]'))$$,
  'SV005', NULL, 'unticking the removal in V1 while V2 exists is refused (SV005)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f1', '2026-03-01',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "active"}]'))$$,
  'SV005', NULL, 'moving V1 after V2 and unticking in the same save is still refused (date before the edit)');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'removed', 'AG-1 stays removed after the refused calls');
SELECT ok(EXISTS (SELECT 1 FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'
                     AND visit_date = '2026-01-20'), 'V1 is unchanged (date not moved)');
-- ลบครั้งหลังก่อน แล้วค่อยลบ V1 ได้
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f2')$$,
  'V2 (no AG removal) can be deleted');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$,
  'then V1 can be deleted');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'active', 'AG-1 is active again');

-- วันเดียวกัน: บันทึกทีหลัง = ครั้งหลัง · บันทึกก่อน = ไม่นับ
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f3', '2026-04-10',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"}]'))$$,
  'V3 (Apr 10) removes AG-1');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f4', '2026-04-10', '[]'))$$,
  'V4 on the same day');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);   -- stamp_created_by คง created_at ไว้เมื่อมีผู้ใช้
UPDATE visits SET created_at = now() + interval '1 minute' WHERE id = '00000000-0000-0000-0000-0000000000f4';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f3')$$,
  'SV005', NULL, 'a same-day visit saved later counts as a later visit');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);   -- stamp_created_by คง created_at ไว้เมื่อมีผู้ใช้
UPDATE visits SET created_at = now() - interval '1 minute' WHERE id = '00000000-0000-0000-0000-0000000000f4';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f3')$$,
  'a same-day visit saved earlier does not block');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'active', 'AG-1 restored');

-- การเข้าที่ไม่ได้ถอดกล่อง ลบได้แม้มีครั้งหลัง (ไม่กระทบของเดิม)
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f5', '2026-05-20', '[]'))$$, 'V5 (May)');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f4')$$,
  'V4 (Apr, no AG removal) is deleted while V5 exists');

-- ไม่มีกล่องที่จะคืนจริง (host เปลี่ยนต่อแล้ว) → ไม่ติดด่าน
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f6', '2026-06-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e2", "status": "removed"}]'))$$, 'V6 (Jun) removes AG-2');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f7', '2026-07-20', '[]'))$$, 'V7 (Jul)');
RESET ROLE;
UPDATE stations SET removed_at = '2026-06-01 10:00+07' WHERE id = '00000000-0000-0000-0000-0000000000e2';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f6')$$,
  'V6 can be deleted when its removal was changed later (nothing to restore)');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e2'), 'removed', 'AG-2 keeps the later change');

-- =====================================================================
-- 4. station id ซ้ำใน payload → 22023
-- =====================================================================
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f8', '2026-08-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"},
    {"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "active"}]'))$$,
  '22023', NULL, 'duplicate station in station_statuses is refused');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f8', '2026-08-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"},
    {"station_id": "00000000-0000-0000-0000-0000000000E1", "status": "removed"}]'))$$,
  '22023', NULL, 'duplicate in different letter case is refused too');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f8', '2026-08-20', '[]',
  '{"station_labels": [{"station_id": "00000000-0000-0000-0000-0000000000e1", "point_label": "a"},
                       {"station_id": "00000000-0000-0000-0000-0000000000e1", "point_label": "b"}]}'))$$,
  '22023', NULL, 'duplicate station in station_labels is refused');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000f8', '2026-08-20', '[]',
  '{"checks": [{"station_id": "00000000-0000-0000-0000-0000000000e1", "checked": false},
               {"station_id": "00000000-0000-0000-0000-0000000000e1", "checked": false}]}'))$$,
  '22023', NULL, 'duplicate station in checks is refused');
SELECT ok(NOT EXISTS (SELECT 1 FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f8'), 'nothing was saved');

-- =====================================================================
-- 5. (X9 ค่าชั่วคราว) สัญญาที่ Renew แล้ว ลบการเข้า / เอาติ๊กถอดออกไม่ได้ (SV010)
-- =====================================================================
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d3',
  '00000000-0000-0000-0000-0000000000f9', '2025-06-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e9", "status": "removed"}]'))$$,
  'V9 removes AG-9 in the old contract');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d3',
  '00000000-0000-0000-0000-0000000000fb', '2025-07-20', '[]'))$$,
  'V10 in the old contract (no AG removal)');
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, renewed_from_contract_id) VALUES
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c1', 'G-4', '2026-01-15', 1, 50000,
   '00000000-0000-0000-0000-0000000000d3');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000fb')$$,
  'SV010', NULL, 'the latest visit of a renewed contract cannot be deleted (SV010)');
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d3',
  '00000000-0000-0000-0000-0000000000f9', '2025-06-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e9", "status": "active"}]'))$$,
  'SV010', NULL, 'unticking an AG removal in a renewed contract is refused (SV010)');
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000d3',
  '00000000-0000-0000-0000-0000000000f9', '2025-06-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e9", "status": "removed"}]', '{"note": "fixed typo"}'))$$,
  'other edits of an old visit still work');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f9')$$,
  'SV010', NULL, 'host cannot delete a visit of a renewed contract either (SV010)');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e9'), 'removed', 'AG-9 stays removed in the old contract');

-- =====================================================================
-- 6. audit_log ยังเก็บการลบผ่าน RPC
-- =====================================================================
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'visits' AND action = 'delete'
                    AND row_id = '00000000-0000-0000-0000-0000000000f1'
                    AND changed_by = '00000000-0000-0000-0000-0000000000a3'),
  'deleting V1 through the RPC is in audit_log with the recorder');

SELECT * FROM finish();
ROLLBACK;
