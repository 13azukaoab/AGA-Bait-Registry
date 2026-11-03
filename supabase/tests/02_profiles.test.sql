-- profiles table + role/division helper functions (Task 3)
BEGIN;
SELECT plan(21);

-- ---------- profiles table ----------
SELECT has_table('public', 'profiles', 'profiles exists');
SELECT col_is_pk('public', 'profiles', 'user_id', 'user_id is PK');
SELECT col_type_is('public', 'profiles', 'user_id', 'uuid', 'user_id uuid');
SELECT col_type_is('public', 'profiles', 'display_name', 'text', 'display_name text');
SELECT col_type_is('public', 'profiles', 'role', 'public', 'user_role', 'role is user_role');
SELECT col_not_null('public', 'profiles', 'role', 'role NOT NULL');
SELECT col_type_is('public', 'profiles', 'division_scope', 'public', '_division', 'division_scope is division[]');
SELECT col_not_null('public', 'profiles', 'division_scope', 'division_scope NOT NULL');
SELECT col_has_default('public', 'profiles', 'division_scope', 'division_scope has default');
SELECT col_type_is('public', 'profiles', 'team_id', 'uuid', 'team_id uuid');
SELECT fk_ok('public', 'profiles', 'user_id', 'auth', 'users', 'id', 'user_id -> auth.users');
SELECT fk_ok('public', 'profiles', 'team_id', 'public', 'teams', 'id', 'team_id -> teams');

-- ---------- helper functions ----------
SELECT function_returns('public', 'current_app_role',       ARRAY[]::text[], 'user_role');
SELECT function_returns('public', 'current_division_scope', ARRAY[]::text[], 'division[]');
SELECT function_returns('public', 'is_host',                ARRAY[]::text[], 'boolean');
SELECT is_definer('public', 'current_app_role',       ARRAY[]::text[], 'current_app_role is security definer');
SELECT is_definer('public', 'current_division_scope', ARRAY[]::text[], 'current_division_scope is security definer');
SELECT is_definer('public', 'is_host',                ARRAY[]::text[], 'is_host is security definer');

-- ---------- behaviour ----------
-- no signed-in user / no profile row: NULL, NULL, false
SELECT is(public.current_app_role(), NULL::user_role, 'no profile => role NULL');
SELECT is(public.is_host(), false, 'no profile => is_host false');

-- with a profile: simulate auth.uid() via request.jwt.claim.sub
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000a1');
INSERT INTO profiles (user_id, display_name, role, division_scope)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'test host', 'host', '{central}');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT is(
  ROW(public.current_app_role(), public.current_division_scope(), public.is_host())::text,
  ROW('host'::user_role, '{central}'::division[], true)::text,
  'host profile => host, {central}, true'
);

SELECT * FROM finish();
ROLLBACK;
