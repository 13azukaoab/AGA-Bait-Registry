-- positions + profiles account fields (SPEC §6 profiles, §17 6 พ.ย., แผนงาน A2/D3)
BEGIN;
SELECT plan(35);

-- ---------- positions ----------
SELECT has_table('public', 'positions', 'positions exists');
SELECT col_is_pk('public', 'positions', 'code', 'positions PK is code');
SELECT col_type_is('public', 'positions', 'role', 'public', 'user_role', 'positions.role is user_role');
SELECT col_not_null('public', 'positions', 'name_th', 'positions.name_th NOT NULL');
SELECT results_eq(
  $$SELECT code, name_th, role::text FROM positions ORDER BY sort_order$$,
  $$VALUES ('job_admin', 'Admin (เปิดงาน)', 'admin'),
           ('supervisor', 'หัวหน้างาน', 'recorder'),
           ('pm', 'Project Manager', 'host'),
           ('om', 'OM', 'host')$$,
  'seed: 4 positions mapped to permission levels (PM = OM = host, D3)');

-- ---------- profiles columns ----------
SELECT col_type_is('public', 'profiles', 'username', 'text', 'username text');
SELECT col_not_null('public', 'profiles', 'username', 'username NOT NULL');
SELECT col_is_unique('public', 'profiles', 'username', 'username unique');
SELECT col_type_is('public', 'profiles', 'is_active', 'boolean', 'is_active boolean');
SELECT col_default_is('public', 'profiles', 'is_active', 'true', 'is_active defaults to true');
SELECT col_default_is('public', 'profiles', 'must_change_password', 'true', 'must_change_password defaults to true');
SELECT col_type_is('public', 'profiles', 'last_login', 'timestamp with time zone', 'last_login timestamptz');
SELECT fk_ok('public', 'profiles', 'position_code', 'public', 'positions', 'code', 'position_code -> positions');

-- ---------- seed users ----------
INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT ('00000000-0000-0000-0000-0000000000' || s)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', s || '@test.local'
FROM unnest(ARRAY['a1','a2','a3','a4','a6','a7','a8']) s;

INSERT INTO profiles (user_id, display_name, username, role, division_scope, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Host 1',   'host1',   'host',     '{central,province}', true),
  ('00000000-0000-0000-0000-0000000000a3', 'Rec 1',    'rec1',    'recorder', '{central}',          true),
  ('00000000-0000-0000-0000-0000000000a6', 'Old host', 'oldhost', 'host',     '{central}',          false);

-- ---------- username format: a-z 0-9 . _ - , 3-20 chars ----------
SELECT lives_ok(
  $$INSERT INTO profiles (user_id, username, role) VALUES ('00000000-0000-0000-0000-0000000000a7', 'nat.k_01-x', 'admin')$$,
  'valid username accepted');
SELECT throws_ok(
  $$INSERT INTO profiles (user_id, username, role) VALUES ('00000000-0000-0000-0000-0000000000a8', 'Nat1', 'admin')$$,
  '23514', NULL, 'uppercase rejected');
SELECT throws_ok(
  $$INSERT INTO profiles (user_id, username, role) VALUES ('00000000-0000-0000-0000-0000000000a8', 'ab', 'admin')$$,
  '23514', NULL, 'shorter than 3 rejected');
SELECT throws_ok(
  $$INSERT INTO profiles (user_id, username, role) VALUES ('00000000-0000-0000-0000-0000000000a8', 'abcdefghijklmnopqrstu', 'admin')$$,
  '23514', NULL, 'longer than 20 rejected');
SELECT throws_ok(
  $$INSERT INTO profiles (user_id, username, role) VALUES ('00000000-0000-0000-0000-0000000000a8', 'มานี', 'admin')$$,
  '23514', NULL, 'Thai characters rejected');
SELECT throws_ok(
  $$INSERT INTO profiles (user_id, username, role) VALUES ('00000000-0000-0000-0000-0000000000a8', 'nat.k_01-x', 'admin')$$,
  '23505', NULL, 'duplicate username rejected');

-- ---------- last active host cannot be disabled / demoted / deleted ----------
-- (a6 is a host but inactive -> does not count)
SELECT throws_ok(
  $$UPDATE profiles SET is_active = false WHERE user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', NULL, 'last host: disable rejected');
SELECT throws_ok(
  $$UPDATE profiles SET role = 'admin' WHERE user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', NULL, 'last host: demote rejected');
SELECT throws_ok(
  $$DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', NULL, 'last host: delete rejected');
SELECT throws_ok(
  $$UPDATE profiles SET position_code = 'supervisor' WHERE user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', NULL, 'last host: demote through position rejected');

-- ---------- role follows the position ----------
INSERT INTO profiles (user_id, display_name, username, role, position_code)
  VALUES ('00000000-0000-0000-0000-0000000000a2', 'Host 2', 'host2', 'viewer', 'pm');
SELECT is((SELECT role::text FROM profiles WHERE user_id = '00000000-0000-0000-0000-0000000000a2'),
  'host', 'position pm sets role host');
SELECT lives_ok(
  $$UPDATE profiles SET position_code = 'supervisor' WHERE user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  'second host exists: host1 may move to supervisor');
SELECT is((SELECT role::text FROM profiles WHERE user_id = '00000000-0000-0000-0000-0000000000a1'),
  'recorder', 'position supervisor sets role recorder');
SELECT throws_ok(
  $$UPDATE profiles SET is_active = false WHERE user_id = '00000000-0000-0000-0000-0000000000a2'$$,
  'P0001', NULL, 'host2 is now the last host: disable rejected');

-- ---------- a host cannot disable their own account ----------
INSERT INTO profiles (user_id, display_name, username, role)
  VALUES ('00000000-0000-0000-0000-0000000000a4', 'Host 3', 'host3', 'host');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(
  $$UPDATE profiles SET is_active = false WHERE user_id = '00000000-0000-0000-0000-0000000000a2'$$,
  'P0001', NULL, 'host cannot disable own account');
SELECT lives_ok(
  $$UPDATE profiles SET is_active = false WHERE user_id = '00000000-0000-0000-0000-0000000000a4'$$,
  'host disables another host');
RESET ROLE;

-- ---------- disabled account loses its permissions ----------
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT is(public.is_host(), false, 'disabled host: is_host() = false');
SELECT is(public.current_app_role(), NULL::user_role, 'disabled host: current_app_role() = NULL');

-- ---------- positions RLS ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(
  $$INSERT INTO positions (code, name_th, role) VALUES ('x', 'X', 'admin')$$,
  '42501', NULL, 'recorder cannot add positions');
SELECT is((SELECT count(*)::int FROM positions), 4, 'signed-in users read positions');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM positions), 0, 'anon: positions = 0 rows');
RESET ROLE;

-- ---------- changing a position's level updates its holders ----------
UPDATE positions SET role = 'admin' WHERE code = 'supervisor';
SELECT is((SELECT role::text FROM profiles WHERE user_id = '00000000-0000-0000-0000-0000000000a1'),
  'admin', 'holders follow a position level change');

SELECT * FROM finish();
ROLLBACK;
