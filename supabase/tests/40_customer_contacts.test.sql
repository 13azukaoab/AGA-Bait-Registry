-- M19a (20261115150000): customers.note · customer_phones · save_customer_contact · ข้ามทีม
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(71);

-- =====================================================================
-- โครงสร้าง + สิทธิ์ระดับ GRANT / function
-- =====================================================================
SELECT has_table('public', 'customer_phones', 'customer_phones exists');
SELECT has_column('public', 'customers', 'note', 'customers.note exists');
SELECT has_column('public', 'customers', 'contact_cross_team', 'customers.contact_cross_team exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customer_phones'::regclass), true,
  'RLS on customer_phones');
SELECT has_trigger('public', 'customer_phones', 'audit_customer_phones', 'audit trigger on customer_phones');
SELECT is((SELECT p.proname::text FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE tg.tgrelid = 'public.customer_phones'::regclass AND tg.tgname = 'audit_customer_phones'),
  'audit_trigger', 'audit_customer_phones executes the shared public.audit_trigger()');
SELECT is_definer('public', 'save_customer_contact', ARRAY['jsonb'], 'save_customer_contact is SECURITY DEFINER');
SELECT ok(NOT has_function_privilege('anon', 'public.save_customer_contact(jsonb)', 'EXECUTE'),
  'anon cannot call save_customer_contact');
SELECT ok(NOT has_function_privilege('anon', 'public.customer_contact_is_cross_team(uuid)', 'EXECUTE'),
  'anon cannot call customer_contact_is_cross_team');
SELECT ok(NOT has_function_privilege('authenticated', 'public.customer_team_ids(uuid)', 'EXECUTE'),
  'customer_team_ids is internal only');
SELECT ok(NOT has_table_privilege('anon', 'public.customer_phones', 'SELECT'),
  'anon has no SELECT grant on customer_phones (two-layer rule)');
SELECT ok(NOT has_table_privilege('anon', 'public.customer_phones', 'INSERT'),
  'anon has no INSERT grant on customer_phones');

-- =====================================================================
-- seed
--   c1 ส่วนกลาง ทีม A (contract_teams) · c2 ส่วนกลาง ยังไม่มีทีม · c3 ต่างจังหวัด
--   ra = recorder ทีม A · rb = recorder ทีม B · ro = recorder ขอบเขตต่างจังหวัดเท่านั้น
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000019a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h@m19a.local'),
  ('00000000-0000-0000-0000-0000000019a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ad@m19a.local'),
  ('00000000-0000-0000-0000-0000000019a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ra@m19a.local'),
  ('00000000-0000-0000-0000-0000000019a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rb@m19a.local'),
  ('00000000-0000-0000-0000-0000000019a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ro@m19a.local'),
  ('00000000-0000-0000-0000-0000000019a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v@m19a.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope, team_id) VALUES
  ('00000000-0000-0000-0000-0000000019a1', 'host',  'm19a_h',  'host',     '{central,province}', NULL),
  ('00000000-0000-0000-0000-0000000019a2', 'admin', 'm19a_ad', 'admin',    '{central}',          NULL),
  ('00000000-0000-0000-0000-0000000019a3', 'recA',  'm19a_ra', 'recorder', '{central}',          (SELECT id FROM teams WHERE code = 'A')),
  ('00000000-0000-0000-0000-0000000019a4', 'recB',  'm19a_rb', 'recorder', '{central}',          (SELECT id FROM teams WHERE code = 'B')),
  ('00000000-0000-0000-0000-0000000019a5', 'recO',  'm19a_ro', 'recorder', '{province}',         (SELECT id FROM teams WHERE code = 'A')),
  ('00000000-0000-0000-0000-0000000019a6', 'view',  'm19a_v',  'viewer',   '{}',                 NULL);

INSERT INTO customers (id, branch_id, name, contact_name) VALUES
  ('00000000-0000-0000-0000-0000000019c1', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'C1', 'คุณเดิม'),
  ('00000000-0000-0000-0000-0000000019c2', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'C2', NULL),
  ('00000000-0000-0000-0000-0000000019c3', (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1), 'C3', NULL);
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  ('00000000-0000-0000-0000-0000000019d1', '00000000-0000-0000-0000-0000000019c1', 'M19A-1', '2026-01-15', 1, 50000);
INSERT INTO contract_teams (contract_id, team_id) VALUES
  ('00000000-0000-0000-0000-0000000019d1', (SELECT id FROM teams WHERE code = 'A'));
INSERT INTO customer_phones (id, customer_id, phone, label, sort_order) VALUES
  ('00000000-0000-0000-0000-0000000019f1', '00000000-0000-0000-0000-0000000019c1', '02-111-2222', 'สำนักงาน', 1),
  ('00000000-0000-0000-0000-0000000019f3', '00000000-0000-0000-0000-0000000019c3', '053-111-222', NULL, 1);

-- =====================================================================
-- RLS อ่าน: host / admin / recorder (ในและนอกขอบเขต) เห็น · viewer 0 แถว · anon ถูกปฏิเสธ
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a1', true);
SELECT is((SELECT count(*)::int FROM customer_phones), 2, 'host reads all phones');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a2', true);
SELECT is((SELECT count(*)::int FROM customer_phones), 2, 'admin reads phones of every branch (like customers)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a3', true);
SELECT is((SELECT count(*)::int FROM customer_phones), 2, 'recorder in scope reads phones');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a5', true);
SELECT is((SELECT count(*)::int FROM customer_phones), 2, 'recorder out of scope still reads (read = all branches)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a6', true);
SELECT is((SELECT count(*)::int FROM customer_phones), 0, 'viewer reads no phones (PDPA)');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1', 'note', 'x'))$$,
  '42501', NULL, 'viewer cannot call save_customer_contact');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok($$SELECT count(*) FROM public.customer_phones$$, '42501', NULL, 'anon is refused at the grant layer');
RESET ROLE;

-- =====================================================================
-- เขียนตรงผ่าน REST
-- =====================================================================
SET LOCAL ROLE authenticated;
-- host
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a1', true);
SELECT lives_ok($$INSERT INTO customer_phones (customer_id, phone) VALUES ('00000000-0000-0000-0000-0000000019c3', '053-999-000')$$,
  'host inserts a phone directly');
SELECT throws_ok($$UPDATE customer_phones SET customer_id = '00000000-0000-0000-0000-0000000019c2'
                    WHERE id = '00000000-0000-0000-0000-0000000019f1'$$,
  '42501', NULL, 'a phone cannot be moved to another customer');
-- admin
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a2', true);
SELECT lives_ok($$INSERT INTO customer_phones (id, customer_id, phone) VALUES
                    ('00000000-0000-0000-0000-0000000019f2', '00000000-0000-0000-0000-0000000019c1', '081-222-3333')$$,
  'admin inserts a phone for an in-scope customer');
SELECT throws_ok($$INSERT INTO customer_phones (customer_id, phone) VALUES ('00000000-0000-0000-0000-0000000019c3', '053-777-000')$$,
  '42501', NULL, 'admin cannot insert a phone for an out-of-scope customer');
SELECT lives_ok($$UPDATE customers SET contact_name = 'คุณแอดมิน', contact_cross_team = true,
                    contact_updated_by = '00000000-0000-0000-0000-0000000019a4'
                  WHERE id = '00000000-0000-0000-0000-0000000019c1'$$,
  'admin still edits customers directly');
-- recorder: ไม่มีทางเขียนตรง
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a3', true);
SELECT throws_ok($$INSERT INTO customer_phones (customer_id, phone) VALUES ('00000000-0000-0000-0000-0000000019c1', '089-000-1111')$$,
  '42501', NULL, 'recorder cannot insert phones directly');
UPDATE customer_phones SET label = 'hack' WHERE id = '00000000-0000-0000-0000-0000000019f1';
UPDATE customers SET name = 'Hacked', note = 'hack' WHERE id = '00000000-0000-0000-0000-0000000019c1';
DELETE FROM customer_phones WHERE id = '00000000-0000-0000-0000-0000000019f1';
RESET ROLE;
SELECT is((SELECT label FROM customer_phones WHERE id = '00000000-0000-0000-0000-0000000019f1'), 'สำนักงาน',
  'recorder direct UPDATE of a phone changes nothing');
SELECT is((SELECT name FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), 'C1',
  'recorder direct UPDATE of customers changes nothing');
SELECT is((SELECT count(*)::int FROM customer_phones WHERE id = '00000000-0000-0000-0000-0000000019f1'), 1,
  'recorder direct DELETE of a phone changes nothing');
-- guard: admin ปลอมค่า contact_* ไม่ได้ · แก้ contact_name ตรง → ระบบประทับเอง
SELECT is((SELECT contact_cross_team FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), false,
  'direct write cannot set contact_cross_team');
SELECT is((SELECT contact_updated_by FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'),
  '00000000-0000-0000-0000-0000000019a2'::uuid, 'direct contact_name edit is stamped with the real editor');

-- =====================================================================
-- ข้ามทีม: customer_contact_is_cross_team
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a3', true);
SELECT is(public.customer_contact_is_cross_team('00000000-0000-0000-0000-0000000019c1'), false, 'team A recorder: own customer');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a4', true);
SELECT is(public.customer_contact_is_cross_team('00000000-0000-0000-0000-0000000019c1'), true, 'team B recorder: other team customer');
SELECT is(public.customer_contact_is_cross_team('00000000-0000-0000-0000-0000000019c2'), false, 'customer without teams is not cross-team');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a1', true);
SELECT is(public.customer_contact_is_cross_team('00000000-0000-0000-0000-0000000019c1'), false, 'host is never cross-team');

-- =====================================================================
-- save_customer_contact: recorder ทีมเดียวกัน
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a3', true);
SELECT lives_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1',
                    'contact_name', ' คุณใหม่ ', 'note', 'สะดวกวันจันทร์',
                    'name', 'Hacked', 'address', 'Hacked'))$$,
  'same-team recorder saves contact name + note');
RESET ROLE;
SELECT is((SELECT contact_name FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), 'คุณใหม่', 'contact_name saved (trimmed)');
SELECT is((SELECT note FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), 'สะดวกวันจันทร์', 'note saved');
SELECT is((SELECT name FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), 'C1', 'RPC ignores other customer columns (name)');
SELECT is((SELECT address FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), NULL, 'RPC ignores other customer columns (address)');
SELECT is((SELECT contact_cross_team FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), false, 'same team = not cross-team');
SELECT is((SELECT contact_updated_by FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'),
  '00000000-0000-0000-0000-0000000019a3'::uuid, 'contact_updated_by = the recorder');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a3', true);
SELECT lives_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1',
                    'phones_upsert', jsonb_build_array(jsonb_build_object('phone', '089 123 4567', 'label', 'ฝ่ายบัญชี'))))$$,
  'recorder adds a phone through the RPC');
SELECT lives_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1',
                    'phones_upsert', jsonb_build_array(jsonb_build_object(
                      'id', '00000000-0000-0000-0000-0000000019f1', 'phone', '02-111-2299', 'label', 'สำนักงานใหญ่'))))$$,
  'recorder edits an existing phone');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1',
                    'phones_upsert', jsonb_build_array(jsonb_build_object('phone', '0891234567'))))$$,
  'CC003', NULL, 'duplicate phone (same digits) is refused');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1',
                    'phones_upsert', jsonb_build_array(jsonb_build_object('phone', 'abc'))))$$,
  'CC002', NULL, 'invalid phone is refused');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1', 'contact_name', '   '))$$,
  'CC002', NULL, 'empty contact name is refused');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1', 'note', repeat('ก', 301)))$$,
  'CC002', NULL, 'note longer than 300 is refused');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1',
                    'phones_upsert', jsonb_build_array(jsonb_build_object(
                      'id', '00000000-0000-0000-0000-0000000019f3', 'phone', '02-555-5555'))))$$,
  'AG004', NULL, 'cannot edit a phone of another customer by passing a different customer_id');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1',
                    'phones_delete', jsonb_build_array('00000000-0000-0000-0000-0000000019f3')))$$,
  'AG004', NULL, 'cannot delete a phone of another customer');
SELECT lives_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1',
                    'phones_delete', jsonb_build_array('00000000-0000-0000-0000-0000000019f2')))$$,
  'recorder deletes a phone while others remain');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c9', 'note', 'x'))$$,
  'AG004', NULL, 'unknown customer');
-- เบอร์สุดท้าย: c2 (ไม่มีทีม → ไม่ต้องยืนยัน) เพิ่ม 1 เบอร์ แล้วลบ → CC004
SELECT lives_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c2',
                    'phones_upsert', jsonb_build_array(jsonb_build_object('phone', '081-000-0000'))))$$,
  'recorder adds the first phone of a customer without teams (no confirmation)');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c2',
                    'phones_delete', (SELECT jsonb_agg(id) FROM customer_phones
                                       WHERE customer_id = '00000000-0000-0000-0000-0000000019c2')))$$,
  'CC004', NULL, 'the last phone cannot be deleted');

-- recorder นอกขอบเขต
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a5', true);
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1', 'note', 'นอกขอบเขต'))$$,
  '42501', NULL, 'out-of-scope recorder is refused');

-- =====================================================================
-- ข้ามทีม: ไม่ยืนยัน → CC001 ไม่แก้อะไร · ยืนยัน → แก้ได้ + audit
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a4', true);
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1', 'note', 'ทีม B แก้'))$$,
  'CC001', NULL, 'cross-team edit without confirmation is refused');
SELECT throws_ok($$SELECT public.save_customer_contact(jsonb_build_object(
                    'customer_id', '00000000-0000-0000-0000-0000000019c1', 'note', 'ทีม B แก้',
                    'confirm_cross_team', false))$$,
  'CC001', NULL, 'confirm_cross_team = false is refused too');
RESET ROLE;
SELECT is((SELECT note FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), 'สะดวกวันจันทร์',
  'refused cross-team edit changed nothing');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000019a4', true);
SELECT is(public.save_customer_contact(jsonb_build_object(
            'customer_id', '00000000-0000-0000-0000-0000000019c1', 'note', 'ทีม B แก้',
            'confirm_cross_team', true)) ->> 'cross_team', 'true',
  'cross-team edit with confirmation is allowed and reported');
RESET ROLE;
SELECT is((SELECT note FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), 'ทีม B แก้', 'cross-team note saved');
SELECT is((SELECT contact_cross_team FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'), true,
  'customers.contact_cross_team = true after a confirmed cross-team edit');
SELECT ok(EXISTS (SELECT 1 FROM audit_log
                   WHERE table_name = 'customers' AND row_id = '00000000-0000-0000-0000-0000000019c1'
                     AND action = 'update'
                     AND changed_by = '00000000-0000-0000-0000-0000000019a4'
                     AND new_data ->> 'contact_cross_team' = 'true'
                     AND new_data ->> 'note' = 'ทีม B แก้'),
  'confirmed cross-team edit is in audit_log with contact_cross_team = true');

-- =====================================================================
-- audit ของ customer_phones
-- =====================================================================
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'customer_phones' AND action = 'insert'
                     AND changed_by = '00000000-0000-0000-0000-0000000019a3'
                     AND new_data ->> 'phone' = '089 123 4567'),
  'audit_log has the phone insert by the recorder');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'customer_phones' AND action = 'update'
                     AND row_id = '00000000-0000-0000-0000-0000000019f1'
                     AND old_data ->> 'phone' = '02-111-2222' AND new_data ->> 'phone' = '02-111-2299'),
  'audit_log has the phone update (old → new)');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'customer_phones' AND action = 'delete'
                     AND row_id = '00000000-0000-0000-0000-0000000019f2'
                     AND changed_by = '00000000-0000-0000-0000-0000000019a3'),
  'audit_log has the phone delete');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'customer_phones' AND action = 'insert'
                     AND changed_by = '00000000-0000-0000-0000-0000000019a2'
                     AND row_id = '00000000-0000-0000-0000-0000000019f2'),
  'audit_log has the direct admin insert');
SELECT is((SELECT count(*)::int FROM customer_phones WHERE customer_id = '00000000-0000-0000-0000-0000000019c1'), 2,
  'c1 ends with 2 phones (seed + recorder add; admin phone deleted)');

-- =====================================================================
-- บริบทของ audit (audit_trigger เนื้อ M19a = M21 + customer_phones + missed_service_notes)
-- =====================================================================
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name = 'customer_phones'
              AND row_id IN ('00000000-0000-0000-0000-0000000019f1', '00000000-0000-0000-0000-0000000019f2')
              AND branch_id IS DISTINCT FROM (SELECT branch_id FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1')),
  0, 'every customer_phones audit row of c1 carries the customer branch_id');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'customer_phones'
                     AND row_id = '00000000-0000-0000-0000-0000000019f1' AND branch_id IS NOT NULL),
  'customer_phones audit rows have a branch_id (History Log branch filter)');
INSERT INTO missed_service_notes (id, contract_id, missed_month, note) VALUES
  ('00000000-0000-0000-0000-0000000019e1', '00000000-0000-0000-0000-0000000019d1', '2026-03-01', 'ลูกค้าปิดอาคาร');
SELECT results_eq(
  $$SELECT contract_id, branch_id, month_key FROM audit_log
     WHERE table_name = 'missed_service_notes' AND row_id = '00000000-0000-0000-0000-0000000019e1'$$,
  $$SELECT '00000000-0000-0000-0000-0000000019d1'::uuid,
           (SELECT branch_id FROM customers WHERE id = '00000000-0000-0000-0000-0000000019c1'),
           '2026-03'::text$$,
  'missed_service_notes audit row has contract_id + branch_id + month_key');
SELECT matches(pg_get_functiondef('public.audit_trigger()'::regprocedure), 'actor_position_code',
  'audit_trigger keeps the M21 actor_position_code');
SELECT matches(pg_get_functiondef('public.audit_trigger()'::regprocedure), 'missed_service_notes',
  'audit_trigger is the M19a body (has missed_service_notes)');

SELECT * FROM finish();
ROLLBACK;
