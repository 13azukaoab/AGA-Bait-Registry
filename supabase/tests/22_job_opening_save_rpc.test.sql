-- save_job_opening / delete_job_opening + customers.name_key (20261112110000)
-- เจ้าของเลือก 12 พ.ย. 2026: บันทึกเป็นก้อนเดียว · กันลูกค้าซ้ำแบบ "เตือน + ต้องยืนยัน" · รองรับแก้แถว
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(51);

-- =====================================================================
-- โครงสร้าง + สิทธิ์
-- =====================================================================
SELECT has_column('public', 'customers', 'name_key', 'customers.name_key exists');
SELECT is(public.customer_name_key(U&'  คุณ  สมชาย\200B  '), 'คุณ สมชาย',
  'name_key: trims, collapses spaces, drops zero-width space');
SELECT is(public.customer_name_key('ABC   Co.'), 'abc co.', 'name_key: lower-cases latin letters');
SELECT is(public.customer_name_key(U&'บริษัท\00A0เอ'), 'บริษัท เอ', 'name_key: NBSP counts as a space');
SELECT is(public.customer_name_key('คุณสมชาย'), 'คุณสมชาย', 'name_key: does not strip title prefixes');
SELECT has_index('public', 'customers', 'customers_branch_name_key_idx', 'index on (branch_id, name_key)');

SELECT has_function('public', 'save_job_opening', 'save_job_opening exists');
SELECT has_function('public', 'delete_job_opening', ARRAY['uuid'], 'delete_job_opening(uuid) exists');
SELECT isnt_definer('public', 'save_job_opening', 'save_job_opening is SECURITY INVOKER (RLS applies)');
SELECT isnt_definer('public', 'delete_job_opening', ARRAY['uuid'], 'delete_job_opening is SECURITY INVOKER');

SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')),
  'anon cannot execute save_job_opening')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'save_job_opening';
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')),
  'anon cannot execute delete_job_opening')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'delete_job_opening';
SELECT ok(bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'authenticated can execute save_job_opening')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'save_job_opening';
SELECT ok(bool_and(p.prosrc LIKE '%pg_advisory_xact_lock%'),
  'save_job_opening serializes same-name inserts with an advisory lock')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'save_job_opening';

-- =====================================================================
-- seed (postgres = ข้าม RLS)
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host2@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}'),
  -- host ที่ division_scope มีแค่ส่วนกลาง: สิทธิ์ host ไม่ขึ้นกับขอบเขต ด่านล้มเร็วต้องไม่บล็อก
  ('00000000-0000-0000-0000-0000000000a4', 'host2',    'user_a4', 'host',     '{central}');

CREATE TEMP TABLE _s AS
  SELECT (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1) AS central_id,
         (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1) AS province_id,
         (SELECT array_agg(id ORDER BY code) FROM (SELECT id, code FROM teams ORDER BY code LIMIT 3) t) AS team_ids;
GRANT SELECT ON _s TO PUBLIC;

-- ลูกค้าต่างจังหวัด (สำหรับทดสอบเลือกลูกค้าผิดสาขา)
INSERT INTO customers (id, branch_id, name, customer_type) VALUES
  ('00000000-0000-0000-0000-0000000000c9', (SELECT province_id FROM _s), 'ลูกค้าต่างจังหวัด', 'house');

-- =====================================================================
-- admin (ส่วนกลาง) สร้างใหม่
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

SELECT lives_ok($$
  SELECT * FROM public.save_job_opening(
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := 'ลูกค้า ทดสอบ',
    p_customer_type := 'house', p_contract_no := 'T-1', p_start_date := '2026-01-15',
    p_end_date := '2027-01-14', p_term_years := 1, p_value_total := 50000, p_sale_type := 'new',
    p_team_ids := (SELECT team_ids[1:2] FROM _s), p_mail_received_date := '2026-01-10',
    p_is_urgent := true, p_note := 'ทดสอบ')
$$, 'admin saves customer + contract + teams in one call');

-- ชื่อเดียวกันแต่เว้นวรรคต่าง → ต้องถามก่อน (AG001) และไม่มีอะไรถูกบันทึก
SELECT throws_ok($$
  SELECT * FROM public.save_job_opening(
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := '  ลูกค้า    ทดสอบ ',
    p_customer_type := 'house', p_contract_no := 'T-2', p_start_date := '2026-02-01',
    p_end_date := '2027-01-31', p_term_years := 1, p_value_total := 50000, p_sale_type := 'new')
$$, 'AG001', NULL, 'same normalized name in the branch asks for confirmation (AG001)');

-- ยืนยันว่าเป็นคนละราย → สร้างลูกค้าใหม่ได้
SELECT lives_ok($$
  SELECT * FROM public.save_job_opening(
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := 'ลูกค้า ทดสอบ',
    p_customer_type := 'house', p_contract_no := 'T-2', p_start_date := '2026-02-01',
    p_end_date := '2027-01-31', p_term_years := 1, p_value_total := 50000, p_sale_type := 'new',
    p_confirm_new_customer := true)
$$, 'confirming "different customer" creates a second customer with the same name');

-- ลูกค้านอกสาขา → AG002
SELECT throws_ok($$
  SELECT * FROM public.save_job_opening(
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := 'x',
    p_customer_type := 'house', p_contract_no := 'T-X2', p_start_date := '2026-02-01',
    p_end_date := '2027-01-31', p_term_years := 1, p_value_total := 50000, p_sale_type := 'new',
    p_customer_id := '00000000-0000-0000-0000-0000000000c9')
$$, 'AG002', NULL, 'choosing a customer from another branch is refused (AG002)');

-- admin ส่วนกลางสร้างในสาขาต่างจังหวัด → RLS ปฏิเสธ
SELECT throws_ok($$
  SELECT * FROM public.save_job_opening(
    p_branch_id := (SELECT province_id FROM _s), p_customer_name := 'นอกขอบเขต',
    p_customer_type := 'house', p_contract_no := 'T-OUT', p_start_date := '2026-02-01',
    p_end_date := '2027-01-31', p_term_years := 1, p_value_total := 50000, p_sale_type := 'new')
$$, '42501', NULL, 'admin outside their division is refused by RLS (42501)');

-- ก้อนเดียวจริง: ทีมผิด (FK ล้มตอนท้าย) → ลูกค้า/สัญญาที่สร้างไปก่อนต้องหายหมด
SELECT throws_ok($$
  SELECT * FROM public.save_job_opening(
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := 'อะตอม ทดสอบ',
    p_customer_type := 'house', p_contract_no := 'T-ATOM', p_start_date := '2026-02-01',
    p_end_date := '2027-01-31', p_term_years := 1, p_value_total := 50000, p_sale_type := 'new',
    p_team_ids := ARRAY['00000000-0000-0000-0000-00000000dead']::uuid[])
$$, '23503', NULL, 'a bad team id fails the whole call');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM customers WHERE name_key = 'ลูกค้า ทดสอบ'), 2,
  'two customers named ลูกค้า ทดสอบ (the AG001 attempt left nothing)');
SELECT is((SELECT count(*)::int FROM contracts WHERE contract_no = 'T-1'), 1, 'contract T-1 saved');
SELECT is((SELECT is_urgent FROM contracts WHERE contract_no = 'T-1'), true, 'M9 field is_urgent saved');
SELECT is((SELECT count(*)::int FROM contract_teams ct JOIN contracts c ON c.id = ct.contract_id
            WHERE c.contract_no = 'T-1'), 2, 'two teams saved for T-1');
SELECT is((SELECT count(*)::int FROM customers WHERE name = 'อะตอม ทดสอบ'), 0,
  'atomic: customer from the failed call is not left behind');
SELECT is((SELECT count(*)::int FROM contracts WHERE contract_no = 'T-ATOM'), 0,
  'atomic: contract from the failed call is not left behind');
SELECT is((SELECT count(*)::int FROM contracts WHERE contract_no = 'T-OUT'), 0,
  'nothing saved for the out-of-scope call');

-- =====================================================================
-- ใช้ลูกค้าเดิม · คืนประเภทเดิมให้หน้าจอเตือน · ไม่เขียนทับประเภท
-- =====================================================================
CREATE TEMP TABLE _c AS
  SELECT c.customer_id AS t1_customer, c.id AS t1_contract
    FROM contracts c WHERE c.contract_no = 'T-1';
GRANT SELECT ON _c TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

SELECT results_eq($$
  SELECT reused_customer, existing_customer_type FROM public.save_job_opening(
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := 'ไม่ใช้ชื่อนี้',
    p_customer_type := 'condo', p_contract_no := 'T-3', p_start_date := '2026-03-01',
    p_end_date := '2027-02-28', p_term_years := 1, p_value_total := 60000, p_sale_type := 'new',
    p_customer_id := (SELECT t1_customer FROM _c))
$$, $$VALUES (true, 'house'::text)$$,
  'reusing a customer returns reused_customer = true and the existing customer type');

RESET ROLE;
SELECT is((SELECT customer_type FROM customers WHERE id = (SELECT t1_customer FROM _c)), 'house',
  'reusing a customer does not overwrite its type');

-- =====================================================================
-- โหมดแก้แถว
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

SELECT lives_ok($$
  SELECT * FROM public.save_job_opening(
    p_contract_id := (SELECT t1_contract FROM _c),
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := 'ignored in edit',
    p_customer_type := 'house', p_contract_no := 'T-1', p_start_date := '2026-01-15',
    p_end_date := '2027-01-14', p_term_years := 1, p_value_total := 55000, p_sale_type := 'new',
    p_team_ids := (SELECT team_ids[2:3] FROM _s),
    p_expected_updated_at := (SELECT updated_at FROM contracts WHERE id = (SELECT t1_contract FROM _c)))
$$, 'admin edits a saved contract');

RESET ROLE;
SELECT is((SELECT value_total FROM contracts WHERE contract_no = 'T-1'), 55000.00::numeric,
  'edit updates the contract value');
SELECT set_eq(
  $$SELECT ct.team_id FROM contract_teams ct WHERE ct.contract_id = (SELECT t1_contract FROM _c)$$,
  $$SELECT unnest(team_ids[2:3]) FROM _s$$,
  'edit replaces the team set (removed team gone, new team added)');
SELECT is((SELECT count(*)::int FROM customers WHERE name = 'ignored in edit'), 0,
  'edit does not create a customer from the name');

-- recorder แก้สัญญาไม่ได้ (RLS ปล่อย 0 แถวแบบเงียบ → function ต้องแปลงเป็น 42501)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$
  SELECT * FROM public.save_job_opening(
    p_contract_id := (SELECT t1_contract FROM _c),
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := 'x',
    p_customer_type := 'house', p_contract_no := 'T-1', p_start_date := '2026-01-15',
    p_end_date := '2027-01-14', p_term_years := 1, p_value_total := 1, p_sale_type := 'new',
    p_expected_updated_at := (SELECT updated_at FROM contracts WHERE id = (SELECT t1_contract FROM _c)))
$$, '42501', NULL, 'recorder cannot edit a contract (silent RLS no-op becomes 42501)');
SELECT throws_ok($$
  SELECT * FROM public.save_job_opening(
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := 'หัวหน้างานสร้าง',
    p_customer_type := 'house', p_contract_no := 'T-REC', p_start_date := '2026-02-01',
    p_end_date := '2027-01-31', p_term_years := 1, p_value_total := 50000, p_sale_type := 'new')
$$, '42501', NULL, 'recorder cannot open a job');
RESET ROLE;
SELECT is((SELECT value_total FROM contracts WHERE contract_no = 'T-1'), 55000.00::numeric,
  'value unchanged after the refused recorder edit');

-- โหมดแก้: ห้ามย้ายสัญญาไปสาขาอื่น (host ข้ามด่านขอบเขตได้ จึงไปถึงด่านนี้)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$
  SELECT * FROM public.save_job_opening(
    p_contract_id := (SELECT t1_contract FROM _c),
    p_branch_id := (SELECT province_id FROM _s), p_customer_name := 'x',
    p_customer_type := 'house', p_contract_no := 'T-1', p_start_date := '2026-01-15',
    p_end_date := '2027-01-14', p_term_years := 1, p_value_total := 55000, p_sale_type := 'new',
    p_customer_id := '00000000-0000-0000-0000-0000000000c9')
$$, 'AG006', NULL, 'edit cannot move a contract to another branch (AG006)');

-- host ที่ขอบเขตมีแค่ส่วนกลาง ยังเปิดงานต่างจังหวัดได้ (สิทธิ์ host ไม่ขึ้นกับ division_scope)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT lives_ok($$
  SELECT * FROM public.save_job_opening(
    p_branch_id := (SELECT province_id FROM _s), p_customer_name := 'ลูกค้า host ต่างจังหวัด',
    p_customer_type := 'house', p_contract_no := 'T-HOST', p_start_date := '2026-02-01',
    p_end_date := '2027-01-31', p_term_years := 1, p_value_total := 50000, p_sale_type := 'new')
$$, 'host is not blocked by the fast scope check');
RESET ROLE;
SELECT is((SELECT c.customer_id FROM contracts c WHERE c.contract_no = 'T-1'),
  (SELECT t1_customer FROM _c), 'the refused branch move left the contract with its customer');
SELECT ok(public.customer_name_key(U&'a\200Bb\00A0c') = 'ab c',
  'name_key handles escaped invisible characters (zero-width removed, NBSP to space)');

-- =====================================================================
-- ลบ
-- =====================================================================
-- T-1 มีผลบริการ · T-2 ถูกยกเลิก
INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time)
  VALUES ((SELECT t1_contract FROM _c), '2026-02-10', 'routine', '09:00', '10:00');
UPDATE contracts SET status = 'cancelled', cancelled_at = now() WHERE contract_no = 'T-2';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

SELECT throws_ok($$SELECT public.delete_job_opening((SELECT t1_contract FROM _c))$$,
  'AG003', NULL, 'a contract with service results cannot be deleted (AG003)');
SELECT throws_ok($$SELECT public.delete_job_opening((SELECT id FROM contracts WHERE contract_no = 'T-2'))$$,
  'AG005', NULL, 'a cancelled contract cannot be deleted (AG005)');
SELECT throws_ok($$SELECT public.delete_job_opening('00000000-0000-0000-0000-00000000beef')$$,
  'AG004', NULL, 'an unknown contract gives AG004');
SELECT lives_ok($$SELECT public.delete_job_opening((SELECT id FROM contracts WHERE contract_no = 'T-3'))$$,
  'admin deletes a contract without service results');

-- ลูกค้าที่มีสัญญาเดียว: ลบสัญญาแล้วลูกค้าหายด้วย
SELECT lives_ok($$
  SELECT * FROM public.save_job_opening(
    p_branch_id := (SELECT central_id FROM _s), p_customer_name := 'ลูกค้าสัญญาเดียว',
    p_customer_type := 'house', p_contract_no := 'T-SOLO', p_start_date := '2026-04-01',
    p_end_date := '2027-03-31', p_term_years := 1, p_value_total := 40000, p_sale_type := 'new')
$$, 'admin opens a single-contract job');
SELECT lives_ok($$SELECT public.delete_job_opening((SELECT id FROM contracts WHERE contract_no = 'T-SOLO'))$$,
  'admin deletes the single contract');

-- recorder ลบไม่ได้
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.delete_job_opening((SELECT id FROM contracts WHERE contract_no = 'T-2'))$$,
  NULL, NULL, 'recorder cannot delete a contract');

-- anon เรียกไม่ได้
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.delete_job_opening('00000000-0000-0000-0000-00000000beef')$$,
  '42501', NULL, 'anon is refused at the GRANT gate');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM contracts WHERE contract_no = 'T-3'), 0, 'T-3 deleted');
SELECT is((SELECT count(*)::int FROM customers WHERE id = (SELECT t1_customer FROM _c)), 1,
  'customer with other contracts is kept');
SELECT is((SELECT count(*)::int FROM customers WHERE name = 'ลูกค้าสัญญาเดียว'), 0,
  'customer with no contracts left is deleted together');

SELECT * FROM finish();
ROLLBACK;
