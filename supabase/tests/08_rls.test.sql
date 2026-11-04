-- RLS policies + public summary view (Task 9) - SPEC §5, §15.2
-- Role simulation: seed as postgres, then SET LOCAL ROLE anon/authenticated and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(49);

-- ---------- RLS enabled everywhere ----------
SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity),
  0, 'every public table has RLS enabled');
SELECT is((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass),
  false, 'profiles is NOT force-RLS (helpers keep owner bypass)');
SELECT is_definer('public', 'set_follow_up_no', ARRAY[]::text[], 'set_follow_up_no is security definer');
SELECT is_definer('public', 'branch_in_scope', ARRAY['uuid'], 'branch_in_scope is security definer');

-- ---------- seed (as postgres, bypasses RLS) ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'recorder', '{central}');

CREATE TEMP TABLE _b AS
  SELECT (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1) AS central_id,
         (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1) AS province_id;
GRANT SELECT ON _b TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT central_id  FROM _b), 'Central Cust'),
  ('00000000-0000-0000-0000-0000000000c2', (SELECT province_id FROM _b), 'Province Cust');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'T-CEN-1', '2026-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', 'T-PRO-1', '2026-01-15', 1, 50000);
INSERT INTO stations (id, contract_id, code, type) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'S-01', 'IG'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d2', 'S-01', 'IG');
INSERT INTO visits (id, contract_id, visit_date, visit_type, note) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-02-01', 'routine', 'orig'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2', '2026-02-01', 'routine', 'orig');
INSERT INTO station_checks (id, visit_id, station_id) VALUES
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2');
INSERT INTO contract_teams (contract_id, team_id)
  SELECT '00000000-0000-0000-0000-0000000000d1', id FROM teams LIMIT 1;
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, cust, value)
  VALUES ('JAN.26', (SELECT central_id FROM _b), 'computed', 1, 50000);

-- ================= anon (viewer, SPEC §15.2) =================
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM customers),      0, 'anon: customers = 0 rows');
SELECT is((SELECT count(*)::int FROM contracts),      0, 'anon: contracts = 0 rows');
SELECT is((SELECT count(*)::int FROM stations),       0, 'anon: stations = 0 rows');
SELECT is((SELECT count(*)::int FROM visits),         0, 'anon: visits = 0 rows');
SELECT is((SELECT count(*)::int FROM station_checks), 0, 'anon: station_checks = 0 rows');
SELECT is((SELECT count(*)::int FROM contract_teams), 0, 'anon: contract_teams = 0 rows');
SELECT is((SELECT count(*)::int FROM profiles),       0, 'anon: profiles = 0 rows');
SELECT is((SELECT count(*)::int FROM audit_log),      0, 'anon: audit_log = 0 rows');
SELECT is((SELECT count(*)::int FROM branches),       0, 'anon: branches = 0 rows');
SELECT cmp_ok((SELECT count(*)::int FROM monthly_branch_snapshots), '>=', 1, 'anon: snapshots readable');
SELECT cmp_ok((SELECT count(*)::int FROM v_branch_summary), '>=', 1, 'anon: v_branch_summary readable');
SELECT throws_ok(
  $$INSERT INTO customers (branch_id, name) SELECT central_id, 'x' FROM _b$$,
  '42501', NULL, 'anon cannot insert customers');
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT 'FEB.26', central_id, 'manual' FROM _b$$,
  '42501', NULL, 'anon cannot write snapshots');
RESET ROLE;

-- ================= recorder scoped to central =================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);

SELECT is((SELECT count(*)::int FROM customers), 2, 'recorder reads customers of all branches');
SELECT lives_ok(
  $$INSERT INTO visits (id, contract_id, visit_date, visit_type) VALUES ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d1', '2026-03-01', 'routine')$$,
  'recorder can insert visit for central contract');
SELECT throws_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type) VALUES ('00000000-0000-0000-0000-0000000000d2', '2026-03-01', 'routine')$$,
  '42501', NULL, 'recorder REJECTED inserting visit for province contract');
UPDATE visits SET note = 'edited' WHERE id = '00000000-0000-0000-0000-0000000000f1';
UPDATE visits SET note = 'hacked' WHERE id = '00000000-0000-0000-0000-0000000000f2';
SELECT throws_ok(
  $$UPDATE visits SET contract_id = '00000000-0000-0000-0000-0000000000d2' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  '42501', NULL, 'recorder cannot move a visit to a province contract');
-- follow_up_no: central station e1 already has a check on 2026-02-01 -> new check on 03-01 = F2
SELECT lives_ok(
  $$INSERT INTO station_checks (id, visit_id, station_id) VALUES ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e1')$$,
  'recorder can insert station_check in scope');
SELECT throws_ok(
  $$INSERT INTO station_checks (visit_id, station_id) VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2')$$,
  '42501', NULL, 'recorder REJECTED inserting station_check for province visit');
SELECT throws_ok(
  $$INSERT INTO station_checks (visit_id, station_id) VALUES ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e2')$$,
  '42501', NULL, 'recorder REJECTED mixing central visit with province station');
SELECT throws_ok(
  $$INSERT INTO customers (branch_id, name) SELECT central_id, 'x' FROM _b$$,
  '42501', NULL, 'recorder cannot insert customers');
UPDATE profiles SET role = 'host' WHERE user_id = '00000000-0000-0000-0000-0000000000a3';
SELECT is((SELECT count(*)::int FROM audit_log), 0, 'recorder cannot read audit_log');
RESET ROLE;

SELECT is((SELECT note FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'edited', 'recorder update of central visit applied');
SELECT is((SELECT note FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f2'), 'orig',   'recorder update of province visit ignored');
SELECT is((SELECT follow_up_no FROM station_checks WHERE id = '00000000-0000-0000-0000-000000000a03'), 2, 'follow_up_no computed (F2)');
SELECT is((SELECT role::text FROM profiles WHERE user_id = '00000000-0000-0000-0000-0000000000a3'), 'recorder', 'recorder cannot escalate own role');

-- ================= admin scoped to central =================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

SELECT is((SELECT count(*)::int FROM contracts), 2, 'admin reads contracts of all branches');
SELECT lives_ok(
  $$INSERT INTO customers (id, branch_id, name) SELECT '00000000-0000-0000-0000-0000000000c3', central_id, 'Admin Central' FROM _b$$,
  'admin can insert customer in central branch');
SELECT throws_ok(
  $$INSERT INTO customers (branch_id, name) SELECT province_id, 'Admin Prov' FROM _b$$,
  '42501', NULL, 'admin REJECTED inserting customer in province branch');
UPDATE customers SET name = 'hacked' WHERE id = '00000000-0000-0000-0000-0000000000c2';
SELECT lives_ok(
  $$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total) VALUES ('00000000-0000-0000-0000-0000000000c3', 'T-CEN-2', '2026-01-15', 1, 1000)$$,
  'admin can insert contract for central customer');
SELECT throws_ok(
  $$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total) VALUES ('00000000-0000-0000-0000-0000000000c2', 'T-PRO-2', '2026-01-15', 1, 1000)$$,
  '42501', NULL, 'admin REJECTED inserting contract for province customer');
SELECT throws_ok(
  $$INSERT INTO stations (contract_id, type) VALUES ('00000000-0000-0000-0000-0000000000d2', 'IG')$$,
  '42501', NULL, 'admin REJECTED inserting station for province contract');
SELECT throws_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type) VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-03-05', 'routine')$$,
  '42501', NULL, 'admin cannot insert visits (recorder-only)');
UPDATE profiles SET role = 'host' WHERE user_id = '00000000-0000-0000-0000-0000000000a2';
UPDATE profiles SET division_scope = '{central,province}' WHERE user_id = '00000000-0000-0000-0000-0000000000a2';
SELECT is((SELECT count(*)::int FROM profiles), 1, 'admin sees only own profile row');
RESET ROLE;

SELECT is((SELECT name FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c2'), 'Province Cust', 'admin update of province customer ignored');
SELECT is((SELECT role::text || division_scope::text FROM profiles WHERE user_id = '00000000-0000-0000-0000-0000000000a2'), 'admin{central}', 'admin cannot change own role/scope');

-- ================= host =================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

SELECT lives_ok(
  $$INSERT INTO customers (id, branch_id, name) SELECT '00000000-0000-0000-0000-0000000000c4', province_id, 'Host Prov' FROM _b$$,
  'host can insert customer in province branch');
SELECT lives_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type) VALUES ('00000000-0000-0000-0000-0000000000d2', '2026-03-09', 'routine')$$,
  'host can insert visit for province contract');
SELECT lives_ok(
  $$UPDATE profiles SET division_scope = '{central,province}' WHERE user_id = '00000000-0000-0000-0000-0000000000a2'$$,
  'host can change another profile scope');
SELECT cmp_ok((SELECT count(*)::int FROM audit_log), '>', 0, 'host reads audit_log');
SELECT is((SELECT count(*)::int FROM profiles), 3, 'host reads all profiles');
SELECT lives_ok(
  $$UPDATE tier_rules SET max_annual = max_annual WHERE tier = 'S'$$, 'host can write tier_rules');
RESET ROLE;

-- ================= reference tables: authenticated read, non-host write blocked =================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT cmp_ok((SELECT count(*)::int FROM tier_rules), '>=', 1, 'recorder reads tier_rules');
SELECT cmp_ok((SELECT count(*)::int FROM branches), '>=', 1, 'recorder reads branches');
SELECT throws_ok(
  $$INSERT INTO zones (name, sort_order) VALUES ('เขต X', 999)$$,
  '42501', NULL, 'recorder cannot write zones');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
