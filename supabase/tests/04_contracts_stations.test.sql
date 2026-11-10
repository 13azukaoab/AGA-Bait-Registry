-- contracts, contract_teams, stations (Task 5)
BEGIN;
SELECT plan(29);

SELECT has_table('public', 'contracts', 'contracts exists');
SELECT has_table('public', 'contract_teams', 'contract_teams exists');
SELECT has_table('public', 'stations', 'stations exists');

SELECT col_is_pk('public', 'contracts', 'id', 'contracts.id is PK');
SELECT col_type_is('public', 'contracts', 'term_years', 'smallint', 'contracts.term_years type');
SELECT col_type_is('public', 'contracts', 'value_total', 'numeric(12,2)', 'contracts.value_total type');
SELECT col_type_is('public', 'contracts', 'status', 'public', 'contract_status', 'contracts.status is contract_status');
SELECT col_type_is('public', 'contracts', 'sale_type', 'public', 'sale_type', 'contracts.sale_type is sale_type');
SELECT col_not_null('public', 'contracts', 'customer_id', 'contracts.customer_id NOT NULL');
SELECT col_not_null('public', 'contracts', 'contract_no', 'contracts.contract_no NOT NULL');
SELECT col_is_unique('public', 'contracts', 'contract_no', 'contract_no UNIQUE');
SELECT fk_ok('public', 'contracts', 'customer_id', 'public', 'customers', 'id', 'FK ok');
SELECT col_has_default('public', 'contracts', 'status', 'contracts.status default active');

SELECT col_is_pk('public', 'contract_teams', ARRAY['contract_id', 'team_id'], 'PK is (contract_id, team_id)');
SELECT fk_ok('public', 'contract_teams', 'contract_id', 'public', 'contracts', 'id', 'FK ok');
SELECT fk_ok('public', 'contract_teams', 'team_id', 'public', 'teams', 'id', 'FK ok');

SELECT col_is_pk('public', 'stations', 'id', 'stations.id is PK');
SELECT fk_ok('public', 'stations', 'contract_id', 'public', 'contracts', 'id', 'FK ok');
SELECT col_type_is('public', 'stations', 'type', 'public', 'station_type', 'stations.type is station_type');
SELECT col_type_is('public', 'stations', 'status', 'public', 'station_status', 'stations.status is station_status');
SELECT col_not_null('public', 'stations', 'type', 'stations.type NOT NULL');
SELECT col_has_default('public', 'stations', 'status', 'stations.status default active');

-- Fixtures
INSERT INTO public.customers (branch_id, name, customer_type)
SELECT b.id, 'T5 customer', ct.code
FROM public.branches b, public.customer_types ct LIMIT 1;

INSERT INTO public.contracts (customer_id, contract_no, start_date, term_years, value_total)
SELECT id, 'T5-001', '2026-01-15', 1, 50000 FROM public.customers WHERE name = 'T5 customer';

SELECT throws_ok(
  $$ INSERT INTO public.contracts (customer_id, contract_no, start_date, term_years, value_total)
     SELECT id, 'T5-002', '2026-01-15', 2, 50000 FROM public.customers WHERE name = 'T5 customer' $$,
  '23514', NULL, 'term_years=2 rejected');

SELECT lives_ok(
  $$ INSERT INTO public.contracts (customer_id, contract_no, start_date, term_years, value_total)
     SELECT id, 'T5-003', '2026-01-15', 3, 50000 FROM public.customers WHERE name = 'T5 customer' $$,
  'term_years=3 accepted');

SELECT throws_ok(
  $$ INSERT INTO public.contracts (customer_id, contract_no, start_date, term_years, value_total)
     SELECT id, 'T5-001', '2026-02-01', 1, 1000 FROM public.customers WHERE name = 'T5 customer' $$,
  '23505', NULL, 'duplicate contract_no rejected');

-- many-to-many: one contract, two teams; same pair twice fails
INSERT INTO public.contract_teams (contract_id, team_id)
SELECT c.id, t.id FROM public.contracts c, (SELECT id FROM public.teams LIMIT 2) t
WHERE c.contract_no = 'T5-001';

SELECT is((SELECT count(*)::int FROM public.contract_teams ct
           JOIN public.contracts c ON c.id = ct.contract_id WHERE c.contract_no = 'T5-001'),
          (SELECT least(2, count(*))::int FROM public.teams), 'contract has multiple teams');

SELECT throws_ok(
  $$ INSERT INTO public.contract_teams (contract_id, team_id)
     SELECT c.id, (SELECT id FROM public.teams LIMIT 1) FROM public.contracts c WHERE c.contract_no = 'T5-001' $$,
  '23505', NULL, 'duplicate (contract, team) pair rejected');

-- RESTRICT: station blocks contract delete; contract blocks customer delete
INSERT INTO public.stations (contract_id, type)
SELECT id, 'IG' FROM public.contracts WHERE contract_no = 'T5-001';

SELECT throws_ok(
  $$ DELETE FROM public.contracts WHERE contract_no = 'T5-001' $$,
  '23503', NULL, 'contract with stations cannot be deleted');

SELECT throws_ok(
  $$ DELETE FROM public.customers WHERE name = 'T5 customer' $$,
  '23503', NULL, 'customer with contracts cannot be deleted');

SELECT * FROM finish();
ROLLBACK;
