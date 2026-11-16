-- M30 (20261115200000): ระยะสัญญาเป็นเดือน 1–36 + สัญญาสั้น / Custom (DECISIONS 2.53)
--   A. โครงสร้าง + สิทธิ์ · B. CHECK 1–36 + กระจก term_years (INSERT/UPDATE · ผู้เขียนแบบเดิม · ไม่ตรงกัน AG016)
--   C. วันจบอัตโนมัติชนปลายเดือน (เทียบสูตร M28 เดิมทุกวัน 2024–2031 สำหรับ 12/36 เดือน)
--   D. ตกบริการของสัญญาสั้น (list_pending / resolve / note ใช้ term_months)
--   E. กฎ 2 เดือน (M28) ใช้วันจบจริงของสัญญาสั้น + trigger ฟัง term_months
--   F. save_job_opening: p_term_months · ผู้เรียกแบบเดิม · AG016 / AG017 / 22004 / 23514
--   G. list_unlinked_renewals คืน term_months
-- ข้อมูลทั้งหมดเป็นข้อมูลสมมติ
BEGIN;
SELECT plan(75);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',  'user_a1', 'host',  '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'user_a2', 'admin', '{central}');

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.br() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.br() TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), pg_temp.br(), 'Term A'),
  (pg_temp.id('c2'), pg_temp.br(), 'Term Short'),
  (pg_temp.id('c3'), pg_temp.br(), 'Term Gap'),
  (pg_temp.id('c4'), pg_temp.br(), 'Term RPC');

-- =====================================================================
-- A. โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT col_type_is('public', 'contracts', 'term_months', 'smallint', 'contracts.term_months is smallint');
SELECT col_not_null('public', 'contracts', 'term_months', 'term_months is NOT NULL');
SELECT col_is_null('public', 'contracts', 'term_years', 'term_years is nullable (Custom = NULL)');
SELECT has_trigger('public', 'contracts', 'contracts_00_term_sync', 'term sync trigger exists');
SELECT ok((SELECT min(tgname) FROM pg_trigger
            WHERE tgrelid = 'public.contracts'::regclass AND NOT tgisinternal
              AND tgtype & 2 = 2) = 'contracts_00_term_sync',
  'term sync is the first BEFORE trigger on contracts (runs before the gap guard)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contracts_term_sync()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.contracts_term_sync()', 'EXECUTE'),
  'trigger function is not callable by users');
SELECT ok(NOT has_function_privilege('anon', 'public.contract_default_end_date(date, integer)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.contract_term_years_of(integer)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.contract_effective_end_date(date, date, integer)', 'EXECUTE'),
  'anon cannot call the term helpers');
SELECT ok(has_function_privilege('authenticated', 'public.contract_default_end_date(date, integer)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.renewal_gap_ok(date, date, integer, date)', 'EXECUTE'),
  'authenticated can call the pure helpers');
SELECT ok(has_function_privilege('authenticated',
    'public.save_job_opening(uuid, text, text, text, date, date, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text, integer, integer)',
    'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.save_job_opening(uuid, text, text, text, date, date, numeric, public.sale_type, uuid[], uuid, uuid, boolean, text, text, boolean, uuid, date, date, time, text, timestamptz, text, integer, integer)',
    'EXECUTE'),
  'save_job_opening (new signature): authenticated yes, anon no');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'save_job_opening' AND pronamespace = 'public'::regnamespace),
  1, 'exactly one save_job_opening (old signature dropped)');

-- =====================================================================
-- B. CHECK + กระจก (เขียนตรงด้วย postgres)
-- =====================================================================
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_months, value_total)
                   VALUES (pg_temp.id('c1'), 'T-0', '2026-01-01', 0, 1000)$$, '23514', NULL, 'term_months = 0 rejected');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_months, value_total)
                   VALUES (pg_temp.id('c1'), 'T-37', '2026-01-01', 37, 1000)$$, '23514', NULL, 'term_months = 37 rejected');
SELECT lives_ok($$INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total)
                  VALUES (pg_temp.id('b1'), pg_temp.id('c1'), 'T-24', '2026-01-01', 24, 50000)$$, 'term_months = 24 accepted (Custom)');
SELECT is((SELECT term_years FROM contracts WHERE id = pg_temp.id('b1')), NULL::smallint, '24 months → term_years NULL');
SELECT lives_ok($$INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total)
                  VALUES (pg_temp.id('b2'), pg_temp.id('c1'), 'T-12', '2026-01-01', 12, 50000)$$, 'term_months = 12 accepted');
SELECT is((SELECT term_years FROM contracts WHERE id = pg_temp.id('b2')), 1::smallint, '12 months → term_years 1');
SELECT lives_ok($$INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total)
                  VALUES (pg_temp.id('b3'), pg_temp.id('c1'), 'T-Y3', '2026-01-01', 3, 50000)$$, 'legacy writer: term_years only');
SELECT is((SELECT term_months FROM contracts WHERE id = pg_temp.id('b3')), 36::smallint, 'term_years 3 → term_months 36');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total)
                   VALUES (pg_temp.id('c1'), 'T-Y2', '2026-01-01', 2, 1000)$$, '23514', NULL, 'legacy term_years = 2 still rejected');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_months, term_years, value_total)
                   VALUES (pg_temp.id('c1'), 'T-X', '2026-01-01', 36, 1, 1000)$$, 'AG016', NULL, 'both sent and disagree → AG016');
SELECT lives_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_months, term_years, value_total)
                  VALUES (pg_temp.id('c1'), 'T-OK', '2026-01-01', 36, 3, 1000)$$, 'both sent and agree → ok');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, value_total)
                   VALUES (pg_temp.id('c1'), 'T-N', '2026-01-01', 1000)$$, '23502', NULL, 'no term at all → NOT NULL');

UPDATE contracts SET term_months = 5 WHERE id = pg_temp.id('b2');
SELECT is((SELECT term_years FROM contracts WHERE id = pg_temp.id('b2')), NULL::smallint, 'UPDATE months 12 → 5: term_years becomes NULL');
UPDATE contracts SET term_years = 3 WHERE id = pg_temp.id('b2');
SELECT is((SELECT term_months FROM contracts WHERE id = pg_temp.id('b2')), 36::smallint, 'UPDATE legacy term_years = 3: term_months becomes 36');
UPDATE contracts SET term_months = 12, term_years = 1 WHERE id = pg_temp.id('b2');
SELECT is((SELECT term_months FROM contracts WHERE id = pg_temp.id('b2')), 12::smallint, 'UPDATE both agreeing: ok');
SELECT throws_ok($$UPDATE contracts SET term_months = 24, term_years = 3 WHERE id = pg_temp.id('b2')$$, 'AG016', NULL,
  'UPDATE both changed and disagreeing → AG016');
-- term_years ส่งค่าเดิมซ้ำ (1 → 1) = ไม่ถือว่าเปลี่ยน → term_months ชนะ · term_years ตามเป็น NULL (ไม่ค้างค่าผิด)
UPDATE contracts SET term_months = 24, term_years = 1 WHERE id = pg_temp.id('b2');
SELECT is((SELECT term_months || '/' || coalesce(term_years::text, '-') FROM contracts WHERE id = pg_temp.id('b2')), '24/-',
  'UPDATE months with term_years unchanged: months wins, mirror follows');
SELECT throws_ok($$UPDATE contracts SET term_months = 37 WHERE id = pg_temp.id('b2')$$, '23514', NULL, 'UPDATE to 37 rejected');

-- =====================================================================
-- C. วันจบอัตโนมัติ (= lib/rules addMonthsMinusDay)
-- =====================================================================
SELECT is(contract_default_end_date('2026-01-15', 5),  '2026-06-14'::date, '15/01/2026 + 5 months → 14/06/2026');
SELECT is(contract_default_end_date('2026-04-03', 1),  '2026-05-02'::date, '03/04/2026 + 1 month → 02/05/2026');
SELECT is(contract_default_end_date('2026-01-01', 11), '2026-11-30'::date, '01/01/2026 + 11 months → 30/11/2026');
SELECT is(contract_default_end_date('2026-01-31', 1),  '2026-02-28'::date, '31/01 + 1 month → 28/02 (month-end clamp)');
SELECT is(contract_default_end_date('2026-01-29', 1),  '2026-02-28'::date, '29/01 + 1 month → 28/02');
SELECT is(contract_default_end_date('2026-01-28', 1),  '2026-02-27'::date, '28/01 + 1 month → 27/02');
SELECT is(contract_default_end_date('2026-03-31', 1),  '2026-04-30'::date, '31/03 + 1 month → 30/04');
SELECT is(contract_default_end_date('2028-01-31', 1),  '2028-02-29'::date, '31/01/2028 + 1 month → 29/02/2028 (leap)');
SELECT is(contract_default_end_date('2028-02-29', 12), '2029-02-28'::date, '29/02/2028 + 12 months → 28/02/2029');
SELECT is(contract_default_end_date('2028-02-29', 36), '2031-02-28'::date, '29/02/2028 + 36 months → 28/02/2031');
SELECT is(contract_default_end_date('2026-01-01', 36), '2028-12-31'::date, '01/01/2026 + 36 months → 31/12/2028');
-- 12 / 36 เดือน ≡ สูตรปีของ M28 (make_date(ปี + N, เดือน, 1) + (วัน − 1) − 1) ทุกวัน 2024–2031
SELECT is((SELECT count(*)::int
             FROM generate_series('2024-01-01'::date, '2031-12-31'::date, interval '1 day') g(d),
                  LATERAL (VALUES (1), (3)) y(n)
            WHERE contract_default_end_date(g.d::date, y.n * 12)
                  <> make_date(extract(year FROM g.d)::int + y.n, extract(month FROM g.d)::int, 1)
                     + (extract(day FROM g.d)::int - 1) - 1),
  0, '12/36 months give the same end date as the old year formula for every day 2024–2031');
-- ทุกวัน 2026–2028 × 1..36 เดือน เทียบสูตรอิสระ (เดือนปลายทาง t · วันสุดท้าย last):
--   วันเริ่ม > วันสุดท้ายของ t → last · วันที่ 1 → t − 1 วัน · อื่น → วันเดียวกันใน t − 1 วัน
SELECT is((SELECT count(*)::int
             FROM generate_series('2026-01-01'::date, '2028-12-31'::date, interval '1 day') g(d),
                  generate_series(1, 36) m(n),
                  LATERAL (SELECT (date_trunc('month', g.d) + make_interval(months => m.n))::date AS t) x,
                  LATERAL (SELECT (x.t + interval '1 month' - interval '1 day')::date AS last) y
            WHERE contract_default_end_date(g.d::date, m.n)
                  <> CASE WHEN extract(day FROM g.d) > extract(day FROM y.last) THEN y.last
                          WHEN extract(day FROM g.d) = 1 THEN x.t - 1
                          ELSE x.t + (extract(day FROM g.d)::int - 2) END),
  0, 'end date matches an independent month-end-clamp formula for every day 2026–2028 × 1..36 months');
-- ด่านลำดับ migration: ไม่มี function ไหนเหลือคิดเลขจาก term_years (เหลือได้เฉพาะตัวกระจก/ความเข้ากันได้)
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname)
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ 'term_years'
              AND p.proname NOT IN ('contracts_term_sync', 'save_job_opening', 'list_unlinked_renewals')),
  NULL::text[], 'no function still computes from term_years (migration order guard)');
SELECT is(contract_effective_end_date('2026-01-31', NULL, 1), '2026-02-28'::date, 'effective end: NULL end_date → default');
SELECT is(contract_effective_end_date('2026-01-31', '2026-03-10', 1), '2026-03-10'::date, 'effective end: end_date wins');
SELECT is(contract_term_years_of(12), 1::smallint, 'mirror 12 → 1');
SELECT is(contract_term_years_of(5), NULL::smallint, 'mirror 5 → NULL');

-- =====================================================================
-- D. ตกบริการของสัญญาสั้น (5 เดือน · เริ่ม 8 เดือนก่อน · ตั้งสถานีตั้งแต่วันเริ่ม)
-- =====================================================================
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at) VALUES
  (pg_temp.id('d1'), pg_temp.id('c2'), 'T-SHORT', pg_temp.m(-8) + 14, 5, 20000, pg_temp.m(-8) + 14);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

SELECT is((SELECT array_agg(missed_month ORDER BY missed_month) FROM list_pending_missed_services(NULL, NULL)
            WHERE contract_id = pg_temp.id('d1')),
  ARRAY[pg_temp.m(-8), pg_temp.m(-7), pg_temp.m(-6), pg_temp.m(-5), pg_temp.m(-4)],
  'short contract: exactly its 5 service months are pending (not 12)');
SELECT is((SELECT DISTINCT last_service_month FROM list_pending_missed_services(NULL, NULL)
            WHERE contract_id = pg_temp.id('d1')),
  pg_temp.m(-4), 'last service month = start + 5 − 1');
SELECT throws_ok(format('SELECT public.resolve_missed_service(%L::jsonb)',
                        jsonb_build_object('contract_id', pg_temp.id('d1'), 'missed_month', pg_temp.m(-3), 'reason', 'x')),
  'MS001', NULL, 'resolve: month after the short term ended is not a service month');
SELECT throws_ok(format('SELECT public.save_missed_service_note(%L::jsonb)',
                        jsonb_build_object('contract_id', pg_temp.id('d1'), 'missed_month', pg_temp.m(-3), 'note', 'x')),
  'MS001', NULL, 'note: month after the short term ended is rejected');
SELECT lives_ok(format('SELECT public.save_missed_service_note(%L::jsonb)',
                       jsonb_build_object('contract_id', pg_temp.id('d1'), 'missed_month', pg_temp.m(-4), 'note', 'x')),
  'note: last month of the short term is accepted');

-- =====================================================================
-- E. กฎ 2 เดือน (M28) กับสัญญาสั้น · trigger ฟัง term_months
-- =====================================================================
SELECT is(renewal_latest_start_month('2026-01-15', NULL, 5), '2026-08-01'::date,
  '5-month contract ends 14/06 → Renew allowed until Aug');
SELECT ok(renewal_gap_ok('2026-01-15', NULL, 5, '2026-08-31'), 'Renew starting 31/08 ok');
SELECT ok(NOT renewal_gap_ok('2026-01-15', NULL, 5, '2026-09-01'), 'Renew starting 01/09 → must be New');
RESET ROLE;

INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type) VALUES
  (pg_temp.id('e1'), pg_temp.id('c3'), 'T-OLD', '2026-01-01', 12, 24000, 'new');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type, renewed_from_contract_id) VALUES
  (pg_temp.id('e2'), pg_temp.id('c3'), 'T-REN', '2027-02-01', 12, 24000, 'renew', pg_temp.id('e1'));
-- New ที่เริ่มหลังวันจบจริงของสัญญาสั้น → สัญญาสั้นถูกแทน (โมฆะ)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type) VALUES
  (pg_temp.id('e3'), pg_temp.id('c2'), 'T-NEXT', pg_temp.m(-8) + 14 + interval '5 months', 12, 24000, 'new');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$UPDATE contracts SET term_months = 11 WHERE id = pg_temp.id('e1')$$, 'AG010', NULL,
  'old contract shortened via term_months only → linked Renew falls outside the window (trigger listens to term_months)');
SELECT throws_ok($$UPDATE contracts SET term_years = NULL, term_months = 11 WHERE id = pg_temp.id('e1')$$, 'AG010', NULL,
  'same via both columns');
SELECT ok(contract_is_renewed(pg_temp.id('d1')), 'New starting the day after the short term ends supersedes it');
SELECT is((SELECT count(*)::int FROM list_pending_missed_services(NULL, NULL) WHERE contract_id = pg_temp.id('d1')), 0,
  'superseded short contract: pending months are void');
RESET ROLE;
UPDATE contracts SET start_date = pg_temp.m(-8) + 14 + interval '5 months' - interval '1 day' WHERE id = pg_temp.id('e3');
SELECT ok(NOT contract_is_renewed(pg_temp.id('d1')), 'New starting on the short term''s last day does not supersede it');

-- =====================================================================
-- F. save_job_opening (admin)
-- =====================================================================
CREATE TEMP TABLE _r (tag text, contract_id uuid, updated_at timestamptz);
GRANT ALL ON _r TO PUBLIC;
CREATE FUNCTION pg_temp.sjo(p_tag text, p_months int, p_years int, p_contract text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$
  SELECT format($f$
    INSERT INTO _r SELECT %L, contract_id, updated_at FROM public.save_job_opening(
      p_branch_id := pg_temp.br(), p_customer_name := 'Term RPC', p_customer_type := NULL,
      p_contract_no := %L, p_start_date := '2026-03-01', p_end_date := NULL, p_value_total := 50000,
      p_sale_type := 'new', p_customer_id := pg_temp.id('c4'), p_term_months := %L, p_term_years := %L,
      p_contract_id := %L, p_expected_updated_at := %L)
  $f$, p_tag, 'S-' || coalesce(p_contract, p_tag), p_months, p_years,
       (SELECT contract_id FROM _r WHERE tag = p_contract),
       (SELECT updated_at FROM _r WHERE tag = p_contract ORDER BY updated_at DESC LIMIT 1))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sjo(text, int, int, text) TO PUBLIC;
CREATE FUNCTION pg_temp.term(p_tag text) RETURNS text LANGUAGE sql AS
  $$ SELECT c.term_months || '/' || coalesce(c.term_years::text, '-') FROM contracts c
      WHERE c.id = (SELECT contract_id FROM _r WHERE tag = p_tag LIMIT 1) $$;
GRANT EXECUTE ON FUNCTION pg_temp.term(text) TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok(pg_temp.sjo('f1', 5, NULL), 'RPC: new 5-month contract');
SELECT is(pg_temp.term('f1'), '5/-', 'stored as 5 months, term_years NULL');
SELECT lives_ok(pg_temp.sjo('f2', NULL, 1), 'RPC legacy payload: p_term_years only');
SELECT is(pg_temp.term('f2'), '12/1', 'legacy p_term_years 1 → 12 months');
SELECT lives_ok(pg_temp.sjo('f3', 36, 3), 'RPC: both sent and agree');
SELECT throws_ok(pg_temp.sjo('f4', 24, 1), 'AG016', NULL, 'RPC: both sent and disagree → AG016');
SELECT throws_ok(pg_temp.sjo('f5', NULL, NULL), '22004', NULL, 'RPC: no term → 22004');
SELECT throws_ok(pg_temp.sjo('f6', NULL, 2), '23514', NULL, 'RPC: legacy p_term_years 2 → 23514');
SELECT throws_ok(pg_temp.sjo('f7', 37, NULL), '23514', NULL, 'RPC: 37 months → 23514');
-- แก้สัญญา Custom ด้วย payload แบบเดิม (ส่งแต่ปี) → AG017 (กัน 5 เดือนกลายเป็น 12 เงียบๆ)
SELECT throws_ok(pg_temp.sjo('f1e', NULL, 1, 'f1'), 'AG017', NULL, 'edit Custom contract with years-only payload → AG017');
SELECT is(pg_temp.term('f1'), '5/-', 'and the term is unchanged');
SELECT lives_ok(pg_temp.sjo('f1', 24, NULL, 'f1'), 'edit Custom contract with p_term_months → ok');
SELECT is(pg_temp.term('f1'), '24/-', 'term updated to 24 months');
SELECT lives_ok(pg_temp.sjo('f2', NULL, 3, 'f2'), 'edit standard contract with legacy years-only payload still works');
SELECT is(pg_temp.term('f2'), '36/3', 'legacy edit 1 → 3 years');
RESET ROLE;

-- =====================================================================
-- G. list_unlinked_renewals คืน term_months
-- =====================================================================
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type, renew_unlinked_reason) VALUES
  (pg_temp.id('9a'), pg_temp.id('c1'), 'T-UNL', '2026-05-01', 9, 18000, 'renew', 'old contract not in system');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT is((SELECT term_months || '/' || coalesce(term_years::text, '-') FROM list_unlinked_renewals(NULL)
            WHERE contract_id = pg_temp.id('9a')), '9/-', 'unlinked renewals list returns term_months (term_years NULL)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
