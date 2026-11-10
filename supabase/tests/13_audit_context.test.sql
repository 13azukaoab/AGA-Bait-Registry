-- audit_log context columns: branch_id, contract_id, month_key (แผนงาน C3, SPEC §7.7 "แก้หลังปิด")
BEGIN;
SELECT plan(23);

SELECT col_type_is('public', 'audit_log', 'branch_id', 'uuid', 'branch_id uuid');
SELECT col_type_is('public', 'audit_log', 'contract_id', 'uuid', 'contract_id uuid');
SELECT col_type_is('public', 'audit_log', 'month_key', 'text', 'month_key text');
SELECT has_index('public', 'audit_log', 'audit_log_branch_changed_idx', 'index on (branch_id, changed_at)');
SELECT has_index('public', 'audit_log', 'audit_log_contract_changed_idx', 'index on (contract_id, changed_at)');
SELECT has_index('public', 'audit_log', 'audit_log_month_changed_idx', 'index on (month_key, changed_at)');
SELECT has_trigger('public', 'month_closures', 'audit_month_closures', 'month_closures audited (who closed / re-synced)');
SELECT has_trigger('public', 'monthly_branch_snapshots', 'audit_snapshots_manual_write', 'manual snapshot rows audited (§6.5)');

-- month key normalisation (snapshots may carry the Dashboard key 'MMM.YY')
SELECT is(public.normalize_month_key('SEP.26'), '2026-09', 'MMM.YY -> YYYY-MM');
SELECT is(public.normalize_month_key('sep.26'), '2026-09', 'lower-case MMM.YY -> YYYY-MM');
SELECT is(public.normalize_month_key('2026-09'), '2026-09', 'YYYY-MM unchanged');

-- ---------- seed (as postgres; auth.uid() via jwt claim) ----------
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000a1');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

CREATE TEMP TABLE _b AS
  SELECT (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1) AS cen_id,
         (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1) AS prov_id;

INSERT INTO customers (id, branch_id, name)
  SELECT '00000000-0000-0000-0000-0000000000c1', cen_id, 'Audit Ctx' FROM _b;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'T-AUD-1', '2026-01-15', 1, 50000);
INSERT INTO contract_teams (contract_id, team_id)
  SELECT '00000000-0000-0000-0000-0000000000d1', id FROM teams LIMIT 1;
INSERT INTO stations (id, contract_id, code, type)
  VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'S-01', 'IG');
INSERT INTO visits (id, contract_id, visit_date, visit_type)
  VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-09-10', 'routine');
INSERT INTO station_checks (id, visit_id, station_id)
  VALUES ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1');
UPDATE visits SET visit_date = '2026-10-02' WHERE id = '00000000-0000-0000-0000-0000000000f1';
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, cust) SELECT 'SEP.26', prov_id, 'manual', 3 FROM _b;
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, cust) SELECT 'SEP.26', cen_id, 'computed', 1 FROM _b;
INSERT INTO month_closures (month_key, scope) VALUES ('2026-09', 'central');

-- ---------- context filled per table ----------
SELECT is((SELECT branch_id FROM audit_log WHERE table_name = 'customers' AND action = 'insert'),
  (SELECT cen_id FROM _b), 'customers: branch_id');
SELECT is((SELECT ROW(contract_id, branch_id)::text FROM audit_log WHERE table_name = 'contracts' AND action = 'insert'),
  (SELECT ROW('00000000-0000-0000-0000-0000000000d1'::uuid, cen_id)::text FROM _b), 'contracts: contract_id + branch_id');
SELECT is((SELECT ROW(contract_id, branch_id)::text FROM audit_log WHERE table_name = 'contract_teams'),
  (SELECT ROW('00000000-0000-0000-0000-0000000000d1'::uuid, cen_id)::text FROM _b), 'contract_teams: contract_id + branch_id');
SELECT is((SELECT ROW(contract_id, branch_id)::text FROM audit_log WHERE table_name = 'stations'),
  (SELECT ROW('00000000-0000-0000-0000-0000000000d1'::uuid, cen_id)::text FROM _b), 'stations: contract_id + branch_id');
SELECT is((SELECT ROW(contract_id, branch_id, month_key)::text FROM audit_log WHERE table_name = 'visits' AND action = 'insert'),
  (SELECT ROW('00000000-0000-0000-0000-0000000000d1'::uuid, cen_id, '2026-09')::text FROM _b), 'visits: contract, branch, month');
SELECT is((SELECT ROW(contract_id, branch_id, month_key)::text FROM audit_log WHERE table_name = 'station_checks'),
  (SELECT ROW('00000000-0000-0000-0000-0000000000d1'::uuid, cen_id, '2026-09')::text FROM _b), 'station_checks: contract, branch, month of the visit');
SELECT is((SELECT month_key FROM audit_log WHERE table_name = 'visits' AND action = 'update'),
  '2026-10', 'visit moved to another month: month_key = new month');
SELECT is((SELECT ROW(branch_id, month_key)::text FROM audit_log WHERE table_name = 'monthly_branch_snapshots'),
  (SELECT ROW(prov_id, '2026-09')::text FROM _b), 'manual snapshot: branch + normalised month');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'monthly_branch_snapshots'),
  1, 'computed snapshot rows are not audited');
SELECT is((SELECT ROW(month_key, changed_by)::text FROM audit_log WHERE table_name = 'month_closures'),
  ROW('2026-09', '00000000-0000-0000-0000-0000000000a1'::uuid)::text, 'month_closures: month + who closed');

-- "edits after close" style lookup
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE month_key = '2026-09' AND contract_id = '00000000-0000-0000-0000-0000000000d1'),
  2, 'search by month + contract');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE branch_id = (SELECT cen_id FROM _b) AND table_name IN ('visits', 'station_checks')),
  3, 'search by branch');

SELECT * FROM finish();
ROLLBACK;
