-- M17 (20261112200000): admin เปลี่ยนสถานีเป็น/จาก หาย (lost) / ถอนออก (withdrawn) ตรงไม่ได้ (DECISIONS 2.30 ตัวเลือก ก)
--   ปิดเหมือน recorder (2.29) · host ยังแก้ตรงได้ · งานอื่นของ admin บน stations ทำได้ตามเดิม
--   หมายเหตุ: save_service_visit / delete_service_visit ปฏิเสธ admin อยู่แล้ว (เฉพาะ host/recorder) → admin ไม่มีทางผ่านงานซ่อม
--   "ทางที่ถูก" ของสถานี lost/withdrawn จึงยืนยันด้วย recorder (RPC) และ host (ตรง)
-- ทุกกรณีที่โดนกันมีคู่ควบคุม (แถวเดียวกัน admin แก้ point_label ได้) → พิสูจน์ว่า trigger ทำงานจริง ไม่ใช่ RLS ซ่อนแถว
BEGIN;
SELECT plan(31);

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
-- IG-1,2 ใช้งาน · IG-3 หาย (ข้อมูลเดิม) · IG-4 ถอนออก (ข้อมูลเดิม, มี removed_at)
INSERT INTO stations (id, contract_id, type, station_no, status, removed_at) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'IG', 1, 'active', NULL),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'IG', 2, 'active', NULL),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000d1', 'IG', 3, 'lost', NULL),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000d1', 'IG', 4, 'withdrawn', '2026-01-10');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a;
GRANT SELECT ON _t TO PUBLIC;
CREATE FUNCTION pg_temp.st(p_id uuid) RETURNS text LANGUAGE sql AS $$ SELECT status::text FROM stations WHERE id = p_id $$;
GRANT EXECUTE ON FUNCTION pg_temp.st(uuid) TO PUBLIC;
CREATE FUNCTION pg_temp.payload(p_visit uuid, p_date date, p_statuses jsonb, p_extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', p_visit, 'contract_id', '00000000-0000-0000-0000-0000000000d1'::uuid,
                            'visit_date', p_date, 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true,
                            'station_statuses', p_statuses) || p_extra
$$;
GRANT EXECUTE ON FUNCTION pg_temp.payload(uuid, date, jsonb, jsonb) TO PUBLIC;

-- =====================================================================
-- admin: ตรงไม่ได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok($$UPDATE stations SET point_label = 'admin-ig1' WHERE id = '00000000-0000-0000-0000-0000000000b1'$$,
  'control: admin can change the point label of IG-1 (row visible)');
SELECT lives_ok($$UPDATE stations SET point_label = 'admin-ig3' WHERE id = '00000000-0000-0000-0000-0000000000b3'$$,
  'control: admin can change the point label of the lost IG-3');
SELECT lives_ok($$UPDATE stations SET point_label = 'admin-ig4' WHERE id = '00000000-0000-0000-0000-0000000000b4'$$,
  'control: admin can change the point label of the withdrawn IG-4');
SELECT throws_ok($$UPDATE stations SET status = 'lost' WHERE id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', NULL, 'admin cannot mark a station lost directly');
SELECT throws_ok($$UPDATE stations SET status = 'withdrawn' WHERE id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', NULL, 'admin cannot mark a station withdrawn directly');
SELECT throws_ok($$UPDATE stations SET status = 'withdrawn', removed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', NULL, 'admin cannot set removed_at while marking withdrawn (also rule 0b: removed_at is system-set)');
SELECT throws_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000b3'$$,
  '42501', NULL, 'admin cannot bring a lost station back directly');
SELECT throws_ok($$UPDATE stations SET status = 'pending_removal' WHERE id = '00000000-0000-0000-0000-0000000000b3'$$,
  '42501', NULL, 'admin cannot move a lost station to pending_removal directly');
SELECT throws_ok($$UPDATE stations SET status = 'withdrawn' WHERE id = '00000000-0000-0000-0000-0000000000b3'$$,
  '42501', NULL, 'admin cannot switch lost → withdrawn directly');
SELECT throws_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000b4'$$,
  '42501', NULL, 'admin cannot bring a withdrawn station back directly (status only)');
SELECT throws_ok($$UPDATE stations SET status = 'lost' WHERE id = '00000000-0000-0000-0000-0000000000b4'$$,
  '42501', NULL, 'admin cannot switch withdrawn → lost directly');
SELECT throws_ok($$UPDATE stations SET removed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000b4'$$,
  '42501', NULL, 'admin cannot change removed_at of a withdrawn station directly (rule 0b: removed_at is system-set)');
-- งานอื่นของ admin ยังทำได้
SELECT lives_ok($$UPDATE stations SET collected_at = now() WHERE id = '00000000-0000-0000-0000-0000000000b3'$$,
  'admin can still set collected_at of a lost station');
SELECT lives_ok($$UPDATE stations SET status = 'pending_removal' WHERE id = '00000000-0000-0000-0000-0000000000b2'$$,
  'admin can still change a box in use (active → pending_removal)');
SELECT lives_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000b2'$$,
  'and back (pending_removal → active)');
SELECT lives_ok($$UPDATE stations SET code = 'IG-02', installed_at = '2026-01-15' WHERE id = '00000000-0000-0000-0000-0000000000b2'$$,
  'admin can still change code / install date of a station in use');
-- INSERT: สถานีที่เกิดมาเป็น lost / withdrawn ตรงไม่ได้ (ทางเลี่ยงที่ตรวจ security เจอ) · คู่ควบคุม: INSERT active ได้
SELECT lives_ok($$INSERT INTO stations (contract_id, type, station_no) VALUES ('00000000-0000-0000-0000-0000000000d1', 'IG', 20)$$,
  'control: admin can still add an active station');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, status) VALUES ('00000000-0000-0000-0000-0000000000d1', 'IG', 21, 'lost')$$,
  '42501', NULL, 'admin cannot add a station that is already lost');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, status) VALUES ('00000000-0000-0000-0000-0000000000d1', 'IG', 22, 'withdrawn')$$,
  '42501', NULL, 'admin cannot add a station that is already withdrawn');
SELECT throws_ok($$INSERT INTO stations (contract_id, type, station_no, status) VALUES ('00000000-0000-0000-0000-0000000000d1', 'IG', 23, 'withdrawn')
                   ON CONFLICT DO NOTHING$$,
  '42501', NULL, 'admin cannot add a withdrawn station with ON CONFLICT either');
RESET ROLE;
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b1'), 'active', 'IG-1 stays active after the refused admin updates');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b3'), 'lost', 'IG-3 stays lost');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b4'), 'withdrawn', 'IG-4 stays withdrawn');
SELECT is((SELECT removed_at FROM stations WHERE id = '00000000-0000-0000-0000-0000000000b4'), '2026-01-10'::timestamptz,
  'IG-4 keeps its removed_at');

-- =====================================================================
-- ทางที่ถูก: recorder ผ่านงานซ่อมใน RPC ยังทำงาน · host ตรงยังได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f1', '2026-02-20', '[]',
  '{"works": [{"id": "00000000-0000-0000-0000-000000000f11", "kind": "lost", "station_type": "IG", "station_nos": [1], "detail": "หาย"}]}'))$$,
  'recorder marks IG-1 lost through the repair work (RPC)');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b1'), 'lost', 'IG-1 is lost');
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$,
  'recorder undoes it through delete_service_visit');
SELECT is(pg_temp.st('00000000-0000-0000-0000-0000000000b1'), 'active', 'IG-1 is active again');
-- admin ไม่มีทางผ่าน RPC (ปฏิเสธบทบาท) — ยืนยันว่าไม่ได้เปิดช่องใหม่
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT public.save_service_visit(pg_temp.payload('00000000-0000-0000-0000-0000000000f2', '2026-02-21', '[]',
  '{"works": [{"id": "00000000-0000-0000-0000-000000000f21", "kind": "lost", "station_type": "IG", "station_nos": [1], "detail": "หาย"}]}'))$$,
  '42501', 'not allowed to record service', 'admin cannot mark lost through the RPC either (role rejected)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE stations SET status = 'lost' WHERE id = '00000000-0000-0000-0000-0000000000b1'$$,
  'host can still mark a station lost directly');
SELECT lives_ok($$UPDATE stations SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000b3'$$,
  'host can still bring a lost station back directly');

SELECT * FROM finish();
ROLLBACK;
