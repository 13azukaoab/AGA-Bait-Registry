-- M28 (20261115180000): กฎช่องว่าง 2 เดือน Renew / New (DECISIONS 2.51)
--   * ตัวช่วย: contract_effective_end_date · renewal_latest_start_month · renewal_gap_ok
--   * save_job_opening + trigger contracts_renewal_gap_guard: AG010 (เกินช่วง / เริ่มไม่หลังสัญญาเก่า) · AG011 (ผูกแต่ไม่ใช่ renew)
--     ทั้ง INSERT / UPDATE ผ่าน REST · ฝั่งสัญญาเก่าแก้วันที่ · ข้อมูลเก่า (postgres) ไม่ติด
--   * New ย้ายสถานีไม่ได้ (initialize_contract_stations → SV008)
--   * โมฆะ: contract_is_renewed = Renew ผูกมา หรือ New ของลูกค้าเดียวกันที่เริ่มหลังสัญญานี้จบ · ยกเลิกแล้วไม่นับ
-- ชุดกฎวันที่ใช้วันที่ตายตัว (ไม่ขึ้นกับวันนี้) · ชุดโมฆะใช้ pg_temp.m(n) = เดือนปัจจุบัน + n (Asia/Bangkok)
BEGIN;
SELECT plan(59);

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
SELECT has_trigger('public', 'contracts', 'contracts_renewal_gap_guard', 'gap guard trigger exists on contracts');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contracts_renewal_gap_guard()', 'EXECUTE'),
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

-- host ก็ติดกฎเดียวกัน
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$UPDATE contracts SET start_date = '2027-04-01' WHERE id = pg_temp.rid('r1')$$,
  'AG010', NULL, 'host: moving a Renew start past the window is refused too');

-- ข้อมูลเก่า (postgres / นำเข้า) ไม่ติด · แก้ช่องอื่นภายหลังได้
RESET ROLE;
SELECT lives_ok($$INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id)
                  VALUES (pg_temp.id('0l'), pg_temp.id('c1'), 'LEGACY-1', '2027-09-01', 1, 24000, 'renew', pg_temp.id('02'))$$,
  'legacy import (postgres) is not blocked by the rule');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok($$UPDATE contracts SET note = 'แก้หมายเหตุ' WHERE id = pg_temp.id('0l')$$,
  'a legacy out-of-window Renew can still have other fields edited');
SELECT throws_ok($$UPDATE contracts SET start_date = '2027-10-01' WHERE id = pg_temp.id('0l')$$,
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
  (pg_temp.id('v1'), pg_temp.id('c2'), 'V-1', pg_temp.m(-18), 1, 24000, pg_temp.m(-18)),
  (pg_temp.id('v3'), pg_temp.id('c3'), 'V-3', pg_temp.m(-18), 1, 24000, pg_temp.m(-18)),
  (pg_temp.id('v4'), pg_temp.id('c4'), 'V-4', pg_temp.m(-18), 1, 24000, pg_temp.m(-18)),
  (pg_temp.id('v5'), pg_temp.id('c4'), 'V-5', pg_temp.m(-18), 1, 24000, pg_temp.m(-18));

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
SELECT ok(pg_temp.pending('v1') > 0 AND pg_temp.pending('v3') > 0 AND pg_temp.pending('v4') > 0,
  'before any newer contract: old contracts have open missed months');

-- ---------- New ที่ซ้อนช่วง / ลูกค้าคนอื่น → ไม่โมฆะ ----------
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  (pg_temp.id('n2'), pg_temp.id('c2'), 'V-N2', pg_temp.m(-10), 1, 24000),            -- ซ้อน v1
  (pg_temp.id('n3'), pg_temp.id('c5'), 'V-N3', pg_temp.m(-3),  1, 24000);            -- ลูกค้าอื่น
SET LOCAL ROLE authenticated;
SELECT ok(NOT contract_is_renewed(pg_temp.id('v1')) AND pg_temp.pending('v1') > 0,
  'a New that overlaps the old contract, or a New of another customer, does not void it');

-- ---------- New ที่เริ่มหลังสัญญาเก่าจบ → โมฆะ ----------
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  (pg_temp.id('n4'), pg_temp.id('c2'), 'V-N4', pg_temp.m(-3), 1, 24000);
SET LOCAL ROLE authenticated;
SELECT ok(contract_is_renewed(pg_temp.id('v1')), 'contract_is_renewed: a later New of the same customer supersedes the old contract');
SELECT is(pg_temp.pending('v1'), 0, 'its open missed months are void (not listed)');
SELECT ok(NOT contract_is_renewed(pg_temp.id('n4')), 'the New contract itself is not superseded');
SELECT throws_ok(pg_temp.waive('v1', pg_temp.m(-12)), 'MS011', NULL, 'host cannot waive a superseded contract (2.48 ④)');
SELECT throws_ok(pg_temp.makeup('v1', pg_temp.m(-12)), 'MS011', NULL, 'host cannot make up a superseded contract');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is(pg_temp.pending('v1'), 0, 'recorder does not see it either');

-- ---------- สัญญา New ใหม่กว่าถูกยกเลิก → กลับเป็นรอตัดสิน (2.48 ②) ----------
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.id('n4')$$, 'host cancels the newer New contract');
SELECT ok(NOT contract_is_renewed(pg_temp.id('v1')) AND pg_temp.pending('v1') > 0,
  'a cancelled newer contract does not void: the open months are back');

-- ---------- Renew ผูกมา → โมฆะ · ยกเลิก → กลับมา ----------
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id) VALUES
  (pg_temp.id('r9'), pg_temp.id('c3'), 'V-R9', pg_temp.m(-6), 1, 24000, 'renew', pg_temp.id('v3'));
SET LOCAL ROLE authenticated;
SELECT ok(contract_is_renewed(pg_temp.id('v3')) AND pg_temp.pending('v3') = 0, 'a Renew linked to the old contract voids it');
SELECT lives_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.id('r9')$$, 'host cancels the Renew');
SELECT ok(NOT contract_is_renewed(pg_temp.id('v3')) AND pg_temp.pending('v3') > 0, 'cancelled Renew: open months are back');

-- ---------- Renew ของอีกหน้างาน (v5) ไม่ทำให้ v4 โมฆะ ----------
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, sale_type, renewed_from_contract_id) VALUES
  (pg_temp.id('r8'), pg_temp.id('c4'), 'V-R8', pg_temp.m(-6), 1, 24000, 'renew', pg_temp.id('v5'));
SET LOCAL ROLE authenticated;
SELECT ok(contract_is_renewed(pg_temp.id('v5')) AND NOT contract_is_renewed(pg_temp.id('v4')) AND pg_temp.pending('v4') > 0,
  'a Renew of another contract of the same customer does not count as a New for v4');

SELECT * FROM finish();
ROLLBACK;
