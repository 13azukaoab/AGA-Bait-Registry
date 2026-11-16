-- M28 (20261115180000): กฎช่องว่าง 2 เดือน Renew / New (DECISIONS 2.51)
--   * ตัวช่วย: contract_effective_end_date · renewal_latest_start_month · renewal_gap_ok
--   * save_job_opening + trigger contracts_renewed_gap_guard: AG010 (เกินช่วง / เริ่มไม่หลังสัญญาเก่า) · AG011 (ผูกแต่ไม่ใช่ renew)
--     ทั้ง INSERT / UPDATE ผ่าน REST · ฝั่งสัญญาเก่าแก้วันที่ · ข้อมูลเก่า (postgres) ไม่ติด
--   * New ย้ายสถานีไม่ได้ (initialize_contract_stations → SV008)
--   * โมฆะ: contract_is_renewed = Renew ผูกมา หรือ New ของลูกค้าเดียวกันที่เริ่มหลังสัญญานี้จบ · ยกเลิกแล้วไม่นับ
-- ชุดกฎวันที่ใช้วันที่ตายตัว (ไม่ขึ้นกับวันนี้) · ชุดโมฆะใช้ pg_temp.m(n) = เดือนปัจจุบัน + n (Asia/Bangkok)
BEGIN;
SELECT plan(115);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}');

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.td() RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.td() TO PUBLIC;
CREATE FUNCTION pg_temp.br() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.br() TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), pg_temp.br(), 'Gap'),
  (pg_temp.id('c2'), pg_temp.br(), 'Void New'),
  (pg_temp.id('c3'), pg_temp.br(), 'Void Renew'),
  (pg_temp.id('c4'), pg_temp.br(), 'Two sites'),
  (pg_temp.id('c5'), pg_temp.br(), 'Other');

-- ---------- สัญญาเก่าของชุดกฎวันที่ (ลูกค้า c1) ----------
INSERT INTO contracts (id, customer_id, contract_no, start_date, end_date, term_years, value_total, sale_type) VALUES
  (pg_temp.id('01'), pg_temp.id('c1'), 'G-01', '2026-01-01', '2026-12-31', 1, 24000, 'new'),
  (pg_temp.id('02'), pg_temp.id('c1'), 'G-02', '2026-01-01', '2026-12-31', 1, 24000, 'new'),
  (pg_temp.id('03'), pg_temp.id('c1'), 'G-03', '2026-01-01', '2026-12-31', 1, 24000, 'new'),
  (pg_temp.id('04'), pg_temp.id('c1'), 'G-04', '2026-01-15', NULL,         1, 24000, 'new');

CREATE TEMP TABLE _r (tag text, contract_id uuid, updated_at timestamptz);
GRANT ALL ON _r TO PUBLIC;
-- เปิดงาน Renew ของลูกค้า c1 ผ่าน save_job_opening
CREATE FUNCTION pg_temp.renew(p_tag text, p_from text, p_start date, p_sale text DEFAULT 'renew') RETURNS text
LANGUAGE sql AS $$
  SELECT format($f$
    INSERT INTO _r SELECT %L, contract_id, updated_at FROM public.save_job_opening(
      p_branch_id := pg_temp.br(), p_customer_name := 'Gap', p_customer_type := NULL,
      p_contract_no := %L, p_start_date := %L, p_end_date := NULL, p_term_years := 1, p_value_total := 24000,
      p_sale_type := %L, p_customer_id := pg_temp.id('c1'), p_renewed_from_contract_id := %L)
  $f$, p_tag, 'R-' || p_tag, p_start, p_sale, pg_temp.id(p_from))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.renew(text, text, date, text) TO PUBLIC;
CREATE FUNCTION pg_temp.rid(p_tag text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT contract_id FROM _r WHERE tag = p_tag $$;
GRANT EXECUTE ON FUNCTION pg_temp.rid(text) TO PUBLIC;

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_trigger('public', 'contracts', 'contracts_renewed_gap_guard', 'gap guard trigger exists on contracts');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contracts_renewed_gap_guard()', 'EXECUTE'),
  'guard function is not callable by authenticated directly');
SELECT ok(NOT has_function_privilege('anon', 'public.renewal_gap_ok(date, date, integer, date)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.contract_effective_end_date(date, date, integer)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.renewal_latest_start_month(date, date, integer)', 'EXECUTE'),
  'anon cannot call the helpers');
SELECT ok(has_function_privilege('authenticated', 'public.renewal_gap_ok(date, date, integer, date)', 'EXECUTE'),
  'authenticated can call renewal_gap_ok (pure, reads no table)');

-- =====================================================================
-- ตัวช่วย (ตรงกับ lib/rules/renewalGap.ts)
-- =====================================================================
SELECT ok(renewal_gap_ok('2026-01-01', '2026-12-31', 1, '2027-01-01'), 'end 31 Dec → start Jan is Renew');
SELECT ok(renewal_gap_ok('2026-01-01', '2026-12-31', 1, '2027-02-28'), 'end 31 Dec → start end of Feb is Renew');
SELECT ok(NOT renewal_gap_ok('2026-01-01', '2026-12-31', 1, '2027-03-01'), 'end 31 Dec → start 1 Mar must be New');
SELECT is(contract_effective_end_date('2026-01-15', NULL, 1), '2027-01-14'::date, 'no end_date → start + 1 year − 1 day');
SELECT ok(renewal_gap_ok('2026-01-15', NULL, 1, '2027-03-31') AND NOT renewal_gap_ok('2026-01-15', NULL, 1, '2027-04-01'),
  'mid-month end (14 Jan) → Renew allowed through Mar, not Apr');
SELECT is(contract_effective_end_date('2024-02-29', NULL, 1), '2025-02-28'::date,
  'leap day: same result as lib/rules addYearsMinusDay (28 Feb)');
SELECT ok(renewal_gap_ok('2026-01-01', '2026-12-31', 1, '2026-06-01'), 'overlap (new starts before old ends) is Renew');
SELECT ok(NOT renewal_gap_ok('2026-01-01', '2026-12-31', 1, '2026-01-01')
          AND NOT renewal_gap_ok('2026-01-01', '2026-12-31', 1, '2025-12-01'),
  'starting on or before the old start is not a renewal');
SELECT is(renewal_latest_start_month('2026-01-01', '2026-11-30', 1), '2027-01-01'::date, 'latest Renew month crosses the year');
SELECT ok(NOT renewal_gap_ok(NULL, NULL, NULL, '2027-01-01'), 'NULL input → false (never silently allowed)');

-- =====================================================================
-- save_job_opening (admin)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

SELECT lives_ok(pg_temp.renew('r1', '01', '2027-02-28'), 'RPC: old ends 31 Dec → Renew starting 28 Feb is saved');
SELECT is((SELECT renewed_from_contract_id FROM contracts WHERE id = pg_temp.rid('r1')), pg_temp.id('01'), 'and it is linked');
SELECT throws_ok(pg_temp.renew('x1', '02', '2027-03-01'), 'AG010',
  'a renewal must start within 2 months after the old contract ends; open it as New',
  'RPC: Renew starting 1 Mar is refused (AG010)');
SELECT throws_ok(pg_temp.renew('x2', '02', '2027-01-10', 'new'), 'AG011', NULL,
  'RPC: linking an old contract with sale_type new is refused (AG011)');
SELECT throws_ok(pg_temp.renew('x3', '02', '2025-12-01'), 'AG010', 'a renewal must start after the old contract starts',
  'RPC: a renewal starting before the old contract starts is refused (AG010)');
SELECT lives_ok(pg_temp.renew('r3', '03', '2026-10-01'), 'RPC: overlap (starts before the old one ends) is allowed as Renew');
SELECT throws_ok(pg_temp.renew('x4', '04', '2027-04-01'), 'AG010', NULL, 'RPC: mid-month end (14 Jan) → Apr start refused');
SELECT lives_ok(pg_temp.renew('r4', '04', '2027-03-31'), 'RPC: mid-month end (14 Jan) → 31 Mar start allowed');
SELECT is((SELECT count(*)::int FROM contracts WHERE contract_no LIKE 'R-x%'), 0, 'no refused job was saved');
SELECT lives_ok($$INSERT INTO _r SELECT 'n1', contract_id, updated_at FROM public.save_job_opening(
      p_branch_id := pg_temp.br(), p_customer_name := 'Gap', p_customer_type := NULL,
      p_contract_no := 'N-1', p_start_date := '2027-06-01', p_end_date := NULL, p_term_years := 1, p_value_total := 24000,
      p_sale_type := 'new', p_customer_id := pg_temp.id('c1'))$$,
  'RPC: the same customer can be opened as New (no link) after the window');

-- ข้อความภาษาไทยใน HINT + เดือนสุดท้ายที่ Renew ได้ใน DETAIL (หน้าจอใช้)
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_detail text; v_hint text;
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL, v_hint = PG_EXCEPTION_HINT;
  RETURN SQLSTATE || '|' || v_detail || '|' || (v_hint LIKE '%New%')::text;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.err(text) TO PUBLIC;
SELECT is(pg_temp.err(pg_temp.renew('x5', '02', '2027-05-01')), 'AG010|2027-02|true',
  'AG010 carries the latest Renew month (DETAIL) and a Thai hint naming New');

-- ---------- โหมดแก้: ย้ายวันเริ่มออกนอกช่วง ----------
CREATE FUNCTION pg_temp.edit_r1(p_start date, p_sale text DEFAULT 'renew') RETURNS text LANGUAGE sql AS $$
  SELECT format($f$
    SELECT * FROM public.save_job_opening(
      p_branch_id := pg_temp.br(), p_customer_name := 'Gap', p_customer_type := NULL,
      p_contract_no := 'R-r1', p_start_date := %L, p_end_date := NULL, p_term_years := 1, p_value_total := 24000,
      p_sale_type := %L, p_contract_id := %L, p_customer_id := pg_temp.id('c1'),
      p_renewed_from_contract_id := pg_temp.id('01'),
      p_expected_updated_at := (SELECT updated_at FROM contracts WHERE id = %L))
  $f$, p_start, p_sale, pg_temp.rid('r1'), pg_temp.rid('r1'))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.edit_r1(date, text) TO PUBLIC;
SELECT throws_ok(pg_temp.edit_r1('2027-03-15'), 'AG010', NULL, 'RPC edit: moving the start of a Renew past the window is refused');
SELECT throws_ok(pg_temp.edit_r1('2027-02-28', 'new'), 'AG011', NULL, 'RPC edit: switching a linked contract to New is refused');
SELECT lives_ok(pg_temp.edit_r1('2027-01-20'), 'RPC edit: moving the start inside the window works');

-- =====================================================================
-- REST (INSERT / UPDATE ตรง) — ข้าม RPC ไม่ได้
-- =====================================================================
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id)
                   VALUES (pg_temp.id('c1'), 'REST-1', '2027-03-01', 1, 24000, 'renew', pg_temp.id('02'))$$,
  'AG010', NULL, 'REST INSERT: Renew past the window is refused');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id)
                   VALUES (pg_temp.id('c1'), 'REST-2', '2027-01-01', 1, 24000, 'new', pg_temp.id('02'))$$,
  'AG011', NULL, 'REST INSERT: link with sale_type new is refused');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, renewed_from_contract_id)
                   VALUES (pg_temp.id('c1'), 'REST-3', '2027-01-01', 1, 24000, pg_temp.id('02'))$$,
  'AG011', NULL, 'REST INSERT: link with sale_type left empty is refused');
SELECT throws_ok($$UPDATE contracts SET start_date = '2027-04-01' WHERE id = pg_temp.rid('r1')$$,
  'AG010', NULL, 'REST UPDATE: moving a Renew start past the window is refused');
SELECT throws_ok($$UPDATE contracts SET sale_type = 'new' WHERE id = pg_temp.rid('r1')$$,
  'AG011', NULL, 'REST UPDATE: switching a linked contract to new is refused');
-- ฝั่งสัญญาเก่า: r1 เริ่ม 20 ม.ค. 2027
SELECT throws_ok($$UPDATE contracts SET end_date = '2026-10-31' WHERE id = pg_temp.id('01')$$,
  'AG010', 'this change would put a linked renewal outside the 2-month window',
  'REST UPDATE: shortening the old contract so its Renew falls outside the window is refused');
SELECT lives_ok($$UPDATE contracts SET end_date = '2026-11-30' WHERE id = pg_temp.id('01')$$,
  'REST UPDATE: shortening the old contract while the Renew stays inside the window works');
SELECT lives_ok($$UPDATE contracts SET note = 'ok' WHERE id = pg_temp.rid('r1')$$, 'other fields of a Renew are editable');
SELECT is((SELECT start_date FROM contracts WHERE id = pg_temp.rid('r1')), '2027-01-20'::date, 'the Renew start is unchanged by refused edits');
-- M23 ยังชนะ: เปลี่ยนลิงก์ → AG009 ไม่ใช่ AG010
SELECT throws_ok($$UPDATE contracts SET renewed_from_contract_id = pg_temp.id('02') WHERE id = pg_temp.rid('r1')$$,
  'AG009', NULL, 'M23 lock still fires first when the link changes (AG009)');

-- M9 ยังชนะ: ผูกสัญญาของลูกค้าคนอื่น (sale_type ว่าง) → P0001 ไม่ใช่ AG011 (ลำดับ trigger)
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, renewed_from_contract_id)
                   VALUES (pg_temp.id('c5'), 'REST-4', '2027-01-01', 1, 24000, pg_temp.id('02'))$$,
  'P0001', NULL, 'M9 same-customer trigger still fires before the gap guard (P0001)');
SELECT ok((SELECT array_agg(tgname ORDER BY tgname) FROM pg_trigger
            WHERE tgrelid = 'public.contracts'::regclass AND tgname IN
              ('contracts_renewal_same_customer', 'contracts_renewed_from_lock', 'contracts_renewed_gap_guard'))
          = ARRAY['contracts_renewal_same_customer', 'contracts_renewed_from_lock', 'contracts_renewed_gap_guard']::name[],
  'the gap guard sorts after the M9 and M23 triggers');

-- host ก็ติดกฎเดียวกัน
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$UPDATE contracts SET start_date = '2027-04-01' WHERE id = pg_temp.rid('r1')$$,
  'AG010', NULL, 'host: moving a Renew start past the window is refused too');

-- ยกเลิก Renew → ย่อสัญญาเก่า → กลับมาใช้ Renew ไม่ได้ถ้าหลุดช่วง (ผลตรวจ security ข้อ 5)
SELECT lives_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.rid('r3')$$, 'host cancels Renew r3 (starts 1 Oct 2026)');
SELECT lives_ok($$UPDATE contracts SET end_date = '2026-06-30' WHERE id = pg_temp.id('03')$$,
  'a cancelled Renew does not block shortening its old contract');
SELECT throws_ok($$UPDATE contracts SET status = 'active' WHERE id = pg_temp.rid('r3')$$,
  'AG010', NULL, 'un-cancelling a Renew that is now outside the window is refused');

-- ข้อมูลเก่า (postgres / นำเข้า) ไม่ติด · แก้ช่องอื่นภายหลังได้
RESET ROLE;
SELECT lives_ok($$INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id)
                  VALUES (pg_temp.id('0e'), pg_temp.id('c1'), 'LEGACY-1', '2027-09-01', 1, 24000, 'renew', pg_temp.id('02'))$$,
  'legacy import (postgres) is not blocked by the rule');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok($$UPDATE contracts SET note = 'แก้หมายเหตุ' WHERE id = pg_temp.id('0e')$$,
  'a legacy out-of-window Renew can still have other fields edited');
SELECT throws_ok($$UPDATE contracts SET start_date = '2027-10-01' WHERE id = pg_temp.id('0e')$$,
  'AG010', NULL, 'but moving its start re-checks the rule');

-- =====================================================================
-- New = นับหนึ่งใหม่: ย้ายสถานีของสัญญาเก่าไม่ได้
-- =====================================================================
RESET ROLE;
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  ('00000000-0000-0000-0000-0000000005b1', pg_temp.id('02'), 'IG', 1, 'active');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(format($$SELECT public.initialize_contract_stations(%L, '{}', '{}', ARRAY['00000000-0000-0000-0000-0000000005b1'::uuid])$$,
                        pg_temp.rid('n1')),
  'SV008', NULL, 'a New contract (no link) cannot take stations of an old contract (SV008)');
SELECT is((SELECT contract_id FROM stations WHERE id = '00000000-0000-0000-0000-0000000005b1'), pg_temp.id('02'),
  'the station stays with the old contract');
SELECT lives_ok(format($$SELECT public.initialize_contract_stations(%L, ARRAY[1], '{}', '{}')$$, pg_temp.rid('n1')),
  'the New contract sets up its own new stations');

-- =====================================================================
-- โมฆะตกบริการค้าง (2.47 ขยายตาม 2.51)
--   v1 (c2) เริ่ม m(-18) จบ m(-6) − 1 วัน มีเดือนตกค้าง
-- =====================================================================
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  (pg_temp.id('b1'), pg_temp.id('c2'), 'V-1', pg_temp.m(-18), 1, 24000, pg_temp.m(-18)),
  (pg_temp.id('b3'), pg_temp.id('c3'), 'V-3', pg_temp.m(-18), 1, 24000, pg_temp.m(-18)),
  (pg_temp.id('b4'), pg_temp.id('c4'), 'V-4', pg_temp.m(-18), 1, 24000, pg_temp.m(-18)),
  (pg_temp.id('b5'), pg_temp.id('c4'), 'V-5', pg_temp.m(-18), 1, 24000, pg_temp.m(-18));

CREATE FUNCTION pg_temp.pending(p text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.list_pending_missed_services() WHERE contract_id = pg_temp.id(p)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.pending(text) TO PUBLIC;
CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a;
GRANT SELECT ON _t TO PUBLIC;
CREATE FUNCTION pg_temp.waive(p text, p_month date) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.resolve_missed_service(%L::jsonb)',
    jsonb_build_object('contract_id', pg_temp.id(p), 'missed_month', p_month, 'reason', 'x'))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.waive(text, date) TO PUBLIC;
CREATE FUNCTION pg_temp.makeup(p text, p_month date) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.save_makeup_service_visit(%L::jsonb)',
    jsonb_build_object('visit_id', pg_temp.id('f1'), 'contract_id', pg_temp.id(p),
                       'visit_date', pg_temp.td(), 'visit_type', 'routine', 'start_time', '09:00', 'end_time', '10:30',
                       'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true,
                       'makeup_for_month', p_month))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.makeup(text, date) TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT ok(pg_temp.pending('b1') > 0 AND pg_temp.pending('b3') > 0 AND pg_temp.pending('b4') > 0,
  'before any newer contract: old contracts have open missed months');

-- ---------- New ที่ซ้อนช่วง / ลูกค้าคนอื่น → ไม่โมฆะ ----------
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  (pg_temp.id('e2'), pg_temp.id('c2'), 'V-N2', pg_temp.m(-10), 1, 24000),            -- ซ้อน v1
  (pg_temp.id('e3'), pg_temp.id('c5'), 'V-N3', pg_temp.m(-3),  1, 24000);            -- ลูกค้าอื่น
SET LOCAL ROLE authenticated;
SELECT ok(NOT contract_is_renewed(pg_temp.id('b1')) AND pg_temp.pending('b1') > 0,
  'a New that overlaps the old contract, or a New of another customer, does not void it');

-- ---------- New ที่เริ่มหลังสัญญาเก่าจบ → โมฆะ ----------
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  (pg_temp.id('e4'), pg_temp.id('c2'), 'V-N4', pg_temp.m(-3), 1, 24000);
SET LOCAL ROLE authenticated;
SELECT ok(contract_is_renewed(pg_temp.id('b1')), 'contract_is_renewed: a later New of the same customer supersedes the old contract');
SELECT is(pg_temp.pending('b1'), 0, 'its open missed months are void (not listed)');
SELECT ok(NOT contract_is_renewed(pg_temp.id('e4')), 'the New contract itself is not superseded');
SELECT throws_ok(pg_temp.waive('b1', pg_temp.m(-12)), 'MS011', NULL, 'host cannot waive a superseded contract (2.48 ④)');
SELECT throws_ok(pg_temp.makeup('b1', pg_temp.m(-12)), 'MS011', NULL, 'host cannot make up a superseded contract');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is(pg_temp.pending('b1'), 0, 'recorder does not see it either');

-- ---------- สัญญา New ใหม่กว่าถูกยกเลิก → กลับเป็นรอตัดสิน (2.48 ②) ----------
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.id('e4')$$, 'host cancels the newer New contract');
SELECT ok(NOT contract_is_renewed(pg_temp.id('b1')) AND pg_temp.pending('b1') > 0,
  'a cancelled newer contract does not void: the open months are back');

-- ---------- Renew ผูกมา → โมฆะ · ยกเลิก → กลับมา ----------
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id) VALUES
  (pg_temp.id('f9'), pg_temp.id('c3'), 'V-R9', pg_temp.m(-6), 1, 24000, 'renew', pg_temp.id('b3'));
SET LOCAL ROLE authenticated;
SELECT ok(contract_is_renewed(pg_temp.id('b3')) AND pg_temp.pending('b3') = 0, 'a Renew linked to the old contract voids it');
SELECT lives_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.id('f9')$$, 'host cancels the Renew');
SELECT ok(NOT contract_is_renewed(pg_temp.id('b3')) AND pg_temp.pending('b3') > 0, 'cancelled Renew: open months are back');

-- ---------- Renew ของอีกหน้างาน (v5) ไม่ทำให้ v4 โมฆะ ----------
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id) VALUES
  (pg_temp.id('f8'), pg_temp.id('c4'), 'V-R8', pg_temp.m(-6), 1, 24000, 'renew', pg_temp.id('b5'));
SET LOCAL ROLE authenticated;
SELECT ok(contract_is_renewed(pg_temp.id('b5')) AND NOT contract_is_renewed(pg_temp.id('b4')) AND pg_temp.pending('b4') > 0,
  'a Renew of another contract of the same customer does not count as a New for v4');

-- =====================================================================
-- รอบ 2: Renew ไม่ผูกสัญญาเก่า (เหตุผล + ช่วงเวลา) · host ผูกลิงก์ย้อนหลัง
--   ช่วงเวลาตั้งเองในเทส (postgres) เทียบกับวันนี้ → ไม่พังเมื่อเลย 2027-04-01
-- =====================================================================
RESET ROLE;
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a4', 'viewer', 'user_a4', 'viewer', '{central}');
INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c6'), pg_temp.br(), 'Unlinked'),
  (pg_temp.id('c7'), pg_temp.br(), 'Unlinked other');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, sale_type, stations_initialized_at) VALUES
  (pg_temp.id('a1'), pg_temp.id('c6'), 'U-OLD',  pg_temp.m(-18), 1, 24000, 'new', pg_temp.m(-18)),
  (pg_temp.id('a2'), pg_temp.id('c6'), 'U-FAR',  pg_temp.m(-40), 1, 24000, 'new', NULL),
  (pg_temp.id('a3'), pg_temp.id('c7'), 'U-OTH',  pg_temp.m(-18), 1, 24000, 'new', NULL);
-- เปิดช่วง: วันกำหนด = อีก 30 วัน
UPDATE app_settings SET allow_unlinked_renew_until = pg_temp.td() + 30;

SELECT is(allow_unlinked_renew_until(), pg_temp.td() + 30, 'helper reads allow_unlinked_renew_until from app_settings');
SELECT is((SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'app_settings' AND column_name = 'allow_unlinked_renew_until'),
  '''2027-04-01''::date', 'default cut-off is 2027-04-01 (open through 31 Mar 2027)');

-- เปิดงาน Renew ไม่ผูก ผ่าน save_job_opening (ลูกค้า c6)
CREATE FUNCTION pg_temp.unl(p_tag text, p_reason text, p_start date DEFAULT NULL, p_sale text DEFAULT 'renew') RETURNS text
LANGUAGE sql AS $$
  SELECT format($f$
    INSERT INTO _r SELECT %L, contract_id, updated_at FROM public.save_job_opening(
      p_branch_id := pg_temp.br(), p_customer_name := 'Unlinked', p_customer_type := NULL,
      p_contract_no := %L, p_start_date := %L, p_end_date := NULL, p_term_years := 1, p_value_total := 24000,
      p_sale_type := %L, p_customer_id := pg_temp.id('c6'), p_renew_unlinked_reason := %L)
  $f$, p_tag, 'U-' || p_tag, coalesce(p_start, pg_temp.m(-7)), p_sale, p_reason)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.unl(text, text, date, text) TO PUBLIC;
CREATE FUNCTION pg_temp.link(p_tag text, p_old text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT * FROM public.link_renewal_contract(%L, %L)', pg_temp.rid(p_tag), pg_temp.id(p_old))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.link(text, text) TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok(pg_temp.unl('u1', 'สัญญาเก่าอยู่ในกระดาษ ยังไม่นำเข้า'),
  'RPC: Renew without a link + reason, inside the period → saved');
SELECT is((SELECT renew_unlinked_reason FROM contracts WHERE id = pg_temp.rid('u1')), 'สัญญาเก่าอยู่ในกระดาษ ยังไม่นำเข้า',
  'the reason is stored');
SELECT throws_ok(pg_temp.unl('ux', NULL), 'AG012', NULL, 'RPC: Renew without a link and no reason → AG012');
SELECT throws_ok(pg_temp.unl('ux', '   '), 'AG012', NULL, 'RPC: a blank reason counts as no reason → AG012');
SELECT lives_ok(pg_temp.unl('u2', 'ไม่ต้องใช้', pg_temp.m(-7), 'new'), 'RPC: New with a leftover reason is saved');
SELECT is((SELECT renew_unlinked_reason FROM contracts WHERE id = pg_temp.rid('u2')), NULL::text,
  'and the reason is dropped for New (kept NULL)');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type)
                   VALUES (pg_temp.id('c6'), 'U-REST1', pg_temp.m(-7), 1, 24000, 'renew')$$,
  'AG012', NULL, 'REST INSERT: Renew without a link and no reason → AG012');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type, renew_unlinked_reason)
                   VALUES (pg_temp.id('c6'), 'U-REST2', pg_temp.m(-7), 1, 24000, 'new', 'x')$$,
  '23514', NULL, 'REST INSERT: a reason on a New contract is refused (CHECK)');
SELECT throws_ok($$UPDATE contracts SET renew_unlinked_reason = NULL WHERE id = pg_temp.rid('u1')$$,
  'AG012', NULL, 'REST UPDATE: clearing the reason of an unlinked Renew → AG012');
SELECT lives_ok($$UPDATE contracts SET note = 'ok' WHERE id = pg_temp.rid('u1')$$, 'other fields of an unlinked Renew are editable');
SELECT lives_ok(pg_temp.unl('u3', 'จะยกเลิก'), 'RPC: another unlinked Renew (u3) inside the period');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.rid('u3')$$, 'host cancels u3 before the cut-off');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
-- โหมดแก้ของ save_job_opening
CREATE FUNCTION pg_temp.edit_u(p_tag text, p_sale text, p_reason text) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$
    SELECT * FROM public.save_job_opening(
      p_branch_id := pg_temp.br(), p_customer_name := 'Unlinked', p_customer_type := NULL,
      p_contract_no := %L, p_start_date := %L, p_end_date := NULL, p_term_years := 1, p_value_total := 24000,
      p_sale_type := %L, p_contract_id := %L, p_customer_id := pg_temp.id('c6'), p_renew_unlinked_reason := %L,
      p_expected_updated_at := (SELECT updated_at FROM contracts WHERE id = %L))
  $f$, 'U-' || p_tag, pg_temp.m(-7), p_sale, pg_temp.rid(p_tag), p_reason, pg_temp.rid(p_tag))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.edit_u(text, text, text) TO PUBLIC;
SELECT throws_ok(pg_temp.edit_u('u1', 'renew', NULL), 'AG012', NULL, 'RPC edit: clearing the reason of an unlinked Renew → AG012');
SELECT lives_ok(pg_temp.edit_u('u1', 'renew', 'สัญญาเก่าอยู่ในกระดาษ ยังไม่นำเข้า'), 'RPC edit: an unlinked Renew with its reason saves');

-- ---------- เลยวันกำหนดแล้ว ----------
RESET ROLE;
UPDATE app_settings SET allow_unlinked_renew_until = pg_temp.td();          -- วันนี้ = วันแรกที่ไม่ได้แล้ว
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(pg_temp.unl('ux', 'เหตุผล'), 'AG013', NULL, 'RPC: past the cut-off, an unlinked Renew is refused (AG013)');
SELECT is(pg_temp.err(pg_temp.unl('ux', 'เหตุผล')), 'AG013|' || to_char(pg_temp.td(), 'YYYY-MM-DD') || '|true',
  'AG013 carries the cut-off date (DETAIL) and a Thai hint naming New');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type, renew_unlinked_reason)
                   VALUES (pg_temp.id('c6'), 'U-REST3', pg_temp.m(-7), 1, 24000, 'renew', 'x')$$,
  'AG013', NULL, 'REST INSERT: past the cut-off → AG013');
SELECT throws_ok($$UPDATE contracts SET sale_type = 'renew', renew_unlinked_reason = 'x' WHERE id = pg_temp.rid('u2')$$,
  'AG013', NULL, 'REST UPDATE: turning a New into an unlinked Renew past the cut-off → AG013');
SELECT throws_ok(pg_temp.edit_u('u2', 'renew', 'เหตุผล'), 'AG013', NULL,
  'RPC edit: turning a New into an unlinked Renew past the cut-off → AG013');
SELECT lives_ok(pg_temp.edit_u('u1', 'renew', 'สัญญาเก่าอยู่ในกระดาษ ยังไม่นำเข้า'),
  'RPC edit: an unlinked Renew opened before the cut-off can still be saved');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$UPDATE contracts SET status = 'active' WHERE id = pg_temp.rid('u3')$$,
  'AG013', NULL, 'un-cancelling an unlinked Renew past the cut-off → AG013 (counts as a new one)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok($$UPDATE contracts SET note = 'แก้หลังเลยวัน' WHERE id = pg_temp.rid('u1')$$,
  'an unlinked Renew opened before the cut-off can still be edited');
SELECT lives_ok($$UPDATE contracts SET renew_unlinked_reason = 'เหตุผลใหม่' WHERE id = pg_temp.rid('u1')$$,
  'and its reason can still be reworded');

-- ---------- แก้ค่าวันกำหนด: เฉพาะผู้ดูแลฐานข้อมูล ----------
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$UPDATE app_settings SET allow_unlinked_renew_until = '2030-01-01'$$,
  '42501', NULL, 'host (authenticated) cannot change allow_unlinked_renew_until');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE app_settings SET allow_unlinked_renew_until = '2030-01-01'$$,
  '42501', NULL, 'service_role cannot change allow_unlinked_renew_until');
RESET ROLE;
SELECT ok(pg_temp.err($$UPDATE app_settings SET allow_unlinked_renew_until = '2030-01-01'$$) = 'no error',
  'the database owner (postgres) can change it');
UPDATE app_settings SET allow_unlinked_renew_until = pg_temp.td();

-- ---------- ข้อมูลเก่า (postgres / นำเข้า) ไม่บังคับเหตุผล / วันกำหนด ----------
SELECT lives_ok($$INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, sale_type)
                  VALUES (pg_temp.id('a9'), pg_temp.id('c6'), 'U-LEGACY', pg_temp.m(-7), 1, 24000, 'renew')$$,
  'legacy import (postgres): an unlinked Renew without a reason is not blocked');
SET LOCAL ROLE service_role;
SELECT lives_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_years, value_total, sale_type)
                  VALUES ('00000000-0000-0000-0000-0000000000c6', 'U-SVC', pg_temp.m(-7), 1, 24000, 'renew')$$,
  'service_role: an unlinked Renew without a reason is not blocked');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok($$UPDATE contracts SET note = 'แก้แถวเก่า' WHERE id = pg_temp.id('a9')$$,
  'a legacy unlinked Renew without a reason can still be edited');

-- ---------- รายการให้ host ตรวจ ----------
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT ok((SELECT array_agg(contract_no ORDER BY contract_no) FROM public.list_unlinked_renewals() WHERE customer_id = pg_temp.id('c6'))
          @> ARRAY['U-LEGACY', 'U-u1'],
  'host: list_unlinked_renewals shows the unlinked Renews (with and without a reason)');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.list_unlinked_renewals() WHERE contract_no IN ('U-u2', 'U-OLD')),
  'New contracts are not listed');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT ok(EXISTS (SELECT 1 FROM public.list_unlinked_renewals() WHERE contract_no = 'U-u1'), 'admin (in scope) can read the list');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT * FROM public.list_unlinked_renewals()$$, '42501', NULL, 'recorder cannot read the list');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok($$SELECT * FROM public.list_unlinked_renewals()$$, '42501', NULL, 'viewer cannot read the list');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.list_unlinked_renewals()$$, '42501', NULL, 'anon cannot call the list');
RESET ROLE;

-- ---------- host ผูกลิงก์ย้อนหลัง ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT ok(pg_temp.pending('a1') > 0, 'before linking: the old contract (overlapping unlinked Renew) still has open months');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(pg_temp.link('u1', 'a1'), '42501', NULL, 'admin cannot link afterwards');
SELECT set_config('aga.renewal_link', pg_temp.rid('u1')::text, true);
SELECT throws_ok($$UPDATE contracts SET renewed_from_contract_id = pg_temp.id('a1'), renew_unlinked_reason = NULL
                    WHERE id = pg_temp.rid('u1')$$,
  'AG009', NULL, 'admin setting the GUC by hand still gets AG009 (host only)');
SELECT set_config('aga.renewal_link', '', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(pg_temp.link('u1', 'a1'), '42501', NULL, 'recorder cannot link afterwards');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$UPDATE contracts SET renewed_from_contract_id = pg_temp.id('a1'), renew_unlinked_reason = NULL
                    WHERE id = pg_temp.rid('u1')$$,
  'AG009', NULL, 'host REST UPDATE (not through the RPC) is still refused (AG009)');
SELECT throws_ok(pg_temp.link('u1', 'a3'), 'P0001', NULL, 'host: linking a contract of another customer → P0001');
SELECT throws_ok(pg_temp.link('u1', 'a2'), 'AG010', NULL, 'host: linking an old contract outside the 2-month window → AG010');
SELECT throws_ok(pg_temp.link('u2', 'a1'), 'AG014', NULL, 'host: a New contract cannot be linked afterwards (AG014)');
SELECT lives_ok(pg_temp.link('u1', 'a1'), 'host links the unlinked Renew to its old contract');
SELECT ok((SELECT renewed_from_contract_id = pg_temp.id('a1') AND renew_unlinked_reason IS NULL
             FROM contracts WHERE id = pg_temp.rid('u1')),
  'the link is set and the reason is cleared');
SELECT ok(EXISTS (SELECT 1 FROM audit_log
                   WHERE table_name = 'contracts' AND row_id = pg_temp.rid('u1') AND action = 'update'
                     AND new_data->>'renewed_from_contract_id' = pg_temp.id('a1')::text
                     AND old_data->>'renewed_from_contract_id' IS NULL),
  'the link is recorded in audit_log');
SELECT ok(contract_is_renewed(pg_temp.id('a1')) AND pg_temp.pending('a1') = 0,
  'after linking, the old contract''s open months are void');
SELECT throws_ok(pg_temp.link('u1', 'a1'), 'AG014', NULL, 'an already linked Renew cannot be linked again (AG014)');
SELECT throws_ok($$UPDATE contracts SET renewed_from_contract_id = NULL WHERE id = pg_temp.rid('u1')$$,
  'AG009', NULL, 'the GUC does not linger: unlinking afterwards is AG009');

SELECT * FROM finish();
ROLLBACK;
