-- Closed months are NOT locked (SPEC v1.2 §7.7, §15.3)
-- host + recorder may edit visits/station_checks of a closed month; other roles are
-- blocked by RLS (not by a trigger); every edit leaves a row in audit_log.
BEGIN;
SELECT plan(16);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host', 'user_a1',     'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'user_a2',    'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}');

INSERT INTO customers (id, branch_id, name)
  VALUES ('00000000-0000-0000-0000-0000000000c1',
          (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Cust');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'T-1', '2026-01-15', 1, 50000);
INSERT INTO stations (id, contract_id, code, type)
  VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'S-01', 'IG');
INSERT INTO visits (id, contract_id, visit_date, visit_type, note) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-09-10', 'routine', 'orig');
INSERT INTO station_checks (id, visit_id, station_id)
  VALUES ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1');

-- September is closed
INSERT INTO month_closures (month_key, scope, closed_at) VALUES ('2026-09', 'central', now());

-- ===== the old lock is gone =====
SELECT hasnt_function('public', 'block_closed_month', 'block_closed_month() removed');
SELECT hasnt_trigger('public', 'visits', 'block_closed_month', 'no lock trigger on visits');
SELECT hasnt_trigger('public', 'station_checks', 'block_closed_month', 'no lock trigger on station_checks');

-- ===== recorder edits a CLOSED month =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(
  $$INSERT INTO visits (id, contract_id, visit_date, visit_type) VALUES ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d1', '2026-09-20', 'problem')$$,
  'recorder: INSERT visit in closed month');
SELECT lives_ok(
  $$UPDATE visits SET note = 'rec edit' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  'recorder: UPDATE visit in closed month');
SELECT lives_ok(
  $$UPDATE station_checks SET note = 'rec check' WHERE id = '00000000-0000-0000-0000-000000000a01'$$,
  'recorder: UPDATE station_check in closed month');
SELECT lives_ok(
  $$DELETE FROM station_checks WHERE id = '00000000-0000-0000-0000-000000000a01'$$,
  'recorder: DELETE station_check in closed month');
SELECT lives_ok(
  $$DELETE FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f3'$$,
  'recorder: DELETE visit in closed month');
RESET ROLE;

SELECT is((SELECT note FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'rec edit', 'recorder edit was applied');
SELECT is(
  (SELECT count(*)::int FROM audit_log
    WHERE changed_by = '00000000-0000-0000-0000-0000000000a3'
      AND table_name IN ('visits', 'station_checks')),
  5, 'every recorder edit in the closed month is in audit_log');
SELECT is(
  (SELECT old_data->>'note' FROM audit_log
    WHERE changed_by = '00000000-0000-0000-0000-0000000000a3'
      AND table_name = 'visits' AND action = 'update'),
  'orig', 'audit_log keeps the value before the edit');

-- ===== admin cannot touch service results (RLS) =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type) VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-09-21', 'routine')$$,
  '42501', NULL, 'admin: INSERT visit in closed month rejected');
UPDATE visits SET note = 'admin edit' WHERE id = '00000000-0000-0000-0000-0000000000f1';
RESET ROLE;
SELECT is((SELECT note FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'rec edit', 'admin: UPDATE visit affected 0 rows');

-- ===== anon (viewer) cannot write =====
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type) VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-09-22', 'routine')$$,
  '42501', NULL, 'anon: INSERT visit rejected');
RESET ROLE;

-- ===== host edits a closed month =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(
  $$UPDATE visits SET note = 'host edit' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  'host: UPDATE visit in closed month');
RESET ROLE;
SELECT is((SELECT note FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'host edit', 'host edit was applied');

SELECT * FROM finish();
ROLLBACK;
