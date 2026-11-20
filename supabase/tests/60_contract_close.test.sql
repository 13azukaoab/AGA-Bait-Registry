-- M44a (20261115340000): ปิดสัญญา — DECISIONS 2.99 · SPEC §7.8 v1.9
--   * close_contract: host ทุกสาขา · recorder ในขอบเขต · recorder นอกขอบเขต / admin / viewer / anon → 42501
--   * ยังไม่หมดอายุ (CL006) · ปิดซ้ำ (CL007) · ยกเลิกแล้ว (CL008) · พักอยู่ (CL009) · หมายเหตุยาวเกิน (CL010)
--   * "หมดอายุ" = expired_pending_collection หรือ active ที่เลยวันสิ้นสุด (ไม่มีอะไรตั้ง expired ให้เอง)
--   * ปิดได้แม้ IG ยังเก็บไม่ครบ · IG ค้างยังอยู่ในรายการรอเก็บ + เก็บต่อได้ · ลง audit_log · closed_by/close_note แก้ตรงไม่ได้ (CL011)
-- ข้อมูลสมมติทั้งหมด (ไม่ใช่ข้อมูลลูกค้าจริง)
BEGIN;
SELECT plan(37);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recp@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',       'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',      'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder',   'user_a3', 'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'recorder p', 'user_a4', 'recorder', '{province}'),
  ('00000000-0000-0000-0000-0000000000a5', 'viewer',     'user_a5', 'viewer',   '{central}');

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.td() RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.td() TO PUBLIC;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || p, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;
CREATE FUNCTION pg_temp.close(p_c text, p_note text DEFAULT NULL) RETURNS text LANGUAGE sql AS
  $$ SELECT format('SELECT * FROM public.close_contract(%L, %L)', pg_temp.id(p_c), p_note) $$;
GRANT EXECUTE ON FUNCTION pg_temp.close(text, text) TO PUBLIC;
CREATE FUNCTION pg_temp.status(p_c text) RETURNS text LANGUAGE sql AS
  $$ SELECT status::text FROM public.contracts WHERE id = pg_temp.id(p_c) $$;
GRANT EXECUTE ON FUNCTION pg_temp.status(text) TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Close Alpha (สมมติ)');

-- d1 หมดอายุ (active · เลยวันสิ้นสุด) มี IG/IC/AG · d2 ยังไม่หมดอายุ · d3 expired_pending_collection (นำเข้า)
-- d4 พักอยู่ (หมดอายุระหว่างพัก) · d5 ยกเลิก · d6 end_date กำหนดเองเลยแล้ว (term ยังไม่ครบ)
INSERT INTO contracts (id, customer_id, contract_no, start_date, end_date, term_months, value_total, stations_initialized_at, status) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'C-1', pg_temp.m(-14), NULL,              12, 24000, pg_temp.m(-14) + 2, 'active'),
  (pg_temp.id('d2'), pg_temp.id('c1'), 'C-2', pg_temp.m(-3),  NULL,              12, 24000, pg_temp.m(-3) + 2,  'active'),
  (pg_temp.id('d3'), pg_temp.id('c1'), 'C-3', pg_temp.m(-14), NULL,              12, 24000, pg_temp.m(-14) + 2, 'expired_pending_collection'),
  (pg_temp.id('d4'), pg_temp.id('c1'), 'C-4', pg_temp.m(-6),  NULL,              12, 24000, pg_temp.m(-6) + 2,  'active'),
  (pg_temp.id('d5'), pg_temp.id('c1'), 'C-5', pg_temp.m(-14), NULL,              12, 24000, pg_temp.m(-14) + 2, 'cancelled'),
  (pg_temp.id('d6'), pg_temp.id('c1'), 'C-6', pg_temp.m(-6),  pg_temp.td() - 1,  12, 24000, pg_temp.m(-6) + 2,  'active');
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  (pg_temp.id('b1'), pg_temp.id('d1'), 'IG', 1, 'active'),
  (pg_temp.id('b2'), pg_temp.id('d1'), 'IG', 2, 'active'),
  (pg_temp.id('b3'), pg_temp.id('d1'), 'IG', 3, 'active'),
  (pg_temp.id('b4'), pg_temp.id('d1'), 'IC', 1, 'active'),
  (pg_temp.id('b5'), pg_temp.id('d1'), 'AG', 1, 'active');
-- d4 พักตั้งแต่เดือนก่อน (ทางระบบ: แถวพักก่อน แล้วสถานะ)
INSERT INTO contract_pauses (contract_id, paused_from, reason) VALUES (pg_temp.id('d4'), pg_temp.m(-1) + 1, 'ค้างชำระ (สมมติ)');
UPDATE contracts SET status = 'paused' WHERE id = pg_temp.id('d4');
CREATE TEMP TABLE _snap AS SELECT count(*)::int AS n FROM monthly_branch_snapshots;
GRANT SELECT ON _snap TO PUBLIC;

-- =====================================================================
-- โครงสร้าง + สิทธิ์ของฟังก์ชัน
-- =====================================================================
SELECT has_column('public', 'contracts', 'closed_by', 'contracts.closed_by exists');
SELECT has_column('public', 'contracts', 'close_note', 'contracts.close_note exists');
SELECT ok(NOT has_function_privilege('anon', 'public.close_contract(uuid, text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.close_contract(uuid, text)', 'EXECUTE'),
  'close_contract: anon cannot execute · logged-in can (role checked inside)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contracts_close_fields_guard()', 'EXECUTE'),
  'guard trigger function is not callable directly');
SELECT ok((SELECT prosecdef AND proconfig::text LIKE '%search_path=%' FROM pg_proc
            WHERE oid = 'public.close_contract(uuid, text)'::regprocedure),
  'close_contract is SECURITY DEFINER with a fixed search_path');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                       WHERE t.tgrelid = 'public.contracts'::regclass AND NOT t.tgisinternal
                         AND p.prosrc ILIKE '%expired_pending_collection%'),
  'no trigger sets expired_pending_collection (expiry is defined by the end date)');

-- =====================================================================
-- สิทธิ์
-- =====================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(pg_temp.close('d1'), '42501', NULL, 'anon cannot close');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a5');
SELECT throws_ok(pg_temp.close('d1'), '42501', NULL, 'viewer cannot close');
SELECT pg_temp.as_user('a2');
SELECT throws_ok(pg_temp.close('d1'), '42501', NULL, 'admin cannot close (read only — 2.99)');
SELECT pg_temp.as_user('a4');
SELECT throws_ok(pg_temp.close('d1'), '42501', NULL, 'recorder out of scope (province) cannot close a central contract');
SELECT throws_ok(pg_temp.close('ff'), '42501', NULL, 'recorder: unknown contract looks like out of scope (no existence leak)');
SELECT pg_temp.as_user('a3');
SELECT throws_ok($$SELECT * FROM public.close_contract(NULL)$$, '22004', NULL, 'contract id is required');
SELECT throws_ok(pg_temp.close('d1', repeat('ก', 501)), 'CL010', NULL, 'note over 500 characters is rejected');

-- =====================================================================
-- สถานะที่ปิดไม่ได้
-- =====================================================================
SELECT throws_ok(pg_temp.close('d2'), 'CL006', NULL, 'a contract that has not expired cannot be closed (use cancel)');
SELECT throws_ok(pg_temp.close('d5'), 'CL008', NULL, 'a cancelled contract cannot be closed');
SELECT throws_ok(pg_temp.close('d4'), 'CL009', NULL, 'a paused contract cannot be closed (resume first — 2.94 Q3)');
SELECT is(pg_temp.status('d2'), 'active', 'refused close changed nothing');

-- =====================================================================
-- ปิดได้: recorder ในขอบเขต · IG ยังค้าง
-- =====================================================================
SELECT is((SELECT row(r.status, r.ig_remaining)::text FROM public.close_contract(pg_temp.id('d1'), '  เก็บไม่ครบ ลูกค้าไม่สะดวก (สมมติ) ') r),
  row('closed'::contract_status, 3)::text,
  'recorder in scope closes an expired contract with 3 IG still to collect (returns ig_remaining)');
RESET ROLE;
SELECT is((SELECT row(status, closed_at = now(), closed_by, close_note)::text FROM contracts WHERE id = pg_temp.id('d1')),
  row('closed'::contract_status, true, '00000000-0000-0000-0000-0000000000a3'::uuid, 'เก็บไม่ครบ ลูกค้าไม่สะดวก (สมมติ)')::text,
  'status closed · closed_at = now · closed_by = recorder · note trimmed');
SELECT ok(EXISTS (SELECT 1 FROM audit_log a
                   WHERE a.table_name = 'contracts' AND a.row_id = pg_temp.id('d1') AND a.action = 'update'
                     AND a.old_data->>'status' = 'active' AND a.new_data->>'status' = 'closed'
                     AND a.changed_by = '00000000-0000-0000-0000-0000000000a3'),
  'closing writes an audit_log row (who)');
SELECT is((SELECT row(ig_total, remaining)::text FROM v_contract_ig_collection WHERE contract_id = pg_temp.id('d1')),
  row(3, 3)::text, 'after closing, the 3 IG are still in the pending-collection list (IC / AG not in it)');
SELECT is((SELECT count(*)::int FROM stations WHERE contract_id = pg_temp.id('d1') AND status = 'active'), 5,
  'closing does not touch stations');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT throws_ok(pg_temp.close('d1'), 'CL007', NULL, 'closing twice is rejected');
SELECT lives_ok($$SELECT public.collect_ig_stations(pg_temp.id('d1'), 1, pg_temp.td(), (SELECT id FROM teams WHERE code = 'A'))$$,
  'recorder can still collect IG of the closed contract');
RESET ROLE;
SELECT is((SELECT remaining FROM v_contract_ig_collection WHERE contract_id = pg_temp.id('d1')), 2,
  'remaining IG drops to 2');

-- expired_pending_collection (นำเข้า) · end_date กำหนดเองเลยแล้ว · host
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT is((SELECT r.ig_remaining FROM public.close_contract(pg_temp.id('d3')) r), 0,
  'host closes an imported expired_pending_collection contract (no IG → 0)');
SELECT is((SELECT close_note FROM contracts WHERE id = pg_temp.id('d3')), NULL, 'no note → NULL');
SELECT lives_ok(pg_temp.close('d6', '   '), 'a contract whose own end_date has passed can be closed (blank note ok)');
SELECT is(pg_temp.status('d6'), 'closed', 'd6 closed');

-- =====================================================================
-- REST: closed_by / close_note แก้ตรงไม่ได้ · ปิดแล้วล็อกตาม AG007 เดิม
-- =====================================================================
SELECT throws_ok($$UPDATE contracts SET close_note = 'แก้ตรง' WHERE id = pg_temp.id('d1')$$,
  'CL011', NULL, 'host cannot edit close_note directly');
SELECT throws_ok($$UPDATE contracts SET closed_by = auth.uid() WHERE id = pg_temp.id('d2')$$,
  'CL011', NULL, 'host cannot set closed_by directly');
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$UPDATE contracts SET contract_no = 'C-1x' WHERE id = pg_temp.id('d1')$$,
  'AG007', NULL, 'admin cannot edit a closed contract (AG007 unchanged)');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_months, value_total, close_note)
                   VALUES (pg_temp.id('c1'), 'C-Z', pg_temp.m(0), 12, 1000, 'x')$$,
  'CL011', NULL, 'close_note cannot be set on insert through REST');
RESET ROLE;
SELECT lives_ok($$UPDATE contracts SET close_note = 'แก้โดยผู้ดูแลฐานข้อมูล' WHERE id = pg_temp.id('d1')$$,
  'system path (postgres) can still fix the note');

-- พักแล้วกลับมาต่อ → ปิดได้
UPDATE contract_pauses SET resumed_at = pg_temp.td(), end_kind = 'resumed' WHERE contract_id = pg_temp.id('d4');
UPDATE contracts SET status = 'active', end_date = pg_temp.td() - 1 WHERE id = pg_temp.id('d4');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT lives_ok(pg_temp.close('d4'), 'after resuming, the expired contract can be closed');
SELECT is(pg_temp.status('d4'), 'closed', 'd4 closed');

-- snapshot ไม่ถูกเขียน
RESET ROLE;
SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots), (SELECT n FROM _snap),
  'closing does not write monthly_branch_snapshots (rule 7)');

SELECT * FROM finish();
ROLLBACK;
