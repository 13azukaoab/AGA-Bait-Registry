-- M44 (20261115350000): ยกเลิกสัญญา + เปิดกลับ — DECISIONS 2.97
--   * cancel_contract / reopen_contract: สิทธิ์ (host · admin ในขอบเขต) · recorder / viewer / anon / admin นอกขอบเขต → 42501
--   * เหตุผล (CC001) · ประเภทเหตุผล (CC002) · ยกเลิกซ้ำ (CC003) · สัญญาจบแล้ว (CC004) · สัญญาที่ต่อแล้ว (CC005)
--   * พักอยู่ (M29): ยกเลิกได้ → ปิดช่วงพัก · เปิดกลับ → กลับเป็นพัก · สัญญานำเข้า (import_batch) ยกเลิกได้ ค่าไม่เปลี่ยน
--   * Renew: ยกเลิกตัว Renew → สัญญาเก่า "ยังไม่ต่อ" · เปิดกลับเมื่อสัญญาเก่ามี Renew อื่นแล้ว (CC008)
--   * สถานี: IG ที่ยังไม่เก็บขึ้นรายการรอเก็บ (IC/AG ไม่อยู่) · เก็บได้ตั้งแต่วันที่ยกเลิก · มี IG เก็บแล้ว → เปิดกลับไม่ได้ (CC007)
--   * เปิดกลับ: สถานะ active · cancelled_at + ช่องยกเลิกถูกล้าง · ยกเลิกก่อนเดือนที่ปิดแล้ว admin ก็เปิดกลับได้ (เจ้าของ 20 พ.ย.)
--   * audit_log มีแถวทั้งตอนยกเลิกและเปิดกลับ · REST ตรง: admin แก้สัญญายกเลิก → AG007 · เข้า/ออกสถานะยกเลิก → CC009
--   * snapshot ไม่ถูกคำนวณใหม่จากการยกเลิก (กฎ 7)
-- ข้อมูลสมมติทั้งหมด (ไม่ใช่ข้อมูลลูกค้าจริง)
BEGIN;
SELECT plan(79);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adminp@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'admin p',  'user_a4', 'admin',    '{province}'),
  ('00000000-0000-0000-0000-0000000000a5', 'viewer',   'user_a5', 'viewer',   '{central}');

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
CREATE FUNCTION pg_temp.cancel(p_c text, p_code text DEFAULT 'customer_cancelled',
                               p_reason text DEFAULT 'ลูกค้าแจ้งยกเลิก (สมมติ)') RETURNS text LANGUAGE sql AS
  $$ SELECT format('SELECT * FROM public.cancel_contract(%L, %L, %L)', pg_temp.id(p_c), p_code, p_reason) $$;
GRANT EXECUTE ON FUNCTION pg_temp.cancel(text, text, text) TO PUBLIC;
CREATE FUNCTION pg_temp.reopen(p_c text, p_reason text DEFAULT 'กดยกเลิกผิดสัญญา (สมมติ)') RETURNS text LANGUAGE sql AS
  $$ SELECT format('SELECT * FROM public.reopen_contract(%L, %L)', pg_temp.id(p_c), p_reason) $$;
GRANT EXECUTE ON FUNCTION pg_temp.reopen(text, text) TO PUBLIC;
CREATE FUNCTION pg_temp.status(p_c text) RETURNS text LANGUAGE sql AS
  $$ SELECT status::text FROM public.contracts WHERE id = pg_temp.id(p_c) $$;
GRANT EXECUTE ON FUNCTION pg_temp.status(text) TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Cancel Alpha (สมมติ)'),
  (pg_temp.id('c2'), (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Cancel Beta (สมมติ)');

-- d1 ยกเลิก/เปิดกลับโดย admin · d2 REST · d3 ปิดแล้ว · d4 พักอยู่ · d5 นำเข้า · d6 สัญญาเก่า + d7 Renew + d8 Renew ตัวที่ 2
-- d9 หมดอายุแล้ว (สถานะยัง active) · da มีสถานี IG/IC/AG · db เดือนที่ปิดแล้ว
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at, status) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'X-1', pg_temp.m(-3),  12, 24000, pg_temp.m(-3) + 2,  'active'),
  (pg_temp.id('d2'), pg_temp.id('c1'), 'X-2', pg_temp.m(-3),  12, 24000, pg_temp.m(-3) + 2,  'active'),
  (pg_temp.id('d3'), pg_temp.id('c1'), 'X-3', pg_temp.m(-3),  12, 24000, pg_temp.m(-3) + 2,  'closed'),
  (pg_temp.id('d4'), pg_temp.id('c2'), 'X-4', pg_temp.m(-3),  12, 24000, pg_temp.m(-3) + 2,  'active'),
  (pg_temp.id('d5'), pg_temp.id('c2'), 'X-5', pg_temp.m(-3),  12, 24000, pg_temp.m(-3) + 2,  'active'),
  (pg_temp.id('d6'), pg_temp.id('c2'), 'X-6', pg_temp.m(-11), 12, 24000, pg_temp.m(-11) + 2, 'active'),
  (pg_temp.id('d9'), pg_temp.id('c2'), 'X-9', pg_temp.m(-14), 12, 24000, pg_temp.m(-14) + 2, 'active'),
  (pg_temp.id('da'), pg_temp.id('c2'), 'X-A', pg_temp.m(-3),  12, 24000, pg_temp.m(-3) + 2,  'active'),
  (pg_temp.id('db'), pg_temp.id('c2'), 'X-B', pg_temp.m(-3),  12, 24000, pg_temp.m(-3) + 2,  'active');
UPDATE contracts SET import_batch = 'registry-TEST' WHERE id = pg_temp.id('d5');
-- dd สัญญาเก่า + de Renew (กฎ 2 เดือนตอนเปิดกลับ) · dg Renew ไม่ผูก (วันกำหนดตอนเปิดกลับ)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at, status) VALUES
  (pg_temp.id('dd'), pg_temp.id('c2'), 'X-D', pg_temp.m(-11), 12, 24000, pg_temp.m(-11) + 2, 'active');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, status, sale_type, renewed_from_contract_id, renew_unlinked_reason) VALUES
  (pg_temp.id('d7'), pg_temp.id('c2'), 'X-7', pg_temp.m(1), 12, 24000, 'active', 'renew', pg_temp.id('d6'), NULL),
  (pg_temp.id('de'), pg_temp.id('c2'), 'X-E', pg_temp.m(1), 12, 24000, 'active', 'renew', pg_temp.id('dd'), NULL),
  (pg_temp.id('dg'), pg_temp.id('c2'), 'X-G', pg_temp.m(-3), 12, 24000, 'active', 'renew', NULL, 'สัญญาเก่าอยู่ในกระดาษ (สมมติ)');
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  (pg_temp.id('b1'), pg_temp.id('da'), 'IG', 1, 'active'),
  (pg_temp.id('b2'), pg_temp.id('da'), 'IG', 2, 'active'),
  (pg_temp.id('b3'), pg_temp.id('da'), 'IC', 1, 'active'),
  (pg_temp.id('b4'), pg_temp.id('da'), 'AG', 1, 'pending_removal');
CREATE TEMP TABLE _snap AS SELECT count(*)::int AS n FROM monthly_branch_snapshots;
GRANT SELECT ON _snap TO PUBLIC;

-- =====================================================================
-- โครงสร้าง + สิทธิ์ของฟังก์ชัน
-- =====================================================================
SELECT has_column('public', 'contracts', 'cancel_reason_code', 'contracts.cancel_reason_code exists');
SELECT has_column('public', 'contracts', 'cancel_reason', 'contracts.cancel_reason exists');
SELECT has_column('public', 'contracts', 'cancelled_by', 'contracts.cancelled_by exists');
SELECT ok(NOT has_function_privilege('anon', 'public.cancel_contract(uuid, text, text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.reopen_contract(uuid, text)', 'EXECUTE'),
  'anon cannot execute cancel / reopen');
SELECT ok(has_function_privilege('authenticated', 'public.cancel_contract(uuid, text, text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.reopen_contract(uuid, text)', 'EXECUTE'),
  'logged-in users can call cancel / reopen (role checked inside)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contracts_status_cancel_guard()', 'EXECUTE'),
  'guard trigger function is not callable directly');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.cancel_contract(uuid, text, text)'::regprocedure)
          AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.reopen_contract(uuid, text)'::regprocedure)
          AND (SELECT proconfig::text LIKE '%search_path=%' FROM pg_proc WHERE oid = 'public.cancel_contract(uuid, text, text)'::regprocedure)
          AND (SELECT proconfig::text LIKE '%search_path=%' FROM pg_proc WHERE oid = 'public.reopen_contract(uuid, text)'::regprocedure),
  'both RPCs are SECURITY DEFINER with a fixed search_path');

-- =====================================================================
-- ยกเลิก: สิทธิ์ + เหตุผล
-- =====================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(pg_temp.cancel('d1'), '42501', NULL, 'anon cannot cancel');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a5');
SELECT throws_ok(pg_temp.cancel('d1'), '42501', NULL, 'viewer cannot cancel');
SELECT pg_temp.as_user('a3');
SELECT throws_ok(pg_temp.cancel('d1'), '42501', NULL, 'recorder cannot cancel');
SELECT pg_temp.as_user('a4');
SELECT throws_ok(pg_temp.cancel('d1'), '42501', NULL, 'admin out of scope (province) cannot cancel a central contract');
SELECT pg_temp.as_user('a2');
SELECT throws_ok(pg_temp.cancel('d1', 'customer_cancelled', '   '), 'CC001', NULL, 'blank reason is rejected');
SELECT throws_ok(pg_temp.cancel('d1', 'customer_cancelled', E' ​'), 'CC001', NULL, 'invisible-only reason is rejected');
SELECT throws_ok(pg_temp.cancel('d1', 'customer_cancelled', repeat('ก', 501)), 'CC001', NULL, 'reason over 500 characters is rejected');
SELECT throws_ok(pg_temp.cancel('d1', 'oops'), 'CC002', NULL, 'unknown reason code is rejected');
SELECT throws_ok(pg_temp.cancel('d1', NULL), 'CC002', NULL, 'reason code is required');
SELECT throws_ok($$SELECT * FROM public.cancel_contract(NULL, 'other', 'x')$$, '22004', NULL, 'contract id is required');
SELECT throws_ok(pg_temp.cancel('ff'), '42501', NULL, 'admin: unknown contract looks like out of scope (no existence leak)');

SELECT lives_ok(pg_temp.cancel('d1', 'entry_error', '  ลงข้อมูลซ้ำ (สมมติ)  '), 'admin in scope cancels a contract');
RESET ROLE;
SELECT is(pg_temp.status('d1'), 'cancelled', 'status is cancelled');
SELECT ok((SELECT cancelled_at = now() FROM contracts WHERE id = pg_temp.id('d1')),
  'cancelled_at = the moment of the click (no backdating)');
SELECT is((SELECT row(cancel_reason_code, cancel_reason, cancelled_by)::text FROM contracts WHERE id = pg_temp.id('d1')),
  row('entry_error', 'ลงข้อมูลซ้ำ (สมมติ)', '00000000-0000-0000-0000-0000000000a2'::uuid)::text,
  'reason code, trimmed reason and who cancelled are stored');
SELECT ok(EXISTS (SELECT 1 FROM audit_log a
                   WHERE a.table_name = 'contracts' AND a.row_id = pg_temp.id('d1') AND a.action = 'update'
                     AND a.old_data->>'status' = 'active' AND a.new_data->>'status' = 'cancelled'
                     AND a.new_data->>'cancel_reason' = 'ลงข้อมูลซ้ำ (สมมติ)'
                     AND a.changed_by = '00000000-0000-0000-0000-0000000000a2'),
  'cancelling writes an audit_log row (who + reason)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT throws_ok(pg_temp.cancel('d1'), 'CC003', NULL, 'cancelling twice is rejected');
SELECT is((SELECT r.status::text FROM public.cancel_contract(pg_temp.id('d5'), 'customer_cancelled', 'ไม่ต่อ (สมมติ)') r),
  'cancelled', 'the RPC returns the new status (imported contract can be cancelled)');
RESET ROLE;
SELECT is((SELECT import_batch FROM contracts WHERE id = pg_temp.id('d5')), 'registry-TEST',
  'import_batch is untouched by cancelling (AG020 not tripped)');

-- สัญญาที่จบแล้ว
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.cancel('d3'), 'CC004', NULL, 'a closed contract cannot be cancelled');
SELECT throws_ok(pg_temp.cancel('d9'), 'CC004', NULL, 'a contract past its end date (still marked active) cannot be cancelled');

-- =====================================================================
-- REST ตรง (ไม่ผ่าน RPC)
-- =====================================================================
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$UPDATE contracts SET status = 'active' WHERE id = pg_temp.id('d1')$$,
  'AG007', NULL, 'admin cannot un-cancel through REST (AG007)');
SELECT throws_ok($$UPDATE contracts SET cancelled_at = now() - interval '30 days' WHERE id = pg_temp.id('d1')$$,
  'AG007', NULL, 'admin cannot backdate cancelled_at through REST (AG007)');
SELECT throws_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.id('d2')$$,
  'CC009', NULL, 'admin cannot cancel through REST (no reason) — CC009');
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.id('d2')$$,
  'CC009', NULL, 'host cannot cancel through REST either');
SELECT throws_ok($$UPDATE contracts SET status = 'active' WHERE id = pg_temp.id('d1')$$,
  'CC009', NULL, 'host cannot un-cancel through REST');
SELECT throws_ok($$UPDATE contracts SET cancelled_at = now() - interval '30 days' WHERE id = pg_temp.id('d1')$$,
  'CC009', NULL, 'host cannot backdate cancelled_at through REST');
SELECT throws_ok($$UPDATE contracts SET cancel_reason = 'แก้เหตุผล' WHERE id = pg_temp.id('d1')$$,
  'CC009', NULL, 'host cannot edit the cancel reason directly');
SELECT throws_ok($$UPDATE contracts SET reopened_at = now(), reopened_by = auth.uid(), reopen_reason = 'x' WHERE id = pg_temp.id('d2')$$,
  'CC009', NULL, 'reopen fields cannot be written directly');
SELECT lives_ok($$UPDATE contracts SET contract_no = 'X-1b' WHERE id = pg_temp.id('d1')$$,
  'host can still edit other fields of a cancelled contract');
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_months, value_total, status)
                   VALUES (pg_temp.id('c1'), 'X-Z', pg_temp.m(0), 12, 1000, 'cancelled')$$,
  'CC009', NULL, 'a contract cannot be inserted as cancelled through REST');

-- =====================================================================
-- เปิดกลับ: สิทธิ์ + ผลลัพธ์
-- =====================================================================
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(pg_temp.reopen('d1'), '42501', NULL, 'anon cannot reopen');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a5');
SELECT throws_ok(pg_temp.reopen('d1'), '42501', NULL, 'viewer cannot reopen');
SELECT pg_temp.as_user('a3');
SELECT throws_ok(pg_temp.reopen('d1'), '42501', NULL, 'recorder cannot reopen');
SELECT pg_temp.as_user('a4');
SELECT throws_ok(pg_temp.reopen('d1'), '42501', NULL, 'admin out of scope cannot reopen');
SELECT pg_temp.as_user('a2');
SELECT throws_ok(pg_temp.reopen('d1', ' '), 'CC001', NULL, 'reopen needs a reason');
SELECT throws_ok(pg_temp.reopen('d2'), 'CC006', NULL, 'a contract that is not cancelled cannot be reopened');
SELECT is((SELECT r.status::text FROM public.reopen_contract(pg_temp.id('d1'), ' กดผิด (สมมติ) ') r), 'active',
  'admin in scope reopens → active');
RESET ROLE;
SELECT ok((SELECT cancelled_at IS NULL AND cancel_reason IS NULL AND cancel_reason_code IS NULL AND cancelled_by IS NULL
             FROM contracts WHERE id = pg_temp.id('d1')),
  'reopen clears cancelled_at and the cancel fields');
SELECT is((SELECT row(reopen_reason, reopened_by, reopened_at = now())::text FROM contracts WHERE id = pg_temp.id('d1')),
  row('กดผิด (สมมติ)', '00000000-0000-0000-0000-0000000000a2'::uuid, true)::text,
  'reopen reason / who / when are stored');
SELECT ok(EXISTS (SELECT 1 FROM audit_log a
                   WHERE a.table_name = 'contracts' AND a.row_id = pg_temp.id('d1') AND a.action = 'update'
                     AND a.old_data->>'status' = 'cancelled' AND a.new_data->>'status' = 'active'
                     AND a.old_data->>'cancel_reason' = 'ลงข้อมูลซ้ำ (สมมติ)'
                     AND a.new_data->>'reopen_reason' = 'กดผิด (สมมติ)'
                     AND a.changed_by = '00000000-0000-0000-0000-0000000000a2'),
  'reopening writes an audit_log row (old cancel reason kept in old_data)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.cancel('d1', 'other', 'ยกเลิกรอบสอง (สมมติ)'), 'host cancels the reopened contract again');
SELECT lives_ok(pg_temp.reopen('d1'), 'host reopens it again');
SELECT is(pg_temp.status('d1'), 'active', 'd1 active after the second reopen');

-- =====================================================================
-- พักสัญญา (M29)
-- =====================================================================
SELECT lives_ok($$SELECT public.pause_contract(pg_temp.id('d4'), pg_temp.m(-1) + 1, 'ค้างชำระ (สมมติ)')$$, 'host pauses d4');
SELECT pg_temp.as_user('a2');
SELECT lives_ok(pg_temp.cancel('d4', 'customer_cancelled', 'ไม่จ่ายต่อ (สมมติ)'), 'admin cancels a paused contract');
RESET ROLE;
SELECT ok((SELECT end_kind = 'cancelled' AND resumed_at IS NOT NULL FROM contract_pauses WHERE contract_id = pg_temp.id('d4')),
  'cancelling closes the open pause period (end_kind = cancelled)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT is((SELECT r.status::text FROM public.reopen_contract(pg_temp.id('d4'), 'ลูกค้าจ่ายแล้ว (สมมติ)') r), 'paused',
  'reopening a contract cancelled while paused returns it to paused');
RESET ROLE;
SELECT ok((SELECT resumed_at IS NULL AND end_kind IS NULL FROM contract_pauses WHERE contract_id = pg_temp.id('d4'))
          AND (SELECT cancelled_at IS NULL FROM contracts WHERE id = pg_temp.id('d4')),
  'the pause period is open again · cancelled_at cleared');

-- =====================================================================
-- Renew
-- =====================================================================
SELECT ok(public.contract_is_renewed(pg_temp.id('d6')), 'd6 counts as renewed (by d7)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.cancel('d6'), 'CC005', NULL, 'an old contract that was renewed cannot be cancelled');
SELECT lives_ok(pg_temp.cancel('d7', 'entry_error', 'Renew ลงผิด (สมมติ)'), 'the renewal itself can be cancelled');
RESET ROLE;
SELECT ok(NOT public.contract_is_renewed(pg_temp.id('d6')), 'after cancelling the renewal, d6 is no longer renewed');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.cancel('d6', 'customer_cancelled', 'ไม่ต่อแล้ว (สมมติ)'), 'with the renewal cancelled, d6 can be cancelled');
SELECT lives_ok(pg_temp.reopen('d6'), 'host reopens d6');
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, status, sale_type, renewed_from_contract_id) VALUES
  (pg_temp.id('d8'), pg_temp.id('c2'), 'X-8', pg_temp.m(1), 12, 24000, 'active', 'renew', pg_temp.id('d6'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.reopen('d7'), 'CC008', NULL, 'a cancelled renewal cannot be reopened when the old contract has another renewal');

-- =====================================================================
-- สถานี: รายการรอเก็บ IG (§7.8)
-- =====================================================================
SELECT pg_temp.as_user('a2');
SELECT lives_ok(pg_temp.cancel('da'), 'admin cancels da (2 IG, 1 IC, 1 AG)');
SELECT pg_temp.as_user('a1');
SELECT is((SELECT row(ig_total, remaining)::text FROM v_contract_ig_collection WHERE contract_id = pg_temp.id('da')),
  row(2, 2)::text, 'pending-collection view: both IG waiting · IC / AG are not in the list');
SELECT is((SELECT status::text FROM stations WHERE id = pg_temp.id('b4')), 'pending_removal',
  'AG box is untouched by cancelling (pending_removal kept)');
SELECT throws_ok($$SELECT public.collect_ig_stations(pg_temp.id('da'), 1, pg_temp.td() - 1, (SELECT id FROM teams WHERE code = 'A'))$$,
  'CL005', NULL, 'IG cannot be collected before the cancel date');
SELECT lives_ok($$SELECT public.collect_ig_stations(pg_temp.id('da'), 1, pg_temp.td(), (SELECT id FROM teams WHERE code = 'A'))$$,
  'host collects 1 IG of the cancelled contract (from the cancel date)');
SELECT is((SELECT remaining FROM v_contract_ig_collection WHERE contract_id = pg_temp.id('da')), 1,
  'remaining IG counter drops to 1');
SELECT throws_ok(pg_temp.reopen('da'), 'CC007', NULL, 'a contract with collected IG cannot be reopened');

-- =====================================================================
-- เดือนที่ปิดแล้ว (เจ้าของ 20 พ.ย. 2026: host + admin เปิดกลับได้แม้ยกเลิกก่อนเดือนที่ปิด)
-- =====================================================================
SELECT lives_ok(pg_temp.cancel('db'), 'host cancels db');
RESET ROLE;
-- จำลองว่ายกเลิกตั้งแต่ 2 เดือนก่อน (ทางระบบ) แล้วเดือนก่อนหน้าปิดไปแล้ว
UPDATE contracts SET cancelled_at = (pg_temp.m(-2) + 5)::timestamp AT TIME ZONE 'Asia/Bangkok' WHERE id = pg_temp.id('db');
INSERT INTO month_closures (month_key, scope, closed_at) VALUES (to_char(pg_temp.m(-1), 'YYYY-MM'), 'central', now())
  ON CONFLICT DO NOTHING;
UPDATE month_closures SET closed_at = now() WHERE month_key = to_char(pg_temp.m(-1), 'YYYY-MM') AND scope = 'central';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT lives_ok(pg_temp.reopen('db'), 'admin in scope can reopen a cancellation that spans a closed month');
SELECT is(pg_temp.status('db'), 'active', 'db active again');

-- =====================================================================
-- เปิดกลับ Renew: กฎ M28 ยังใช้ (RPC ตรวจเอง — trigger contracts_renewed_gap_guard ข้ามเมื่อไม่ใช่ authenticated)
-- =====================================================================
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.cancel('de'), 'host cancels Renew de');
RESET ROLE;
UPDATE contracts SET end_date = pg_temp.m(-6) WHERE id = pg_temp.id('dd');     -- สัญญาเก่าจบเร็วขึ้น (ทางระบบ)
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.reopen('de'), 'AG010', NULL,
  'reopening a Renew that now starts outside the 2-month window is refused (AG010)');
SELECT lives_ok(pg_temp.cancel('dg'), 'host cancels unlinked Renew dg');
RESET ROLE;
UPDATE app_settings SET allow_unlinked_renew_until = pg_temp.td();           -- วันนี้ = เลยวันกำหนดแล้ว
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.reopen('dg'), 'AG013', NULL,
  'reopening an unlinked Renew past the cut-off is refused (AG013)');

-- =====================================================================
-- snapshot ไม่ถูกคำนวณใหม่ (กฎ 7)
-- =====================================================================
RESET ROLE;
SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots), (SELECT n FROM _snap),
  'cancel / reopen do not write monthly_branch_snapshots');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_trigger t
                       WHERE t.tgrelid = 'public.contracts'::regclass AND NOT t.tgisinternal
                         AND pg_get_triggerdef(t.oid) ILIKE '%snapshot%'),
  'no trigger on contracts recomputes snapshots');

SELECT * FROM finish();
ROLLBACK;
