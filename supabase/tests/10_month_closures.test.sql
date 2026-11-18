-- month_closures v1.5: split close central / provincial (SPEC §6, §7.7, §14 ข้อ 14)
--   key = (month_key, scope) · no reopen step
--   M39 (20261115270000): **เขียนผ่าน RPC เท่านั้น** — ไม่มี policy/สิทธิ์เขียนตรงสำหรับทุก role (รวม host)
--   ปิดเดือนจริงทดสอบใน 53_month_close.test.sql (close_month_part · สิทธิ์ host / recorder ส่วนกลาง)
--   อ่าน: host / admin / recorder · anon ไม่ได้
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

-- แถวตั้งต้น (ใส่ด้วย postgres แทน RPC)
INSERT INTO month_closures (month_key, scope, closed_by, closed_at)
  VALUES ('2026-08', 'province', '00000000-0000-0000-0000-0000000000a1', now());
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
INSERT INTO month_closures (month_key, scope) VALUES ('2026-09', 'central');
INSERT INTO month_closures (month_key, scope) VALUES ('2026-09', 'province');

SELECT is(
  (SELECT closed_by FROM month_closures WHERE month_key = '2026-09' AND scope = 'central'),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'closed_by defaults to the signed-in user');
SELECT isnt(
  (SELECT closed_at FROM month_closures WHERE month_key = '2026-09' AND scope = 'central'),
  NULL, 'closed_at defaults to now()');
SELECT is(
  (SELECT array_agg(scope::text ORDER BY scope) FROM month_closures WHERE month_key = '2026-09'),
  ARRAY['central', 'province'], 'one month holds both scopes');
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-09', 'central')$$,
  '23505', NULL, 'one closure per (month_key, scope)');

-- ===== M39: ไม่มีทางเขียนตรง =====
SELECT is((SELECT array_agg(policyname::text) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'month_closures'),
  ARRAY['month_closures_select'], 'only the read policy remains (write policies dropped in M39)');
SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) a(act)
    WHERE has_table_privilege('authenticated', 'public.month_closures', act)
       OR has_table_privilege('service_role', 'public.month_closures', act)),
  0, 'authenticated / service_role have no write privilege on month_closures');

-- ===== recorder (central scope) =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-10', 'central')$$,
  '42501', NULL, 'recorder cannot insert a closure directly (RPC only)');
SELECT throws_ok(
  $$UPDATE month_closures SET last_resync_at = now() WHERE month_key = '2026-09' AND scope = 'central'$$,
  '42501', NULL, 'recorder cannot update a closure directly');
SELECT throws_ok(
  $$DELETE FROM month_closures WHERE month_key = '2026-09' AND scope = 'central'$$,
  '42501', NULL, 'recorder cannot delete a closure (no reopen step)');
SELECT is((SELECT count(*)::int FROM month_closures), 3, 'recorder can read closures');
RESET ROLE;

-- ===== recorder scoped to province only =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-10', 'central')$$,
  '42501', NULL, 'province-only recorder cannot insert a closure');
RESET ROLE;

-- ===== admin =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-10', 'central')$$,
  '42501', NULL, 'admin cannot close a month');
SELECT is((SELECT count(*)::int FROM month_closures), 3, 'admin can read closures');
RESET ROLE;

-- ===== host =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-10', 'central')$$,
  '42501', NULL, 'host cannot insert a closure directly (RPC only)');
SELECT throws_ok(
  $$UPDATE month_closures SET closed_at = now() WHERE month_key = '2026-08' AND scope = 'province'$$,
  '42501', NULL, 'host cannot update a closure directly (use set_month_closer)');
SELECT throws_ok(
  $$DELETE FROM month_closures WHERE month_key = '2026-08' AND scope = 'province'$$,
  '42501', NULL, 'host cannot delete a closure');
SELECT is((SELECT count(*)::int FROM month_closures), 3, 'host can read closures');
RESET ROLE;

-- ===== anon =====
SET LOCAL ROLE anon;
-- anon ถูกปฏิเสธตั้งแต่ชั้นสิทธิ์ (SQLSTATE 42501) ไม่ใช่แค่ถูก RLS กรองจนเหลือ 0 แถว
SELECT throws_ok($$SELECT 1 FROM month_closures$$, '42501', NULL, 'anon: month_closures denied');
SELECT throws_ok(
  $$INSERT INTO month_closures (month_key, scope) VALUES ('2026-11', 'central')$$,
  '42501', NULL, 'anon cannot close a month');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
