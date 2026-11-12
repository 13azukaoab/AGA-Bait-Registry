-- M12 (20261112140000): ล็อกสัญญาปิด/ยกเลิก ยกเว้น host (DECISIONS 3.11) + กันเขียนทับพร้อมกัน (3.12)
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(24);

-- ---------- โครงสร้าง ----------
SELECT has_trigger('public', 'contracts', 'contracts_set_updated_at', 'contracts.updated_at is maintained by a trigger');
SELECT has_trigger('public', 'contracts', 'contracts_closed_guard', 'closed/cancelled contracts are guarded');
SELECT has_trigger('public', 'contract_teams', 'contract_teams_closed_guard', 'teams of closed/cancelled contracts are guarded');
SELECT ok((SELECT 'p_expected_updated_at' = ANY (proargnames) FROM pg_proc WHERE proname = 'save_job_opening'),
  'save_job_opening takes p_expected_updated_at');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'save_job_opening'), 1,
  'only one save_job_opening exists (old signature dropped)');
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon still cannot call save_job_opening')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'save_job_opening';

-- ---------- seed ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',  'user_a1', 'host',  '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'user_a2', 'admin', '{central}');
CREATE TEMP TABLE _s AS
  SELECT (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1) AS br,
         (SELECT id FROM teams WHERE code = 'A') AS team_a,
         (SELECT id FROM teams WHERE code = 'B') AS team_b;
GRANT SELECT ON _s TO PUBLIC;
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT br FROM _s), 'ลูกค้า ล็อก');
INSERT INTO contracts (id, customer_id, contract_no, start_date, end_date, term_years, value_total, sale_type, status) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'L-ACTIVE', '2026-01-15', '2027-01-14', 1, 50000, 'new', 'active'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'L-CLOSED', '2025-01-15', '2026-01-14', 1, 50000, 'new', 'closed'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'L-CANCEL', '2026-01-15', '2027-01-14', 1, 50000, 'new', 'cancelled');
INSERT INTO contract_teams (contract_id, team_id) VALUES
  ('00000000-0000-0000-0000-0000000000d3', (SELECT team_a FROM _s));
INSERT INTO stations (id, contract_id, type, code) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'IG', '1');

-- เรียก RPC โหมดแก้ด้วยเวลาที่กำหนด (ค่าอื่นคงเดิม)
CREATE FUNCTION pg_temp.edit(p_contract uuid, p_no text, p_value numeric, p_expected timestamptz)
RETURNS TABLE (contract_id uuid, updated_at timestamptz) LANGUAGE sql AS $$
  SELECT r.contract_id, r.updated_at FROM public.save_job_opening(
    p_contract_id := p_contract, p_branch_id := (SELECT br FROM _s), p_customer_name := 'x',
    p_customer_type := 'house', p_contract_no := p_no, p_start_date := '2026-01-15',
    p_end_date := '2027-01-14', p_term_years := 1, p_value_total := p_value, p_sale_type := 'new',
    p_team_ids := ARRAY[(SELECT team_a FROM _s)], p_expected_updated_at := p_expected) r
$$;
GRANT EXECUTE ON FUNCTION pg_temp.edit(uuid, text, numeric, timestamptz) TO PUBLIC;
CREATE TEMP TABLE _v (k text PRIMARY KEY, ts timestamptz);
GRANT ALL ON _v TO PUBLIC;
INSERT INTO _v SELECT 'active0', updated_at FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d1';

-- ---------- updated_at ขยับทุกครั้ง ----------
UPDATE contracts SET note = 'แก้ตรง' WHERE id = '00000000-0000-0000-0000-0000000000d1';
SELECT ok((SELECT updated_at FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d1')
          > (SELECT ts FROM _v WHERE k = 'active0'),
  'any update moves contracts.updated_at forward');
INSERT INTO _v SELECT 'active1', updated_at FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d1';

-- ---------- admin ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

SELECT throws_ok($$SELECT * FROM pg_temp.edit('00000000-0000-0000-0000-0000000000d1', 'L-ACTIVE', 51000, NULL)$$,
  '22004', NULL, 'editing without the last-seen time is refused (screen bug)');
SELECT throws_ok($$SELECT * FROM pg_temp.edit('00000000-0000-0000-0000-0000000000d1', 'L-ACTIVE', 51000,
                     (SELECT ts FROM _v WHERE k = 'active0'))$$,
  'AG008', NULL, 'a stale last-seen time is refused: someone edited first (AG008)');
SELECT lives_ok($$INSERT INTO _v SELECT 'active2', updated_at FROM pg_temp.edit('00000000-0000-0000-0000-0000000000d1',
                    'L-ACTIVE', 51000, (SELECT ts FROM _v WHERE k = 'active1'))$$,
  'admin edits with the current last-seen time');
SELECT ok((SELECT ts FROM _v WHERE k = 'active2') > (SELECT ts FROM _v WHERE k = 'active1'),
  'the RPC returns the new updated_at for the next edit');
SELECT lives_ok($$SELECT * FROM pg_temp.edit('00000000-0000-0000-0000-0000000000d1', 'L-ACTIVE', 51500,
                    date_trunc('milliseconds', (SELECT ts FROM _v WHERE k = 'active2')))$$,
  'a last-seen time cut to milliseconds (JavaScript Date) is still accepted');
SELECT throws_ok($$SELECT * FROM pg_temp.edit('00000000-0000-0000-0000-0000000000d1', 'L-ACTIVE', 52000,
                     (SELECT ts FROM _v WHERE k = 'active1'))$$,
  'AG008', NULL, 'a second edit with the old time is refused (no silent overwrite)');

SELECT throws_ok($$SELECT * FROM pg_temp.edit('00000000-0000-0000-0000-0000000000d2', 'L-CLOSED', 1,
                     (SELECT updated_at FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'))$$,
  'AG007', NULL, 'admin cannot edit a closed contract through the RPC (AG007)');
SELECT throws_ok($$UPDATE contracts SET value_total = 1 WHERE id = '00000000-0000-0000-0000-0000000000d3'$$,
  'AG007', NULL, 'admin cannot edit a cancelled contract directly (AG007)');
SELECT throws_ok($$INSERT INTO contract_teams (contract_id, team_id)
                   SELECT '00000000-0000-0000-0000-0000000000d3'::uuid, team_b FROM _s$$,
  'AG007', NULL, 'admin cannot add a team to a cancelled contract');
SELECT throws_ok($$DELETE FROM contract_teams WHERE contract_id = '00000000-0000-0000-0000-0000000000d3'$$,
  'AG007', NULL, 'admin cannot remove a team from a cancelled contract');
SELECT throws_ok($$UPDATE stations SET contract_id = '00000000-0000-0000-0000-0000000000d2'
                   WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '42501', NULL, 'admin cannot move a station to another contract directly');
SELECT lives_ok($$UPDATE contracts SET status = 'cancelled', cancelled_at = now()
                  WHERE id = '00000000-0000-0000-0000-0000000000d1'$$,
  'admin may still cancel an active contract (lock applies once it is cancelled)');

-- ---------- host แก้ได้ ----------
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$SELECT * FROM pg_temp.edit('00000000-0000-0000-0000-0000000000d2', 'L-CLOSED', 49000,
                    (SELECT updated_at FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'))$$,
  'host can fix a closed contract');
SELECT lives_ok($$INSERT INTO contract_teams (contract_id, team_id)
                  SELECT '00000000-0000-0000-0000-0000000000d3'::uuid, team_b FROM _s$$,
  'host can change teams of a cancelled contract');
RESET ROLE;

SELECT has_trigger('public', 'stations', 'stations_contract_move_guard', 'direct station moves between contracts are blocked');
SELECT is((SELECT value_total FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'), 49000.00::numeric,
  'host edit saved');
SELECT ok((SELECT count(*) FROM audit_log WHERE table_name = 'contracts' AND action = 'update'
             AND contract_id = '00000000-0000-0000-0000-0000000000d2') >= 1,
  'host edits of a closed contract are audited');

SELECT * FROM finish();
ROLLBACK;
