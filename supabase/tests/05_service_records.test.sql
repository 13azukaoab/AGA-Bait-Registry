-- visits, station_checks, set_follow_up_no trigger (Task 6)
BEGIN;
SELECT plan(11);

SELECT has_table('public', 'visits', 'visits exists');
SELECT has_table('public', 'station_checks', 'station_checks exists');
SELECT has_trigger('public', 'station_checks', 'set_follow_up_no', 'trigger exists');
SELECT col_is_null('public', 'station_checks', 'termite_caste', 'termite_caste nullable');

-- Fixtures: one contract, stations A/B/C, visits on several dates
INSERT INTO public.customers (branch_id, name, customer_type)
SELECT b.id, 'T6 customer', ct.code FROM public.branches b, public.customer_types ct LIMIT 1;
INSERT INTO public.contracts (customer_id, contract_no, start_date, term_years, value_total)
SELECT id, 'T6-001', '2026-01-15', 1, 50000 FROM public.customers WHERE name = 'T6 customer';
INSERT INTO public.stations (contract_id, code, type)
SELECT c.id, s.code, 'IG' FROM public.contracts c, (VALUES ('A'), ('B'), ('C')) s(code)
WHERE c.contract_no = 'T6-001';
INSERT INTO public.visits (contract_id, visit_date, visit_type, start_time, end_time)
SELECT c.id, v.d::date, 'routine', '09:00'::time, '10:00'::time
FROM public.contracts c, (VALUES ('2026-01-20'), ('2026-03-10'), ('2026-05-12'), ('2026-06-01')) v(d)
WHERE c.contract_no = 'T6-001';

CREATE FUNCTION pg_temp.chk(p_station text, p_date date, p_follow int DEFAULT NULL, p_g int DEFAULT 0)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.station_checks (visit_id, station_id, follow_up_no, bait_added_g)
  SELECT v.id, s.id, p_follow, p_g
  FROM public.visits v JOIN public.contracts c ON c.id = v.contract_id
  JOIN public.stations s ON s.contract_id = c.id
  WHERE c.contract_no = 'T6-001' AND s.code = p_station AND v.visit_date = p_date;
$$;

CREATE FUNCTION pg_temp.fno(p_station text, p_date date) RETURNS int LANGUAGE sql AS $$
  SELECT sc.follow_up_no FROM public.station_checks sc
  JOIN public.visits v ON v.id = sc.visit_id
  JOIN public.stations s ON s.id = sc.station_id
  JOIN public.contracts c ON c.id = s.contract_id
  WHERE c.contract_no = 'T6-001' AND s.code = p_station AND v.visit_date = p_date;
$$;

-- Case 1: station C checked on two dates -> F1 then F2 (date order)
SELECT pg_temp.chk('C', '2026-01-20');
SELECT pg_temp.chk('C', '2026-03-10');
SELECT is(pg_temp.fno('C', '2026-01-20'), 1, 'station C first check = F1');
SELECT is(pg_temp.fno('C', '2026-03-10'), 2, 'station C second check = F2');

-- Case 2 (SPEC 15.6): A first checked Jan, B first checked Mar, both checked in May
SELECT pg_temp.chk('A', '2026-01-20');
SELECT pg_temp.chk('B', '2026-03-10');
SELECT pg_temp.chk('A', '2026-05-12');
SELECT pg_temp.chk('B', '2026-05-12');
SELECT is(pg_temp.fno('B', '2026-03-10'), 1, 'B starts at F1 (not affected by A or C)');
SELECT is(pg_temp.fno('A', '2026-05-12') || '/' || pg_temp.fno('B', '2026-05-12'), '2/2',
          'May: A and B each counted independently (A=F2, B=F2)');

-- Case 3: client-supplied follow_up_no = 99 is overwritten by the trigger
SELECT pg_temp.chk('A', '2026-06-01', 99);
SELECT is(pg_temp.fno('A', '2026-06-01'), 3, 'explicit follow_up_no=99 overwritten with computed F3');

-- Case 4: bait_added_g must be a multiple of 50
SELECT throws_ok($$ SELECT pg_temp.chk('B', '2026-06-01', NULL, 75) $$, '23514', NULL,
                 'bait_added_g = 75 rejected');
SELECT lives_ok($$ SELECT pg_temp.chk('B', '2026-06-01', NULL, 50) $$, 'bait_added_g = 50 accepted');

SELECT * FROM finish();
ROLLBACK;
