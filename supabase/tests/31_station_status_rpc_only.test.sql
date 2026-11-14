-- M16 (20261112190000): สถานะสถานีที่ "งานบริการ" เป็นคนตั้ง เปลี่ยนได้ผ่าน RPC เท่านั้น (DECISIONS 2.28, 2.29)
--   2.28: admin เปลี่ยน status/removed_at ของกล่องที่ถอด/กำจัดแล้วตรงไม่ได้ (เหมือน recorder ใน M15)
--   2.29: recorder เปลี่ยนเป็น/จาก lost (หาย) / withdrawn (ถอนออก) ตรงไม่ได้ — ผ่านงานซ่อมใน save_service_visit
--         (ย้อนผ่าน save_service_visit / delete_service_visit) เท่านั้น → station_works.effects ตรงกับจริง
--   admin + lost/withdrawn: ตัดสินใน 2.30 / M17 → เทสข้อ 4 ปรับเป็นกัน (42501)
-- ทุกกรณีที่ "โดนกัน" มีคู่ควบคุม (แถวเดียวกัน ผู้ใช้เดียวกัน แก้ point_label ได้) → พิสูจน์ว่า trigger ทำงานจริง
-- ไม่ใช่ RLS ซ่อนแถวแล้ว UPDATE ได้ 0 แถวเงียบๆ
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(71);

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_trigger('public', 'stations', 'stations_finished_status_guard', 'stations keeps the status guard trigger');
SELECT isnt_definer('public', 'stations_finished_status_guard', ARRAY[]::text[], 'the guard is SECURITY INVOKER');
SELECT ok(NOT has_function_privilege('authenticated', 'public.stations_finished_status_guard()', 'EXECUTE'),
  'users cannot call the stations trigger function');
SELECT ok(NOT has_function_privilege('anon', 'public.stations_finished_status_guard()', 'EXECUTE'),
  'anon cannot call the stations trigger function');
SELECT isnt_definer('public', 'save_service_visit', ARRAY['jsonb'], 'save_service_visit stays SECURITY INVOKER');
SELECT isnt_definer('public', 'delete_service_visit', ARRAY['uuid'], 'delete_service_visit stays SECURITY INVOKER');
SELECT ok(NOT has_function_privilege('anon', 'public.save_service_visit(jsonb)', 'EXECUTE'), 'anon still cannot call save_service_visit');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_service_visit(uuid)', 'EXECUTE'), 'anon still cannot call delete_service_visit');

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
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'H-1', '2026-01-15', 1, 50000, now());
-- AG-1 ถอดผ่าน RPC (ข้อ 1) · AG-2 ใช้งาน · AG-3 กำจัดแล้ว
-- IG-1..IG-4 ใช้งาน (ทดสอบ lost / withdrawn) · IG-5 หายแล้วจากข้อมูลเดิม (ไม่มี station_works)
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'AG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'AG', 2, 'active'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'AG', 3, 'eliminated'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'IG', 1, 'active'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'IG', 2, 'active'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000d1', 'IG', 3, 'active'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000d1', 'IG', 4, 'active'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000d1', 'IG', 5, 'lost');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a;
GRANT SELECT ON _t TO PUBLIC;

-- payload พื้นฐาน: ข้ามทุกจุด AG (D10) + รายการสถานะ + ส่วนเพิ่ม (works ฯลฯ)
CREATE FUNCTION pg_temp.payload(p_visit uuid, p_date date, p_statuses jsonb, p_extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', p_visit, 'contract_id', '00000000-0000-0000-0000-0000000000d1'::uuid,
                            'visit_date', p_date, 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true,
                            'station_statuses', p_statuses) || p_extra
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(uuid, date, jsonb, jsonb) TO PUBLIC;

CREATE FUNCTION pg_temp.st(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT status::text FROM stations WHERE id = p_id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.st(uuid) TO PUBLIC;

CREATE FUNCTION pg_temp.label(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT point_label FROM stations WHERE id = p_id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.label(uuid) TO PUBLIC;

-- AG-1 ถอดผ่าน RPC (recorder) — ให้มีกล่อง removed ที่มีประวัติจริง
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f1', '2026-01-20',
  '[{"station_id": "00000000-0000-0000-0000-0000000000e1", "status": "removed"}]'))$$,
  'V1 (Jan) removes AG-1 through the RPC');

-- =====================================================================
-- 1. (2.28) admin เปลี่ยนสถานะกล่องที่ถอด/กำจัดแล้วตรงไม่ได้
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
-- คู่ควบคุม: admin เห็นและแก้แถวเดียวกันได้ (RLS ไม่ได้ซ่อน)
SELECT lives_ok($$UPDATE stations SET point_label = 'admin-kitchen' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  'control: admin can still change the point label of a removed box');
SELECT is(pg_temp.label('00000000-0000-0000-0000-0000000000e1'), 'admin-kitchen', 'control: the label change really saved (row is visible to admin)');
SELECT throws_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '42501', NULL, 'admin cannot wake a removed box directly');
SELECT throws_ok($$UPDATE stations SET status = 'pending_removal', removed_at = NULL
                    WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '42501', NULL, 'admin cannot move a removed box to pending_removal directly');
SELECT throws_ok($$UPDATE stations SET removed_at = now() - interval '1 day' WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '42501', NULL, 'admin cannot change removed_at of a removed box directly');
SELECT lives_ok($$UPDATE stations SET point_label = 'admin-hall' WHERE id = '00000000-0000-0000-0000-0000000000e3'$$,
  'control: admin can still change the point label of an eliminated station');
SELECT throws_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000e3'$$,
  '42501', NULL, 'admin cannot change an eliminated station directly');
SELECT throws_ok($$UPDATE stations SET status = 'removed', removed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  '42501', NULL, 'admin cannot remove a box directly (would skip the removal record)');
SELECT throws_ok($$UPDATE stations SET status = 'eliminated' WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  '42501', NULL, 'admin cannot mark a station eliminated directly');
-- งานอื่นของ admin บน stations ยังทำได้เหมือนเดิม
SELECT lives_ok($$UPDATE stations SET collected_at = now() WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  'admin can still set collected_at of a removed box');
SELECT lives_ok($$UPDATE stations SET status = 'pending_removal' WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  'admin can still change a box in use (active → pending_removal)');
SELECT lives_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  'and back (pending_removal → active)');
SELECT lives_ok($$UPDATE stations SET code = 'AG-02', installed_at = '2026-01-15', station_no = 12
                   WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  'admin can still change code / number / install date of a station in use');
SELECT lives_ok($$UPDATE stations SET station_no = 2 WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  'admin sets the number back');
SELECT lives_ok($$INSERT INTO stations (contract_id, type, station_no) VALUES ('00000000-0000-0000-0000-0000000000d1', 'IC', 1)$$,
  'admin can still add a station');
-- ทางเลี่ยงที่ตรวจ security เจอ: INSERT เป็นสถานะจบแล้ว · ตั้ง removed_at ล่วงหน้า
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, status) VALUES ('00000000-0000-0000-0000-0000000000d1', 'AG', 9, 'eliminated')$$,
  '42501', NULL, 'admin cannot add a station that is already eliminated');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, status, removed_at) VALUES ('00000000-0000-0000-0000-0000000000d1', 'AG', 9, 'removed', now())$$,
  '42501', NULL, 'admin cannot add a station that is already removed');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, removed_at) VALUES ('00000000-0000-0000-0000-0000000000d1', 'AG', 9, now())$$,
  '42501', NULL, 'admin cannot add a station with removed_at set');
SELECT throws_ok($$UPDATE stations SET removed_at = '2025-01-01' WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  '42501', NULL, 'admin cannot pre-set removed_at of a box in use');
RESET ROLE;
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e1'), 'removed', 'AG-1 stays removed after the refused admin updates');
SELECT ok((SELECT removed_at IS NOT NULL FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e1'), 'AG-1 keeps its removed_at');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e3'), 'eliminated', 'AG-3 stays eliminated');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000e2'), 'active', 'AG-2 is active');
SELECT is((SELECT code FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e2'), 'AG-02', 'the admin code change saved');

-- =====================================================================
-- 2. (2.29) recorder เปลี่ยนเป็น/จาก หาย / ถอนออก ตรงไม่ได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$UPDATE stations SET point_label = 'rec-ig1' WHERE id = '00000000-0000-0000-0000-0000000000b1'$$,
  'control: recorder can change the point label of IG-1');
SELECT is(pg_temp.label('00000000-0000-0000-0000-0000000000b1'), 'rec-ig1', 'control: the label change really saved');
SELECT throws_ok($$UPDATE stations SET status = 'lost' WHERE id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', NULL, 'recorder cannot mark a station lost directly');
SELECT throws_ok($$UPDATE stations SET status = 'withdrawn', removed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', NULL, 'recorder cannot mark a station withdrawn directly');
SELECT throws_ok($$UPDATE stations SET status = 'withdrawn' WHERE id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', NULL, 'recorder cannot mark a station withdrawn directly (status only)');
-- IG-5 หายจากข้อมูลเดิม: คืนตรงไม่ได้
SELECT lives_ok($$UPDATE stations SET point_label = 'rec-ig5' WHERE id = '00000000-0000-0000-0000-0000000000b5'$$,
  'control: recorder can change the point label of the lost IG-5');
SELECT throws_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000b5'$$,
  '42501', NULL, 'recorder cannot bring a lost station back directly');
SELECT throws_ok($$UPDATE stations SET status = 'withdrawn' WHERE id = '00000000-0000-0000-0000-0000000000b5'$$,
  '42501', NULL, 'recorder cannot switch lost → withdrawn directly');
SELECT throws_ok($$UPDATE stations SET removed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000b5'$$,
  '42501', NULL, 'recorder cannot set removed_at of a lost station directly');
SELECT lives_ok($$UPDATE stations SET collected_at = now() WHERE id = '00000000-0000-0000-0000-0000000000b5'$$,
  'recorder can still set collected_at of a lost station');
-- ตั้งวันถอดล่วงหน้าแล้วค่อยถอดผ่าน RPC (coalesce เก็บค่าปลอม) → กันที่ตัวการตั้ง removed_at
SELECT throws_ok($$UPDATE stations SET removed_at = '2025-01-01' WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  '42501', NULL, 'recorder cannot pre-set removed_at of a box in use');
SELECT ok((SELECT removed_at IS NULL FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e2'), 'AG-2 removed_at stays empty');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b1'), 'active', 'IG-1 stays active after the refused updates');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b5'), 'lost', 'IG-5 stays lost');

-- ---------- ทางที่ถูก: งานซ่อมใน save_service_visit ----------
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2', '2026-02-20', '[]',
  '{"works": [{"id": "00000000-0000-0000-0000-000000000f21", "kind": "lost", "station_type": "IG", "station_nos": [2], "detail": "หาย"},
              {"id": "00000000-0000-0000-0000-000000000f22", "kind": "withdrawn", "station_type": "IG", "station_nos": [3]}]}'))$$,
  'V2 (Feb) marks IG-2 lost and IG-3 withdrawn through the RPC');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b2'), 'lost', 'IG-2 is lost');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b3'), 'withdrawn', 'IG-3 is withdrawn');
SELECT is((SELECT effects -> 'prev' ->> '00000000-0000-0000-0000-0000000000b2' FROM station_works
            WHERE id = '00000000-0000-0000-0000-000000000f21'), 'active', 'the lost work remembers IG-2 was active');
-- คืนตรงก็ไม่ได้ (effects ยังชี้อยู่)
SELECT throws_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000b2'$$,
  '42501', NULL, 'recorder cannot undo a lost work by changing the station directly');
SELECT throws_ok($$UPDATE stations SET status = 'active', removed_at = NULL WHERE id = '00000000-0000-0000-0000-0000000000b3'$$,
  '42501', NULL, 'recorder cannot undo a withdrawn work by changing the station directly');

-- แก้การเข้าเอางาน "หาย" ออก → สถานีคืน (ผ่าน service_work_undo)
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2', '2026-02-20', '[]',
  '{"works": [{"id": "00000000-0000-0000-0000-000000000f22", "kind": "withdrawn", "station_type": "IG", "station_nos": [3]}]}'))$$,
  'editing V2 to drop the lost work works');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b2'), 'active', 'IG-2 is active again');
SELECT ok(NOT EXISTS (SELECT 1 FROM station_works WHERE id = '00000000-0000-0000-0000-000000000f21'), 'the lost work is gone');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b3'), 'withdrawn', 'IG-3 stays withdrawn (its work kept)');

-- ลบการเข้า → งานถอนออกย้อน
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f2')$$,
  'deleting V2 through the RPC works');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b3'), 'active', 'IG-3 is active again');
SELECT ok((SELECT removed_at IS NULL FROM stations WHERE id = '00000000-0000-0000-0000-0000000000b3'), 'IG-3 removed_at cleared');

-- เลขของสถานีที่หายใช้ฝังใหม่ได้ตามเดิม (DECISIONS 2.20) — งาน "หาย" + "ฝังใหม่" เลขเดิมในการเข้าเดียว
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f3', '2026-03-20', '[]',
  '{"works": [{"id": "00000000-0000-0000-0000-000000000f31", "kind": "lost", "station_type": "IG", "station_nos": [4], "detail": "หาย"},
              {"id": "00000000-0000-0000-0000-000000000f32", "kind": "added", "station_type": "IG", "station_nos": [4]}]}'))$$,
  'V3 (Mar) marks IG-4 lost and installs a new IG-4 in the same visit');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b4'), 'lost', 'old IG-4 is lost');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f3')$$,
  'deleting V3 undoes both works');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b4'), 'active', 'old IG-4 is active again');

-- =====================================================================
-- 3. host ยังแก้ตรงได้ (ออกแบบ M14 รองรับ "host แก้เอง")
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000e3'$$,
  'host can still change an eliminated station directly');
SELECT lives_ok($$UPDATE stations SET status = 'eliminated' WHERE id = '00000000-0000-0000-0000-0000000000e3'$$,
  'host sets it back');
SELECT lives_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000b5'$$,
  'host can still bring a lost station back directly');
SELECT lives_ok($$UPDATE stations SET status = 'lost' WHERE id = '00000000-0000-0000-0000-0000000000b5'$$,
  'host can still mark a station lost directly');

-- =====================================================================
-- 4. admin + หาย/ถอนออก — ตัดสินแล้ว 2.30 (M17, 20261112200000): กันเหมือน recorder → throws_ok 42501
--    (เทสละเอียดอยู่ใน 32_admin_lost_withdrawn_rpc_only.test.sql)
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
-- (2.30 / M17: ตัดสินแล้ว — กันเหมือน recorder · เดิมเป็น lives_ok)
SELECT throws_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000b5'$$,
  '42501', NULL, 'admin cannot bring a lost station back directly (2.30)');
SELECT throws_ok($$UPDATE stations SET status = 'withdrawn' WHERE id = '00000000-0000-0000-0000-0000000000b5'$$,
  '42501', NULL, 'admin cannot mark a station withdrawn directly (2.30)');

-- =====================================================================
-- 5. audit_log ยังเก็บการเปลี่ยนสถานะผ่าน RPC
-- =====================================================================
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'stations' AND action = 'update'
                    AND row_id = '00000000-0000-0000-0000-0000000000b2'
                    AND changed_by = '00000000-0000-0000-0000-0000000000a3'
                    AND new_data ->> 'status' = 'lost'),
  'marking IG-2 lost through the RPC is in audit_log with the recorder');

SELECT * FROM finish();
ROLLBACK;
