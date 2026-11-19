-- M29 (20261115300000 + 20261115300001): พักสัญญา — DECISIONS 2.52 · 2.63 · 2.87
--   * โครงสร้าง: enum 'paused' · contract_pauses (RLS · ด่านทับซ้อน) · origin บนผลของเดือน
--   * pause_contract / resume_contract: สิทธิ์ (host · admin/recorder ในขอบเขต) · CP001–CP007
--   * ด่าน: สถานะเปลี่ยนตรงไม่ได้ (CP008) · ยกเลิกจากพักได้ (ปิดช่วงพักเอง) · routine ช่วงพัก (CP009)
--     · เก็บ IG ช่วงพัก (CP010) · ชดเชยจากพักเกินอายุสัญญา (CP011 recorder) · ไม่ชดเชย/หมายเหตุเดือนพัก (CP012)
--   * ตกบริการ: list_pending / list_voided / central_unready ไม่นับเดือนที่พัก · เดือนที่กลับมาต่อนับตามปกติ
--   * อ่าน: list_paused_contracts (warn > 3 เดือน) · list_pause_makeups · v_paused_branch_summary (anon อ่านได้)
-- ข้อมูลสมมติทั้งหมด (ไม่ใช่ข้อมูลลูกค้าจริง)
BEGIN;
SELECT plan(82);

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
CREATE FUNCTION pg_temp.pause(p_c text, p_from date, p_reason text DEFAULT 'ค้างชำระ (สมมติ)') RETURNS text LANGUAGE sql AS
  $$ SELECT format('SELECT public.pause_contract(%L, %L, %L)', pg_temp.id(p_c), p_from, p_reason) $$;
GRANT EXECUTE ON FUNCTION pg_temp.pause(text, date, text) TO PUBLIC;
CREATE FUNCTION pg_temp.resume(p_c text, p_at date) RETURNS text LANGUAGE sql AS
  $$ SELECT format('SELECT public.resume_contract(%L, %L)', pg_temp.id(p_c), p_at) $$;
GRANT EXECUTE ON FUNCTION pg_temp.resume(text, date) TO PUBLIC;
CREATE FUNCTION pg_temp.status(p_c text) RETURNS text LANGUAGE sql AS
  $$ SELECT status::text FROM public.contracts WHERE id = pg_temp.id(p_c) $$;
GRANT EXECUTE ON FUNCTION pg_temp.status(text) TO PUBLIC;
CREATE FUNCTION pg_temp.pending(p_c text, p_month date) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.list_pending_missed_services()
                  WHERE contract_id = pg_temp.id(p_c) AND missed_month = p_month)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.pending(text, date) TO PUBLIC;
-- การเข้าชดเชยที่ผูกเดือน (จำลอง save_makeup_service_visit: เปิดด่าน aga.makeup_link ของการเข้านี้)
CREATE FUNCTION pg_temp.mk(p_v text, p_c text, p_date date, p_for date) RETURNS text LANGUAGE sql AS $$
  SELECT format('WITH g AS (SELECT set_config(''aga.makeup_link'', %L, true) AS x)
                 INSERT INTO public.visits (id, contract_id, visit_date, visit_type, start_time, end_time, makeup_for_month)
                 SELECT %L, %L, %L, ''routine'', ''09:00'', ''10:00'', %L FROM g',
                pg_temp.id(p_v), pg_temp.id(p_v), pg_temp.id(p_c), p_date, p_for)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.mk(text, text, date, date) TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Pause Alpha (สมมติ)'),
  (pg_temp.id('c2'), (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Pause Beta (สมมติ)');

-- k1 พัก/กลับมาต่อ · k2 เทียบ (ไม่พัก) · k3 จบอายุแล้ว (ชดเชยเกินอายุ) · k4 ยกเลิกระหว่างพัก · k5 มีหมายเหตุ · k6 ปิดแล้ว
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at, status) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'P-1', pg_temp.m(-6),  12, 24000, pg_temp.m(-6) + 2,  'active'),
  (pg_temp.id('d2'), pg_temp.id('c2'), 'P-2', pg_temp.m(-6),  12, 36000, pg_temp.m(-6) + 2,  'active'),
  (pg_temp.id('d3'), pg_temp.id('c1'), 'P-3', pg_temp.m(-14), 12, 24000, pg_temp.m(-14) + 2, 'active'),
  (pg_temp.id('d4'), pg_temp.id('c2'), 'P-4', pg_temp.m(-6),  12, 24000, pg_temp.m(-6) + 2,  'active'),
  (pg_temp.id('d5'), pg_temp.id('c2'), 'P-5', pg_temp.m(-6),  12, 24000, pg_temp.m(-6) + 2,  'active'),
  (pg_temp.id('d6'), pg_temp.id('c2'), 'P-6', pg_temp.m(-6),  12, 24000, pg_temp.m(-6) + 2,  'closed');
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  (pg_temp.id('e1'), pg_temp.id('d1'), pg_temp.m(-6) + 9, 'routine', '09:00', '10:00'),
  (pg_temp.id('e2'), pg_temp.id('d1'), pg_temp.m(-5) + 9, 'routine', '09:00', '10:00'),
  (pg_temp.id('e3'), pg_temp.id('d2'), pg_temp.m(-2) + 9, 'routine', '09:00', '10:00');
INSERT INTO stations (id, contract_id, type, station_no, status) VALUES
  (pg_temp.id('s1'), pg_temp.id('d1'), 'IG', 1, 'active');
INSERT INTO missed_service_notes (contract_id, missed_month, note) VALUES
  (pg_temp.id('d5'), pg_temp.m(-3), 'ลูกค้าไม่อยู่ (สมมติ)');

-- =====================================================================
-- โครงสร้าง
-- =====================================================================
SELECT ok('paused' = ANY (enum_range(NULL::contract_status)::text[]), 'contract_status has the paused value');
SELECT has_table('public', 'contract_pauses', 'contract_pauses table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contract_pauses'::regclass), 'RLS is on for contract_pauses');
SELECT ok(NOT has_table_privilege('anon', 'public.contract_pauses', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.contract_pauses', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.contract_pauses', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.contract_pauses', 'DELETE'),
  'anon cannot read contract_pauses · users cannot write it directly');
SELECT has_column('public', 'missed_service_resolutions', 'origin', 'missed_service_resolutions.origin exists');
SELECT ok(NOT has_function_privilege('anon', 'public.pause_contract(uuid, date, text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.resume_contract(uuid, date)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.list_paused_contracts(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.list_pause_makeups(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.contract_month_paused(uuid, date)', 'EXECUTE'),
  'anon cannot execute the pause RPCs / helper');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contracts_pause_status_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.visits_pause_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.missed_resolutions_pause_origin()', 'EXECUTE'),
  'trigger functions are not callable directly');
SELECT ok(has_table_privilege('anon', 'public.v_paused_branch_summary', 'SELECT'),
  'anon can read the aggregate v_paused_branch_summary (like v_branch_summary)');

-- =====================================================================
-- พักสัญญา: สิทธิ์ + ด่าน
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a5');
SELECT throws_ok(pg_temp.pause('d1', pg_temp.m(-4) + 9), '42501', NULL, 'viewer cannot pause');
SELECT pg_temp.as_user('a4');
SELECT throws_ok(pg_temp.pause('d1', pg_temp.m(-4) + 9), '42501', NULL, 'admin out of scope (province) cannot pause a central contract');
SELECT pg_temp.as_user('a3');
SELECT throws_ok(pg_temp.pause('d1', pg_temp.m(-4) + 9, '   '), 'CP003', NULL, 'reason is required');
SELECT throws_ok(pg_temp.pause('d1', pg_temp.td() + 1), 'CP004', NULL, 'pause start cannot be in the future');
SELECT throws_ok(pg_temp.pause('d1', pg_temp.m(-7)), 'CP004', NULL, 'pause start cannot be before the contract start');
SELECT throws_ok(pg_temp.pause('d1', pg_temp.m(-4) + 9), 'CP004', NULL, 'recorder cannot backdate a pause before the previous month (host only)');
SELECT throws_ok(pg_temp.pause('d6', pg_temp.m(-1)), 'CP001', NULL, 'a closed contract cannot be paused');
-- recorder พักได้ในเดือนก่อนหน้า/เดือนนี้ (สัญญา d2 มี routine เดือน m(-2) → เริ่มพักได้ m(-1))
SELECT lives_ok(pg_temp.pause('d2', pg_temp.m(-1)), 'recorder in scope pauses a contract from the previous month');
SELECT is((SELECT paused_by FROM contract_pauses WHERE contract_id = pg_temp.id('d2')),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'recorder can read the pause row · paused_by recorded');
SELECT lives_ok(pg_temp.resume('d2', pg_temp.m(-1)), 'recorder resumes it (same-day pause/resume = no paused month)');
SELECT is(pg_temp.status('d2'), 'active', 'd2 back to active');
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.pause('d1', pg_temp.m(-5) + 20), 'CP005', NULL, 'a month that already has a routine visit cannot be paused');
SELECT throws_ok(pg_temp.pause('d5', pg_temp.m(-4) + 1), 'CP006', NULL, 'a month with a missed-service note cannot be paused');
SELECT lives_ok(pg_temp.pause('d1', pg_temp.m(-4) + 9), 'host pauses the contract (backdated)');
SELECT is(pg_temp.status('d1'), 'paused', 'status is paused');
SELECT throws_ok(pg_temp.pause('d1', pg_temp.m(-3)), 'CP002', NULL, 'a paused contract cannot be paused again');

-- สถานะเปลี่ยนตรงไม่ได้ (REST)
SELECT throws_ok($$UPDATE contracts SET status = 'active' WHERE id = pg_temp.id('d1')$$,
  'CP008', NULL, 'host cannot un-pause by editing status directly');
SELECT throws_ok($$UPDATE contracts SET status = 'paused' WHERE id = pg_temp.id('d2')$$,
  'CP008', NULL, 'host cannot pause by editing status directly');
SELECT throws_ok($$UPDATE contracts SET status = 'expired_pending_collection' WHERE id = pg_temp.id('d1')$$,
  'CP008', NULL, 'a paused contract cannot jump to another status directly');
SELECT throws_ok($$UPDATE contracts SET status = 'paused' WHERE id = pg_temp.id('d5')$$,
  'CP008', NULL, 'host cannot pause a contract directly');
SELECT pg_temp.as_user('a2');
SELECT throws_ok($$INSERT INTO contracts (customer_id, contract_no, start_date, term_months, value_total, sale_type, status)
                   VALUES (pg_temp.id('c1'), 'P-X', pg_temp.m(0), 12, 1000, 'new', 'paused')$$,
  'CP008', NULL, 'admin cannot insert a contract as paused');
RESET ROLE;

-- ระหว่างพัก
SELECT throws_ok($$INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time)
                   VALUES (pg_temp.id('d1'), pg_temp.m(-2) + 3, 'routine', '09:00', '10:00')$$,
  'CP009', NULL, 'a routine visit cannot be recorded in a paused month');
SELECT lives_ok($$INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time)
                  VALUES (pg_temp.id('e9'), pg_temp.id('d1'), pg_temp.m(-2) + 3, 'problem', '09:00', '10:00')$$,
  'a problem visit can still be recorded while paused');
SELECT throws_ok($$UPDATE visits SET visit_type = 'routine' WHERE id = pg_temp.id('e9')$$,
  'CP009', NULL, 'turning a visit in a paused month into routine is refused');
SELECT throws_ok($$UPDATE stations SET collected_at = now() WHERE id = pg_temp.id('s1')$$,
  'CP010', NULL, 'IG of a paused contract cannot be collected');
SELECT throws_ok($$UPDATE stations SET not_collected_on = pg_temp.td(), not_collected_reason = 'x' WHERE id = pg_temp.id('s1')$$,
  'CP010', NULL, 'IG of a paused contract cannot be marked not collected');
SELECT throws_ok($$INSERT INTO missed_service_resolutions (contract_id, missed_month, kind, reason)
                   VALUES (pg_temp.id('d1'), pg_temp.m(-3), 'waived', 'x')$$,
  'CP012', NULL, 'a paused month cannot be waived');
SELECT throws_ok($$INSERT INTO missed_service_notes (contract_id, missed_month, note)
                   VALUES (pg_temp.id('d1'), pg_temp.m(-3), 'x')$$,
  'CP012', NULL, 'a paused month cannot get a missed-service note');
SELECT throws_ok($$INSERT INTO contract_pauses (contract_id, paused_from, resumed_at, end_kind, reason)
                   VALUES (pg_temp.id('d1'), pg_temp.m(-2), pg_temp.m(-1) + 1, 'resumed', 'x')$$,
  '23P01', NULL, 'overlapping pause periods are refused (EXCLUDE)');
SELECT ok(contract_month_paused(pg_temp.id('d1'), pg_temp.m(-4)) AND contract_month_paused(pg_temp.id('d1'), pg_temp.m(0))
          AND NOT contract_month_paused(pg_temp.id('d1'), pg_temp.m(-5)),
  'open pause: every month from the start month is paused');

-- ตกบริการ + รายการ
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a3');
SELECT ok(NOT pg_temp.pending('d1', pg_temp.m(-4)) AND NOT pg_temp.pending('d1', pg_temp.m(-1)),
  'paused months are not pending missed services');
SELECT ok(pg_temp.pending('d2', pg_temp.m(-4)), 'the unpaused contract still has its missed month');
SELECT is((SELECT count(*)::int FROM list_paused_contracts() WHERE contract_id = pg_temp.id('d1')), 1,
  'list_paused_contracts shows the paused contract');
SELECT is((SELECT months_paused FROM list_paused_contracts() WHERE contract_id = pg_temp.id('d1')), 5,
  'months_paused counts the start month to the current month');
SELECT ok((SELECT warn FROM list_paused_contracts() WHERE contract_id = pg_temp.id('d1')), 'warn when paused > 3 months (2.63)');
SELECT pg_temp.as_user('a5');
SELECT throws_ok('SELECT * FROM list_paused_contracts()', '42501', NULL, 'viewer cannot list paused contracts');
RESET ROLE;
SELECT is((SELECT pending_count FROM central_unready_branches(to_char(pg_temp.m(-3), 'YYYY-MM'))
            WHERE branch_id = (SELECT branch_id FROM customers WHERE id = pg_temp.id('c1'))),
  4, 'central_unready_branches skips the paused contract (d2, d3, d4, d6 count · d1 paused · d5 has a note)');

-- /summary (anon)
SET LOCAL ROLE anon;
SELECT is((SELECT paused_contracts FROM v_paused_branch_summary
            WHERE month_key = to_char(pg_temp.m(-4), 'YYYY-MM')
              AND branch_name = (SELECT name FROM branches WHERE division = 'central' ORDER BY name LIMIT 1)),
  1, 'anon: v_paused_branch_summary counts the paused contract in the paused month');
SELECT is((SELECT paused_value FROM v_paused_branch_summary
            WHERE month_key = to_char(pg_temp.m(0), 'YYYY-MM')
              AND branch_name = (SELECT name FROM branches WHERE division = 'central' ORDER BY name LIMIT 1)),
  24000.00::numeric, 'anon: paused value = full contract value (open pause counts to the current month)');
SELECT is((SELECT count(*)::int FROM v_paused_branch_summary WHERE month_key = to_char(pg_temp.m(-5), 'YYYY-MM')),
  0, 'months before the pause are not in the summary');
SELECT throws_ok('SELECT * FROM contract_pauses', '42501', NULL, 'anon cannot read contract_pauses');
RESET ROLE;

-- =====================================================================
-- กลับมาต่อ
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a4');
SELECT throws_ok(pg_temp.resume('d1', pg_temp.m(-1) + 3), '42501', NULL, 'admin out of scope cannot resume');
SELECT pg_temp.as_user('a2');
SELECT throws_ok(pg_temp.resume('d2', pg_temp.m(-1)), 'CP007', NULL, 'a contract that is not paused cannot be resumed');
SELECT throws_ok(pg_temp.resume('d1', pg_temp.m(-4)), 'CP004', NULL, 'resume date cannot be before the pause start');
SELECT throws_ok(pg_temp.resume('d1', pg_temp.td() + 1), 'CP004', NULL, 'resume date cannot be in the future');
SELECT is((SELECT (public.resume_contract(pg_temp.id('d1'), pg_temp.m(-1) + 3)) ->> 'paused_months'), '3',
  'admin in scope resumes · 3 paused months');
SELECT is(pg_temp.status('d1'), 'active', 'status goes back to active');
SELECT is((SELECT end_kind || '|' || resumed_by::text FROM contract_pauses WHERE contract_id = pg_temp.id('d1')),
  'resumed|00000000-0000-0000-0000-0000000000a2', 'pause closed as resumed by the admin');
SELECT pg_temp.as_user('a3');
SELECT ok(NOT pg_temp.pending('d1', pg_temp.m(-2)), 'a paused month stays not missed after resume');
SELECT ok(pg_temp.pending('d1', pg_temp.m(-1)), 'the resume month counts again (missed when no routine)');
SELECT is((SELECT count(*)::int FROM list_pause_makeups() WHERE contract_id = pg_temp.id('d1') AND NOT made_up), 3,
  'list_pause_makeups: 3 paused months to make up');
SELECT is((SELECT count(*)::int FROM list_paused_contracts() WHERE contract_id = pg_temp.id('d1')), 0,
  'resumed contract leaves the paused list');
RESET ROLE;
SELECT ok(NOT contract_month_paused(pg_temp.id('d1'), pg_temp.m(-1)) AND contract_month_paused(pg_temp.id('d1'), pg_temp.m(-2)),
  'closed pause: [start month, resume month)');

-- =====================================================================
-- ชดเชยจากพักสัญญา
-- =====================================================================
SELECT pg_temp.as_user('a3');
SELECT lives_ok(pg_temp.mk('f1', 'd1', pg_temp.m(-1) + 5, pg_temp.m(-4)), 'recorder records a pause make-up within the term');
SELECT is((SELECT origin || '|' || kind::text || '|' || decided_by::text FROM missed_service_resolutions
            WHERE contract_id = pg_temp.id('d1') AND missed_month = pg_temp.m(-4)),
  'pause|makeup|00000000-0000-0000-0000-0000000000a3', 'the make-up is marked as ชดเชยจากพักสัญญา (origin pause) with who');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM list_pause_makeups() WHERE contract_id = pg_temp.id('d1') AND made_up), 1,
  'list_pause_makeups: 1 made up');
SELECT is((SELECT makeup_month FROM list_pause_makeups() WHERE contract_id = pg_temp.id('d1') AND paused_month = pg_temp.m(-4)),
  pg_temp.m(-1), 'list_pause_makeups returns the make-up month');
RESET ROLE;
SELECT throws_ok($$UPDATE missed_service_resolutions SET kind = 'waived', makeup_month = NULL, reason = 'x'
                   WHERE contract_id = pg_temp.id('d1') AND missed_month = pg_temp.m(-4)$$,
  'CP012', NULL, 'a pause make-up cannot be turned into a waiver');

-- เกินอายุสัญญา: d3 จบเดือน m(-3) · พัก m(-5)…m(-4) (กลับ m(-3))
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.pause('d3', pg_temp.m(-5) + 1), 'host pauses an expiring contract');
SELECT lives_ok(pg_temp.resume('d3', pg_temp.m(-3) + 1), 'host resumes it');
SELECT pg_temp.as_user('a3');
SELECT throws_ok(pg_temp.mk('f2', 'd3', pg_temp.m(-1) + 2, pg_temp.m(-5)),
  'CP011', NULL, 'recorder cannot make up a paused month after the original term');
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.mk('f3', 'd3', pg_temp.m(-1) + 2, pg_temp.m(-5)), 'host can (override after the term)');

-- ยกเลิกระหว่างพัก
SELECT lives_ok(pg_temp.pause('d4', pg_temp.m(-2) + 1), 'host pauses d4');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT lives_ok($$UPDATE contracts SET status = 'cancelled' WHERE id = pg_temp.id('d4')$$,
  'admin can cancel a paused contract directly');
RESET ROLE;
SELECT is((SELECT end_kind FROM contract_pauses WHERE contract_id = pg_temp.id('d4')), 'cancelled',
  'cancelling closes the pause as cancelled (not a resume)');
SELECT is((SELECT resumed_by FROM contract_pauses WHERE contract_id = pg_temp.id('d4')),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'who cancelled is kept');
SELECT throws_ok(pg_temp.pause('d4', pg_temp.td()), 'CP001', NULL, 'a cancelled contract cannot be paused');

-- host ยกเลิกการยกเลิก → คืนเป็นพักเท่านั้น (ผลตรวจ M2)
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$UPDATE contracts SET status = 'active' WHERE id = pg_temp.id('d4')$$,
  'CP008', NULL, 'un-cancelling a contract cancelled while paused cannot make it active');
SELECT lives_ok($$UPDATE contracts SET status = 'paused' WHERE id = pg_temp.id('d4')$$,
  'host restores it as paused');
SELECT ok((SELECT resumed_at IS NULL AND end_kind IS NULL FROM contract_pauses WHERE contract_id = pg_temp.id('d4'))
          AND pg_temp.status('d4') = 'paused'
          AND (SELECT cancelled_at IS NULL FROM contracts WHERE id = pg_temp.id('d4')),
  'the pause period is reopened · cancelled_at cleared');

-- ค่า session ปลอมไม่ช่วยข้ามด่าน (ผลตรวจ L1) · viewer ไม่ได้ผลจาก helper (L3)
SELECT set_config('aga.contract_pause', pg_temp.id('d5')::text, true);
SELECT throws_ok($$UPDATE contracts SET status = 'paused' WHERE id = pg_temp.id('d5')$$,
  'CP008', NULL, 'a spoofed session setting does not bypass the guard');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a5');
SELECT ok(NOT contract_month_paused(pg_temp.id('d4'), pg_temp.m(0)), 'viewer always gets false from contract_month_paused');
RESET ROLE;

-- audit
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'contract_pauses' AND action = 'insert'
                   AND new_data ->> 'contract_id' = pg_temp.id('d1')::text),
  'pauses are recorded in audit_log');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'contracts' AND contract_id = pg_temp.id('d1')
                   AND old_data ->> 'status' = 'active' AND new_data ->> 'status' = 'paused'),
  'the status change is recorded in audit_log with contract_id');

SELECT * FROM finish();
ROLLBACK;
