-- monthly_branch_snapshots v1.4 (SPEC §6, §6.5): provincial manual rows
--   source='manual' rows are written by host only · still public-readable (Dashboard)
BEGIN;
SELECT plan(13);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host', 'user_a1',     'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'user_a2',    'admin',    '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central,province}');

CREATE TEMP TABLE _b AS
  SELECT (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1) AS prov_id,
         (SELECT id FROM branches WHERE division = 'province' ORDER BY name OFFSET 1 LIMIT 1) AS prov2_id;
GRANT SELECT ON _b TO PUBLIC;

-- defaults for the new per-tier values
SELECT col_default_is('public', 'monthly_branch_snapshots', 'v_s1', '0', 'v_s1 defaults to 0');
SELECT col_not_null('public', 'monthly_branch_snapshots', 'v_xl3', 'v_xl3 NOT NULL');

-- ===== host writes a manual (provincial) row with all v1.4 fields =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots
      (month_key, branch_id, source, s1, s3, cust, "vS", value,
       v_s1, v_s3, report_cust, report_value, confirmed_at, confirmed_by)
    SELECT '2026-09', prov_id, 'manual', 2, 1, 3, 45000, 45000,
           20000, 25000, 3, 45000, now(), auth.uid() FROM _b$$,
  'host writes a manual snapshot row');
RESET ROLE;

SELECT is(
  (SELECT ROW(v_s1, v_s3, report_cust, report_value, confirmed_by)::text
     FROM monthly_branch_snapshots WHERE month_key = '2026-09' AND source = 'manual'),
  ROW(20000.00::numeric(14,2), 25000.00::numeric(14,2), 3, 45000.00::numeric(14,2),
      '00000000-0000-0000-0000-0000000000a1'::uuid)::text,
  'v_s*, report_*, confirmed_by stored');

-- ===== admin / recorder cannot write manual rows =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT '2026-09', prov2_id, 'manual' FROM _b$$,
  '42501', NULL, 'admin cannot insert a manual row');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT '2026-09', prov2_id, 'manual' FROM _b$$,
  '42501', NULL, 'recorder cannot insert a manual row');
UPDATE monthly_branch_snapshots SET value = 1, confirmed_at = NULL WHERE month_key = '2026-09' AND source = 'manual';
DELETE FROM monthly_branch_snapshots WHERE month_key = '2026-09' AND source = 'manual';
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT '2026-10', prov2_id, 'computed' FROM _b$$,
  '42501', NULL, 'recorder cannot insert computed rows either (written by host / server)');
RESET ROLE;

SELECT is((SELECT value FROM monthly_branch_snapshots WHERE month_key = '2026-09' AND source = 'manual'),
  45000.00::numeric(14,2), 'recorder UPDATE of a manual row affected 0 rows');
SELECT isnt((SELECT confirmed_at FROM monthly_branch_snapshots WHERE month_key = '2026-09' AND source = 'manual'),
  NULL, 'recorder could not clear confirmed_at');
SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots WHERE month_key = '2026-09' AND source = 'manual'),
  1, 'recorder DELETE of a manual row affected 0 rows');

-- ===== still public for the Dashboard / summary page =====
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots WHERE month_key = '2026-09'), 1, 'anon reads snapshot rows');
-- anon ถูกปฏิเสธตั้งแต่ชั้นสิทธิ์ (SQLSTATE 42501) ไม่ใช่แค่แก้แล้วโดน RLS กรองจนกระทบ 0 แถว
SELECT throws_ok($$UPDATE monthly_branch_snapshots SET value = 0$$,
  '42501', NULL, 'anon cannot update snapshots');
RESET ROLE;
SELECT is((SELECT value FROM monthly_branch_snapshots WHERE month_key = '2026-09' AND source = 'manual'),
  45000.00::numeric(14,2), 'anon UPDATE of snapshots affected 0 rows');

SELECT * FROM finish();
ROLLBACK;
