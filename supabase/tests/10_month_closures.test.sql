-- month_closures v1.5: split close central / provincial (SPEC §6, §7.7, §14 ข้อ 14)
--   key = (month_key, scope) · recorder closes central only (needs 'central' in
--   division_scope) · host closes both · no reopen step (no DELETE for recorder)
BEGIN;
SELECT plan(19);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recprov@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host', 'user_a1',      'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'user_a2',     'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3',  'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'rec-prov', 'user_a4',  'recorder', '{province}');

-- provincial August closed by host earlier (seeded as postgres)
INSERT INTO month_closures (month_key, scope, closed_by, closed_at)
  VALUES ('2026-08', 'provincial', '00000000-0000-0000-0000-0000000000a1', now());

-- ===== recorder (central scope) =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-09', 'central')$$,
  'recorder closes central');
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-09', 'provincial')$$,
  '42501', NULL, 'recorder cannot close provincial (phase 1: host only)');
SELECT lives_ok(
  $$UPDATE month_closures SET last_resync_at = now(), last_resync_by = auth.uid()
     WHERE month_key = '2026-09' AND scope = 'central'$$,
  'recorder records a central re-sync');
SELECT throws_ok(
  $$UPDATE month_closures SET scope = 'provincial' WHERE month_key = '2026-09' AND scope = 'central'$$,
  '42501', NULL, 'recorder cannot turn a central closure into provincial');
UPDATE month_closures SET last_resync_at = now() WHERE month_key = '2026-08' AND scope = 'provincial';
DELETE FROM month_closures WHERE month_key = '2026-09' AND scope = 'central';
RESET ROLE;

SELECT is(
  (SELECT closed_by FROM month_closures WHERE month_key = '2026-09' AND scope = 'central'),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'closed_by defaults to the signed-in user');
SELECT isnt(
  (SELECT closed_at FROM month_closures WHERE month_key = '2026-09' AND scope = 'central'),
  NULL, 'closed_at defaults to now()');
SELECT is(
  (SELECT last_resync_by FROM month_closures WHERE month_key = '2026-09' AND scope = 'central'),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'last_resync_by stored');
SELECT is(
  (SELECT last_resync_at FROM month_closures WHERE month_key = '2026-08' AND scope = 'provincial'),
  NULL, 'recorder UPDATE of a provincial closure affected 0 rows');
SELECT is(
  (SELECT count(*)::int FROM month_closures WHERE month_key = '2026-09' AND scope = 'central'),
  1, 'recorder DELETE (reopen) affected 0 rows - there is no reopen step');

-- ===== recorder scoped to province only cannot close central =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-10', 'central')$$,
  '42501', NULL, 'recorder without central in division_scope cannot close central');
RESET ROLE;

-- ===== admin =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-10', 'central')$$,
  '42501', NULL, 'admin cannot close a month');
SELECT is((SELECT count(*)::int FROM month_closures), 2, 'admin can read closures');
RESET ROLE;

-- ===== host =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-09', 'provincial')$$,
  'host closes provincial');
SELECT lives_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-10', 'central')$$,
  'host closes central');
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-09', 'central')$$,
  '23505', NULL, 'one closure per (month_key, scope)');
SELECT lives_ok(
  $$DELETE FROM month_closures WHERE month_key = '2026-10' AND scope = 'central'$$,
  'host may still delete a closure row');
RESET ROLE;

SELECT is(
  (SELECT array_agg(scope::text ORDER BY scope) FROM month_closures WHERE month_key = '2026-09'),
  ARRAY['central', 'provincial'], 'one month holds both scopes');

-- ===== anon =====
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM month_closures), 0, 'anon: month_closures = 0 rows');
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-11', 'central')$$,
  '42501', NULL, 'anon cannot close a month');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
