-- M21 (20261115120000): ชื่อตำแหน่ง + ตำแหน่งเจ้าของ · audit_log.actor_position_code · user_notifications
--   · division_scope อัตโนมัติ
-- ผู้ใช้: h1 = PM (host) · h2 = OM (host) · ow = เจ้าของ (ตั้งผ่าน SQL ของผู้ดูแลฐานข้อมูล)
--         r1 / r2 = หัวหน้างาน · v1 = viewer · n1 = ผู้ใช้ใหม่ที่ไม่ส่ง division_scope
BEGIN;
SELECT plan(75);

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;

INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT pg_temp.id(s), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', s || '@test.local'
  FROM unnest(ARRAY['a1','a2','a3','a4','a5','a6','a7','a8']) s;

INSERT INTO profiles (user_id, display_name, username, role, position_code, division_scope) VALUES
  (pg_temp.id('a1'), 'PM',     'ag-00001', 'host',     'pm',         '{central,province}'),
  (pg_temp.id('a2'), 'OM',     'ag-00002', 'host',     'om',         '{central,province}'),
  (pg_temp.id('a3'), 'Owner',  'ag-00003', 'host',     'owner',      '{central,province}'),
  (pg_temp.id('a4'), 'Rec 1',  'ag-00004', 'recorder', 'supervisor', '{central}'),
  (pg_temp.id('a5'), 'Rec 2',  'ag-00005', 'recorder', 'supervisor', '{central}'),
  (pg_temp.id('a6'), 'Viewer', 'ag-00006', 'viewer',   NULL,         '{central}');
-- n1: ไม่ส่ง division_scope → ค่าเริ่มต้น
INSERT INTO profiles (user_id, display_name, username, role, position_code) VALUES
  (pg_temp.id('a7'), 'New',    'ag-00007', 'recorder', 'supervisor');

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1), 'Central'),
  (pg_temp.id('c2'), (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1), 'Province');

-- =====================================================================
-- 1. ชื่อตำแหน่ง + ตำแหน่งเจ้าของ
-- =====================================================================
SELECT has_column('public', 'positions', 'assignable', 'positions.assignable exists');
SELECT results_eq(
  $$SELECT code, name_th, short_name_th, role::text, assignable FROM positions ORDER BY sort_order$$,
  $$VALUES ('owner', 'เจ้าของ', 'เจ้าของ', 'host', false),
           ('job_admin', 'แอดมิน (Admin)', 'แอดมิน', 'admin', true),
           ('supervisor', 'หัวหน้างาน (Supervisor)', 'หัวหน้างาน', 'recorder', true),
           ('pm', 'Project Manager (PM)', 'PM', 'host', true),
           ('om', 'Operation Manager (OM)', 'OM', 'host', true)$$,
  'positions: full + short names (HQ 15 Nov)');
SELECT col_not_null('public', 'positions', 'short_name_th', 'short_name_th NOT NULL');
SELECT is((SELECT role::text FROM profiles WHERE user_id = pg_temp.id('a3')), 'host', 'owner holder gets host role');

-- =====================================================================
-- 2. เจ้าของ: เส้นทาง API ตั้ง/ถอด/แก้ไม่ได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);  -- PM (host)

SELECT throws_ok($$UPDATE profiles SET position_code = 'owner' WHERE user_id = pg_temp.id('a4')$$,
  'PS001', NULL, 'host cannot assign the owner position');
SELECT throws_ok($$INSERT INTO profiles (user_id, display_name, username, role, position_code)
                   VALUES (pg_temp.id('a8'), 'X', 'ag-00008', 'host', 'owner')$$,
  'PS001', NULL, 'host cannot create a profile with the owner position');
SELECT throws_ok($$UPDATE profiles SET position_code = 'pm' WHERE user_id = pg_temp.id('a3')$$,
  'PS001', NULL, 'host cannot remove the owner position');
SELECT throws_ok($$UPDATE profiles SET is_active = false WHERE user_id = pg_temp.id('a3')$$,
  'PS001', NULL, 'host cannot disable the owner account');
SELECT throws_ok($$UPDATE profiles SET display_name = 'hacked' WHERE user_id = pg_temp.id('a3')$$,
  'PS001', NULL, 'host cannot edit the owner account');
SELECT throws_ok($$DELETE FROM profiles WHERE user_id = pg_temp.id('a3')$$,
  'PS001', NULL, 'host cannot delete the owner account');
-- ตำแหน่งเจ้าของในตาราง positions
SELECT throws_ok($$UPDATE positions SET name_th = 'x' WHERE code = 'owner'$$,
  'PS002', NULL, 'host cannot rename the owner position');
SELECT throws_ok($$UPDATE positions SET assignable = true WHERE code = 'owner'$$,
  'PS002', NULL, 'host cannot make the owner position assignable');
SELECT throws_ok($$UPDATE positions SET code = 'owner2' WHERE code = 'owner'$$,
  'PS002', NULL, 'host cannot re-code the owner position');
SELECT throws_ok($$DELETE FROM positions WHERE code = 'owner'$$,
  'PS002', NULL, 'host cannot delete the owner position');
SELECT throws_ok($$UPDATE positions SET assignable = false WHERE code = 'pm'$$,
  'PS002', NULL, 'host cannot lock another position');
SELECT throws_ok($$INSERT INTO positions (code, name_th, role, assignable) VALUES ('boss', 'Boss', 'host', false)$$,
  'PS002', NULL, 'host cannot create a non-assignable position');
SELECT lives_ok($$UPDATE positions SET name_th = 'Operation Manager (OM)' WHERE code = 'om'$$,
  'host can still edit an assignable position');
SELECT lives_ok($$INSERT INTO positions (code, name_th, role, sort_order) VALUES ('qa', 'QA ทดสอบ', 'recorder', 9)$$,
  'host can add an assignable position without a short name');
SELECT is((SELECT short_name_th FROM positions WHERE code = 'qa'), 'QA ทดสอบ', 'short name falls back to the full name');
SELECT lives_ok($$DELETE FROM positions WHERE code = 'qa'$$, 'host can delete an unused assignable position');
-- ผู้ใช้ทั่วไปยังเลือกตำแหน่งปกติได้
SELECT lives_ok($$UPDATE profiles SET position_code = 'job_admin' WHERE user_id = pg_temp.id('a4')$$,
  'host changes a normal position (หัวหน้างาน → แอดมิน)');
SELECT is((SELECT role::text FROM profiles WHERE user_id = pg_temp.id('a4')), 'admin', 'role follows the new position');

-- เจ้าของแก้แถวตัวเองได้ (เช่นเวลาเข้าใช้) แต่ถอดตำแหน่งตัวเองไม่ได้
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok($$SELECT public.touch_last_login()$$, 'owner can update own last_login');
SELECT isnt((SELECT last_login FROM profiles WHERE user_id = pg_temp.id('a3')), NULL, 'owner last_login was written');
SELECT throws_ok($$UPDATE profiles SET position_code = 'pm' WHERE user_id = pg_temp.id('a3')$$,
  'PS001', NULL, 'owner cannot remove own owner position from the application');
RESET ROLE;

-- service_role (server สร้างผู้ใช้) ก็ตั้งไม่ได้
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE profiles SET position_code = 'owner' WHERE user_id = pg_temp.id('a5')$$,
  'PS001', NULL, 'service_role cannot assign the owner position');
SELECT throws_ok($$UPDATE positions SET assignable = true WHERE code = 'owner'$$,
  'PS002', NULL, 'service_role cannot unlock the owner position');
SELECT throws_ok($$DELETE FROM profiles WHERE user_id = pg_temp.id('a3')$$,
  'PS001', NULL, 'service_role cannot delete the owner profile');
SELECT throws_ok($$INSERT INTO positions (code, name_th, role, assignable) VALUES ('boss', 'Boss', 'host', false)$$,
  'PS002', NULL, 'service_role cannot create a non-assignable position');
RESET ROLE;

-- เงื่อนไข "เส้นทาง API" ครบทุกกรณี (DB ในเครื่องจำลอง session_user ของ Supabase Auth ไม่ได้ จึงเทสที่ตัวเงื่อนไข)
SELECT results_eq(
  $$SELECT public.is_api_session_for(su, r) FROM (VALUES
      ('supabase_auth_admin', 'none', 1), ('authenticator', 'none', 2), ('postgres', 'authenticated', 3),
      ('postgres', 'service_role', 4), ('postgres', 'anon', 5), ('postgres', 'none', 6), ('postgres', NULL, 7)
    ) AS t (su, r, o) ORDER BY o$$,
  $$VALUES (true), (true), (true), (true), (true), (false), (false)$$,
  'API session = Auth server / authenticator / anon / authenticated / service_role · SQL admin is not');
SELECT is(public.is_api_session(), false, 'plain SQL session (postgres) is not an API session');

-- ผู้ดูแลฐานข้อมูล (SQL ตรง) ตั้ง/ถอดได้
SELECT lives_ok($$UPDATE profiles SET position_code = 'owner' WHERE user_id = pg_temp.id('a5')$$,
  'database administrator can assign the owner position');
SELECT lives_ok($$UPDATE profiles SET position_code = 'supervisor' WHERE user_id = pg_temp.id('a5')$$,
  'database administrator can remove the owner position');

-- =====================================================================
-- 3. audit_log.actor_position_code
-- =====================================================================
SELECT has_column('public', 'audit_log', 'actor_position_code', 'audit_log.actor_position_code exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);  -- PM
UPDATE customers SET name = 'Central (PM)' WHERE id = pg_temp.id('c1');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);  -- OM
UPDATE customers SET name = 'Central (OM)' WHERE id = pg_temp.id('c1');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);  -- ไม่มีผู้ใช้
UPDATE customers SET name = 'Central (SQL)' WHERE id = pg_temp.id('c1');

SELECT results_eq(
  $$SELECT new_data ->> 'name', actor_position_code FROM audit_log
     WHERE table_name = 'customers' AND row_id = pg_temp.id('c1') AND action = 'update'
     ORDER BY changed_at, (new_data ->> 'name')$$,
  $$VALUES ('Central (OM)', 'om'), ('Central (PM)', 'pm'), ('Central (SQL)', NULL::text)$$,
  'audit rows carry the actor position at the time (NULL without a user)');
SELECT is((SELECT changed_by FROM audit_log WHERE table_name = 'customers' AND new_data ->> 'name' = 'Central (PM)'),
  pg_temp.id('a1'), 'audit row still records changed_by');

-- audit_profiles: เก็บการเปลี่ยนตำแหน่ง (row_id = user_id) · ไม่เก็บ last_login
SELECT results_eq(
  $$SELECT old_data ->> 'position_code', new_data ->> 'position_code', changed_by, actor_position_code
      FROM audit_log WHERE table_name = 'profiles' AND row_id = pg_temp.id('a4') AND action = 'update'$$,
  $$VALUES ('supervisor', 'job_admin', '00000000-0000-0000-0000-0000000000a1'::uuid, 'pm')$$,
  'profiles position change is audited with old → new and the actor position');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'profiles' AND row_id = pg_temp.id('a3')
            AND action = 'update'), 0, 'touch_last_login is not audited');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'profiles' AND row_id = pg_temp.id('a7')
            AND action = 'insert'), 1, 'profile insert is audited');

-- กันเขียนทับ: audit_trigger ตัวถัดไปต้องใช้เนื้อ M21 — แถวที่ผู้ใช้ (มีตำแหน่ง) ทำต้องมี actor_position_code เสมอ
SELECT is((SELECT count(*)::int FROM audit_log a JOIN profiles p ON p.user_id = a.changed_by
            WHERE p.position_code IS NOT NULL AND a.actor_position_code IS NULL), 0,
  'GUARD: no user-made audit row has a NULL actor_position_code (someone replaced audit_trigger without M21?)');
SELECT matches(pg_get_functiondef('public.audit_trigger()'::regprocedure), 'actor_position_code',
  'GUARD: audit_trigger still writes actor_position_code');

-- =====================================================================
-- 4. user_notifications
-- =====================================================================
SELECT has_table('public', 'user_notifications', 'user_notifications exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_notifications'::regclass), true,
  'user_notifications has RLS enabled');

-- จากข้อ 2: r1 (a4) ถูกเปลี่ยน หัวหน้างาน → แอดมิน · a5 ถูกตั้ง/ถอดเจ้าของโดย SQL (2 แถว)
SELECT results_eq(
  $$SELECT kind, payload ->> 'old_position_code', payload ->> 'new_position_code',
           payload ->> 'new_position_name', created_by
      FROM user_notifications WHERE user_id = pg_temp.id('a4')$$,
  $$VALUES ('position_changed', 'supervisor', 'job_admin', 'แอดมิน (Admin)', '00000000-0000-0000-0000-0000000000a1'::uuid)$$,
  'position change writes one notification for the user');
SELECT is((SELECT count(*)::int FROM user_notifications WHERE user_id = pg_temp.id('a5')), 2,
  'owner assign + remove by SQL also notify');
SELECT is((SELECT count(*)::int FROM user_notifications WHERE user_id = pg_temp.id('a7')), 0,
  'creating a profile does not notify');
SELECT is((SELECT count(*)::int FROM user_notifications WHERE user_id = pg_temp.id('a3')), 0,
  'refused changes do not notify');

-- cascade จากการเปลี่ยน code ของตำแหน่ง ไม่นับว่าเปลี่ยนตำแหน่ง
UPDATE positions SET code = 'supervisor_x' WHERE code = 'supervisor';
SELECT is((SELECT position_code FROM profiles WHERE user_id = pg_temp.id('a7')), 'supervisor_x', 'code rename cascades');
SELECT is((SELECT count(*)::int FROM user_notifications WHERE user_id = pg_temp.id('a7')), 0,
  'code rename cascade does not notify');
UPDATE positions SET code = 'supervisor' WHERE code = 'supervisor_x';

-- host เปลี่ยน code ตำแหน่งทาง API (cascade) ได้ และไม่แจ้งเตือน
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE positions SET code = 'om_x' WHERE code = 'om'$$, 'host can re-code an assignable position');
SELECT lives_ok($$UPDATE positions SET code = 'om' WHERE code = 'om_x'$$, 'host can re-code it back');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM user_notifications WHERE user_id = pg_temp.id('a2')), 0,
  'API code rename cascade does not notify the holder');

-- ผู้ใช้เห็นเฉพาะของตัวเอง
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT is((SELECT count(*)::int FROM user_notifications), 1, 'user sees only own notifications');
SELECT throws_ok($$INSERT INTO user_notifications (user_id, kind) VALUES (pg_temp.id('a4'), 'fake')$$,
  '42501', NULL, 'user cannot insert notifications');
SELECT throws_ok($$UPDATE user_notifications SET read_at = now()$$,
  '42501', NULL, 'user cannot update notifications directly');
SELECT throws_ok($$DELETE FROM user_notifications$$,
  '42501', NULL, 'user cannot delete notifications');
SELECT is(public.mark_notifications_read(
            (SELECT array_agg(id) FROM (SELECT id FROM user_notifications) x)
            || ARRAY[(SELECT gen_random_uuid())]),
  1, 'mark own as read (unknown ids ignored)');
SELECT is(public.mark_notifications_read(), 0, 'nothing left unread');
RESET ROLE;
SELECT isnt((SELECT read_at FROM user_notifications WHERE user_id = pg_temp.id('a4')), NULL, 'own row is marked read');

-- id ของคนอื่น → ไม่มีผล
CREATE TEMP TABLE _other AS SELECT array_agg(id) AS ids FROM user_notifications WHERE user_id = pg_temp.id('a5');
GRANT SELECT ON _other TO PUBLIC;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT is(public.mark_notifications_read((SELECT ids FROM _other)), 0, 'cannot mark another user''s rows as read');
SELECT is((SELECT count(*)::int FROM user_notifications WHERE user_id = pg_temp.id('a5')), 0,
  'another user''s rows are invisible');
-- viewer เห็นเฉพาะของตัวเอง (ไม่มี)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a6', true);
SELECT is((SELECT count(*)::int FROM user_notifications), 0, 'viewer sees nothing beyond own rows');
-- ไม่ได้ล็อกอิน
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is((SELECT count(*)::int FROM user_notifications), 0, 'no user → no rows');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM user_notifications WHERE user_id = pg_temp.id('a5') AND read_at IS NULL), 2,
  'another user''s rows stay unread');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.user_notifications$$, '42501', NULL, 'anon cannot read notifications');
SELECT throws_ok($$SELECT public.mark_notifications_read()$$, '42501', NULL, 'anon cannot call mark_notifications_read');
RESET ROLE;

SELECT is(has_table_privilege('anon', 'public.user_notifications', 'SELECT,INSERT,UPDATE,DELETE'), false,
  'anon has no table privilege on user_notifications');
SELECT is(has_table_privilege('authenticated', 'public.user_notifications', 'INSERT,UPDATE,DELETE'), false,
  'authenticated has no write privilege on user_notifications');
SELECT is(has_function_privilege('authenticated', 'public.profiles_notify_position_change()', 'EXECUTE'), false,
  'authenticated cannot call the notify trigger function');
SELECT is(has_function_privilege('authenticated', 'public.is_api_session()', 'EXECUTE'), false,
  'authenticated cannot call is_api_session');

-- =====================================================================
-- 5. division_scope อัตโนมัติ + เห็นสาขาตามคาด
-- =====================================================================
SELECT col_default_is('public', 'profiles', 'division_scope', '{central,province}',
  'division_scope defaults to {central,province}');
SELECT is((SELECT division_scope::text FROM profiles WHERE user_id = pg_temp.id('a7')), '{central,province}',
  'new user without division_scope gets both divisions');
SELECT is((SELECT division_scope::text FROM profiles WHERE user_id = pg_temp.id('a4')), '{central}',
  'explicit division_scope is kept');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', true);  -- new user
SELECT is((SELECT public.branch_in_scope(branch_id) FROM customers WHERE id = pg_temp.id('c1'))
          AND (SELECT public.branch_in_scope(branch_id) FROM customers WHERE id = pg_temp.id('c2')), true,
  'new user has central + province branches in scope');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', true);  -- central only
SELECT is((SELECT public.branch_in_scope(branch_id) FROM customers WHERE id = pg_temp.id('c2')), false,
  'central-only user does not have province branches in scope');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
