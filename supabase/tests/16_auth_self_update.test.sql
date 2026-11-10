-- touch_last_login / complete_password_change (20261110110000) — SPEC §5.1, §8 หน้า 1
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(18);

-- ---------- the functions exist, are definer, take no arguments ----------
SELECT has_function('public', 'touch_last_login', ARRAY[]::text[],
  'touch_last_login() exists and takes no arguments');
SELECT has_function('public', 'complete_password_change', ARRAY[]::text[],
  'complete_password_change() exists and takes no arguments');
SELECT is_definer('public', 'touch_last_login', ARRAY[]::text[],
  'touch_last_login is security definer');
SELECT is_definer('public', 'complete_password_change', ARRAY[]::text[],
  'complete_password_change is security definer');

-- ---------- only signed-in users may call them ----------
SELECT function_privs_are('public', 'touch_last_login', ARRAY[]::text[], 'anon',
  ARRAY[]::text[], 'anon cannot execute touch_last_login');
SELECT function_privs_are('public', 'complete_password_change', ARRAY[]::text[], 'anon',
  ARRAY[]::text[], 'anon cannot execute complete_password_change');
SELECT function_privs_are('public', 'touch_last_login', ARRAY[]::text[], 'authenticated',
  ARRAY['EXECUTE'], 'authenticated can execute touch_last_login');
SELECT function_privs_are('public', 'complete_password_change', ARRAY[]::text[], 'authenticated',
  ARRAY['EXECUTE'], 'authenticated can execute complete_password_change');

-- ---------- seed: two active users + one closed account ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'self1@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'self2@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'self3@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope, is_active, must_change_password) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'Self 1', 'self1', 'recorder', '{central}', true,  true),
  ('00000000-0000-0000-0000-0000000000f2', 'Self 2', 'self2', 'recorder', '{central}', true,  true),
  ('00000000-0000-0000-0000-0000000000f3', 'Self 3', 'self3', 'admin',    '{central}', false, true);

-- ---------- user f1 updates only their own row ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
SELECT lives_ok($$SELECT public.touch_last_login()$$, 'f1 may call touch_last_login');
SELECT lives_ok($$SELECT public.complete_password_change()$$, 'f1 may call complete_password_change');
RESET ROLE;

SELECT isnt((SELECT last_login FROM profiles WHERE username = 'self1'), NULL,
  'own last_login is written');
SELECT is((SELECT last_login FROM profiles WHERE username = 'self2'), NULL,
  'another user last_login is untouched');
SELECT is((SELECT must_change_password FROM profiles WHERE username = 'self1'), false,
  'own must_change_password is cleared');
SELECT is((SELECT must_change_password FROM profiles WHERE username = 'self2'), true,
  'another user must_change_password is untouched');
SELECT is((SELECT role::text FROM profiles WHERE username = 'self1'), 'recorder',
  'role cannot be changed through these functions');

-- ---------- a closed account calling them has no effect ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f3', true);
SELECT public.touch_last_login();
SELECT public.complete_password_change();
RESET ROLE;

SELECT is((SELECT last_login FROM profiles WHERE username = 'self3'), NULL,
  'closed account: last_login stays NULL');
SELECT is((SELECT must_change_password FROM profiles WHERE username = 'self3'), true,
  'closed account: must_change_password stays true');

-- ---------- anon is refused at the GRANT gate ----------
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.touch_last_login()$$, '42501', NULL,
  'anon calling touch_last_login is denied');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
