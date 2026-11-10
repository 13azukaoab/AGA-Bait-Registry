-- Month lock trigger (Task 10) - SPEC §7.7, §15.3
BEGIN;
SELECT plan(13);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'recorder', '{central,province}');

INSERT INTO customers (id, branch_id, name)
  VALUES ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches LIMIT 1), 'Cust');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'T-1', '2026-01-15', 1, 50000);
INSERT INTO stations (id, contract_id, code, type)
  VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'S-01', 'IG');
-- Sep visit (will be closed), Oct visit (stays open) - seeded before closing
INSERT INTO visits (id, contract_id, visit_date, visit_type, note) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-09-10', 'routine', 'orig'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', '2026-10-10', 'routine', 'orig');
INSERT INTO station_checks (id, visit_id, station_id)
  VALUES ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1');

INSERT INTO month_closures (month_key, closed_at) VALUES ('2026-09', now());

SELECT is_definer('public', 'block_closed_month', ARRAY[]::text[], 'block_closed_month is security definer');

-- ===== recorder (non-host) on a CLOSED month =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);

SELECT throws_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type) VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-09-20', 'routine')$$,
  'P0001', NULL, 'closed month: INSERT visit rejected');
SELECT throws_ok(
  $$UPDATE visits SET note = 'x' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  'P0001', NULL, 'closed month: UPDATE visit rejected');
SELECT throws_ok(
  $$DELETE FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  'P0001', NULL, 'closed month: DELETE visit rejected');
SELECT throws_ok(
  $$UPDATE visits SET visit_date = '2026-09-25' WHERE id = '00000000-0000-0000-0000-0000000000f2'$$,
  'P0001', NULL, 'cannot move an open-month visit into a closed month');
SELECT throws_ok(
  $$INSERT INTO station_checks (visit_id, station_id) VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1')$$,
  'P0001', NULL, 'closed month: INSERT station_check rejected');
SELECT throws_ok(
  $$UPDATE station_checks SET note = 'x' WHERE id = '00000000-0000-0000-0000-000000000a01'$$,
  'P0001', NULL, 'closed month: UPDATE station_check rejected');
SELECT throws_ok(
  $$DELETE FROM station_checks WHERE id = '00000000-0000-0000-0000-000000000a01'$$,
  'P0001', NULL, 'closed month: DELETE station_check rejected');

-- ===== not-closed month =====
SELECT lives_ok(
  $$UPDATE visits SET note = 'edited' WHERE id = '00000000-0000-0000-0000-0000000000f2'$$,
  'open month: UPDATE visit allowed');
SELECT lives_ok(
  $$INSERT INTO visits (contract_id, visit_date, visit_type) VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-11-05', 'routine')$$,
  'open month: INSERT visit allowed');
RESET ROLE;

-- ===== host may edit a closed month =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(
  $$UPDATE visits SET note = 'host edit' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  'host: UPDATE in closed month allowed');
RESET ROLE;
SELECT is((SELECT note FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'host edit', 'host edit was applied');

-- ===== reopen -> recorder can edit again =====
UPDATE month_closures SET reopened_at = now() WHERE month_key = '2026-09';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(
  $$UPDATE visits SET note = 'after reopen' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
  'reopened month: UPDATE visit allowed again');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
