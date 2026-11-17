-- M38 (20261115260000): ช่องว่างหน้าตั้งค่า 3 ข้อ (DECISIONS 2.71)
--   ① customer_types.is_active + hint · ประเภทที่ปิดใช้เลือกให้ลูกค้าใหม่/เปลี่ยนมาใช้ไม่ได้ (CT002) · audit
--   ② preview_tier_rule_change — host · ตัวเลขรวม · สูตรเดียวกับ lib/rules (คู่เทส lib/rules/tierPreviewParity.test.ts)
--   ③ list_notification_read_status — host · ไม่มีเนื้อหา · RLS user_notifications ไม่เปลี่ยน
-- ข้อมูลสมมติทั้งหมด · สัญญาเทสอยู่ปี 2090 (ไม่ปนกับข้อมูลอื่นในเครื่อง)
BEGIN;
SELECT plan(60);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope, position_code) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}', 'pm'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}',          'job_admin'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}',          'supervisor'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer',   'user_a4', 'viewer',   '{central}',          NULL);

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.br() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.br() TO PUBLIC;

CREATE TEMP TABLE _same  (from_tier text, to_tier text, term_group text, contract_count integer);
CREATE TEMP TABLE _moved (from_tier text, to_tier text, term_group text, contract_count integer);
CREATE TEMP TABLE _st    (user_id uuid, has_unread_position_change boolean, unread_count integer,
                          oldest_unread_at timestamptz);
GRANT ALL ON _same, _moved, _st TO PUBLIC;

-- =====================================================================
-- ① customer_types: โครงสร้าง / สิทธิ์
-- =====================================================================
SELECT has_column('public', 'customer_types', 'is_active', 'customer_types.is_active exists');
SELECT col_not_null('public', 'customer_types', 'is_active', 'is_active NOT NULL');
SELECT col_default_is('public', 'customer_types', 'is_active', 'true', 'is_active default true');
SELECT has_column('public', 'customer_types', 'hint', 'customer_types.hint exists');
SELECT is((SELECT count(*)::int FROM customer_types WHERE NOT is_active OR hint IS NOT NULL), 0,
  'existing types: all active, no hint');
SELECT ok(has_column_privilege('authenticated', 'public.customer_types', 'is_active', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.customer_types', 'hint', 'UPDATE'),
  'authenticated has column UPDATE on is_active/hint (RLS limits it to host)');
SELECT has_trigger('public', 'customers', 'customers_customer_type_active_guard', 'guard trigger on customers');
SELECT ok(NOT has_function_privilege('authenticated', 'public.customers_customer_type_active_guard()', 'EXECUTE'),
  'authenticated cannot call the trigger function');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.customers_customer_type_active_guard()'::regprocedure),
  'guard is SECURITY DEFINER (INVOKER would let RLS hide the type row → fail-open)');

-- hint CHECK
SELECT lives_ok($$UPDATE customer_types SET hint = repeat('ก', 120) WHERE code = 'hospital'$$, 'hint 120 chars ok');
SELECT throws_ok($$UPDATE customer_types SET hint = repeat('ก', 121) WHERE code = 'hospital'$$, '23514', NULL,
  'hint 121 chars → 23514');
SELECT throws_ok($$UPDATE customer_types SET hint = '   ' WHERE code = 'hospital'$$, '23514', NULL,
  'blank hint → 23514');
SELECT throws_ok($$UPDATE customer_types SET hint = chr(9) || chr(10) WHERE code = 'hospital'$$, '23514', NULL,
  'tab/newline-only hint → 23514');

-- =====================================================================
-- ① host แก้ตรง (RLS) + audit · role อื่นแก้ไม่ได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$UPDATE customer_types SET is_active = false, hint = 'ทดสอบปิดใช้' WHERE code = 'warehouse'$$,
  'host deactivates a type + sets hint');
RESET ROLE;
SELECT is((SELECT is_active FROM customer_types WHERE code = 'warehouse'), false, 'warehouse now inactive');
SELECT ok(EXISTS (SELECT 1 FROM audit_log
                   WHERE table_name = 'customer_types' AND action = 'update'
                     AND (old_data ->> 'is_active')::boolean = true
                     AND (new_data ->> 'is_active')::boolean = false
                     AND new_data ->> 'hint' = 'ทดสอบปิดใช้'
                     AND changed_by = '00000000-0000-0000-0000-0000000000a1'),
  'deactivation is in audit_log (old/new is_active + hint, changed_by host)');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
UPDATE customer_types SET is_active = false WHERE code = 'school';
RESET ROLE;
SELECT is((SELECT is_active FROM customer_types WHERE code = 'school'), true, 'admin update affects 0 rows (RLS)');

-- =====================================================================
-- ① ด่าน CT002
-- =====================================================================
INSERT INTO customers (id, branch_id, name, customer_type) VALUES
  (pg_temp.id('c1'), pg_temp.br(), 'Test Old Warehouse', NULL);
-- ลูกค้าเดิมที่ใช้ประเภทนี้ก่อนปิดใช้ (เขียนตรงข้ามด่านด้วยการปิด trigger ชั่วคราวไม่ได้ → เปิดประเภทก่อนแล้วปิดใหม่)
UPDATE customer_types SET is_active = true WHERE code = 'warehouse';
INSERT INTO customers (id, branch_id, name, customer_type) VALUES
  (pg_temp.id('c2'), pg_temp.br(), 'Test Existing Warehouse', 'warehouse');
UPDATE customer_types SET is_active = false WHERE code = 'warehouse';

SELECT throws_ok($$INSERT INTO customers (branch_id, name, customer_type)
                   VALUES (pg_temp.br(), 'Test New Warehouse', 'warehouse')$$,
  'CT002', NULL, 'new customer with an inactive type → CT002');
SELECT throws_ok($$UPDATE customers SET customer_type = 'warehouse' WHERE id = pg_temp.id('c1')$$,
  'CT002', NULL, 'change a customer to an inactive type → CT002');
SELECT lives_ok($$UPDATE customers SET customer_type = 'warehouse', name = 'Test Existing Warehouse 2'
                   WHERE id = pg_temp.id('c2')$$,
  'existing customer re-saves the same inactive type + edits name → ok');
SELECT is((SELECT customer_type FROM customers WHERE id = pg_temp.id('c2')), 'warehouse',
  'existing customer keeps the inactive type');
SELECT lives_ok($$UPDATE customers SET customer_type = 'house' WHERE id = pg_temp.id('c2')$$,
  'moving away from an inactive type to an active one → ok');
SELECT throws_ok($$UPDATE customers SET customer_type = 'warehouse' WHERE id = pg_temp.id('c2')$$,
  'CT002', NULL, 'cannot move back to the inactive type');
SELECT lives_ok($$INSERT INTO customers (branch_id, name, customer_type)
                  VALUES (pg_temp.br(), 'Test Active Type', 'house')$$, 'active type → ok');
SELECT lives_ok($$INSERT INTO customers (branch_id, name, customer_type)
                  VALUES (pg_temp.br(), 'Test No Type', NULL)$$, 'NULL type → ok');
SELECT throws_ok($$INSERT INTO customers (branch_id, name, customer_type)
                   VALUES (pg_temp.br(), 'Test Bad Type', 'no_such_type')$$,
  '23503', NULL, 'unknown code still → FK 23503');

-- ผ่าน API ด้วย (host เขียนตรง)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$INSERT INTO customers (branch_id, name, customer_type)
                   VALUES (pg_temp.br(), 'Test API Warehouse', 'warehouse')$$,
  'CT002', NULL, 'API caller (host) also gets CT002');
-- admin: แถวประเภทถูก RLS (UPDATE policy) ซ่อนจากผู้เรียก — ด่านยังต้องปิด
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$INSERT INTO customers (branch_id, name, customer_type)
                   VALUES (pg_temp.br(), 'Test Admin Warehouse', 'warehouse')$$,
  'CT002', NULL, 'API caller (admin) insert with inactive type → CT002');
SELECT throws_ok($$UPDATE customers SET customer_type = 'warehouse' WHERE id = pg_temp.id('c1')$$,
  'CT002', NULL, 'API caller (admin) change to inactive type → CT002');
RESET ROLE;

-- =====================================================================
-- ② preview_tier_rule_change — โครงสร้าง / สิทธิ์
-- =====================================================================
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.preview_tier_rule_change(date, jsonb)'::regprocedure)
          AND (SELECT provolatile = 's' FROM pg_proc WHERE oid = 'public.preview_tier_rule_change(date, jsonb)'::regprocedure)
          AND (SELECT proconfig::text LIKE '%search_path%' FROM pg_proc
                WHERE oid = 'public.preview_tier_rule_change(date, jsonb)'::regprocedure),
  'preview: SECURITY DEFINER + STABLE + pinned search_path');
SELECT ok(NOT has_function_privilege('anon', 'public.preview_tier_rule_change(date, jsonb)', 'EXECUTE'),
  'anon cannot call preview');
SELECT is((SELECT array_agg(a ORDER BY o)::text FROM pg_proc p,
             unnest(p.proargnames, p.proargmodes::text[]) WITH ORDINALITY AS x(a, m, o)
           WHERE p.oid = 'public.preview_tier_rule_change(date, jsonb)'::regprocedure AND x.m = 't'),
  '{from_tier,to_tier,term_group,contract_count}', 'preview returns aggregate columns only');

-- สัญญาเทส (ปี 2090 · ไม่ปนข้อมูลอื่น) — กรณีบังคับ CLAUDE.md
INSERT INTO customers (id, branch_id, name) VALUES (pg_temp.id('c9'), pg_temp.br(), 'Test Tier Parity');
INSERT INTO contracts (customer_id, contract_no, start_date, term_months, value_total, status, cancelled_at) VALUES
  (pg_temp.id('c9'), 'TST-P1', '2090-01-15', 36, 50000,    'active',    NULL),   -- S3
  (pg_temp.id('c9'), 'TST-P2', '2090-01-15', 12, 150000,   'active',    NULL),   -- XL1
  (pg_temp.id('c9'), 'TST-P3', '2090-01-15', 36, 150000,   'active',    NULL),   -- L3
  (pg_temp.id('c9'), 'TST-P4', '2090-01-15', 12, 29999.50, 'active',    NULL),   -- S1
  (pg_temp.id('c9'), 'TST-P5', '2090-01-15', 5,  50000,    'active',    NULL),   -- L1 (Custom → 1 ปี)
  (pg_temp.id('c9'), 'TST-P6', '2090-01-15', 14, 35000,    'active',    NULL),   -- M1 (× 12 ÷ 14 = 30,000 พอดี)
  (pg_temp.id('c9'), 'TST-X1', '2089-01-01', 12, 999999,   'active',    NULL),   -- จบ ธ.ค. 2089 → นอกขอบเขต
  (pg_temp.id('c9'), 'TST-X2', '2090-01-15', 12, 999999,   'cancelled', '2090-01-20 10:00+07'), -- ยกเลิกในเดือน → ไม่นับ
  (pg_temp.id('c9'), 'TST-X3', '2090-01-15', 12, 888888,   'cancelled', NULL),   -- trigger เติม cancelled_at = ตอนนี้ (ก่อน 2090) → ไม่นับ
  (pg_temp.id('c9'), 'TST-X4', '2089-06-01', 12, 200000,   'cancelled', '2090-03-05 10:00+07'); -- ยกเลิกหลังเดือน → นับ (XL1)

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01',
                   '{"min_m": 30000, "min_l": 50000, "min_xl": 100000}')$$, '42501', NULL, 'admin → 42501');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01',
                   '{"min_m": 30000, "min_l": 50000, "min_xl": 100000}')$$, '42501', NULL, 'viewer → 42501');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
-- TR006
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change(NULL, '{"min_m": 1, "min_l": 2, "min_xl": 3}')$$,
  'TR006', NULL, 'NULL month → TR006');
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-15', '{"min_m": 1, "min_l": 2, "min_xl": 3}')$$,
  'TR006', NULL, 'not first-of-month → TR006');
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01', '[1,2,3]')$$,
  'TR006', NULL, 'rules not an object → TR006');
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01', '{"min_m": "30000", "min_l": 50000, "min_xl": 100000}')$$,
  'TR006', NULL, 'string number → TR006');
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01', '{"min_m": 30000, "min_l": 50000}')$$,
  'TR006', NULL, 'missing min_xl → TR006');
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01', '{"min_m": 30000.001, "min_l": 50000, "min_xl": 100000}')$$,
  'TR006', NULL, '3 decimals → TR006');
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01', '{"min_m": 60000, "min_l": 50000, "min_xl": 100000}')$$,
  'TR006', NULL, 'not ascending → TR006');

-- เก็บผลไว้ตรวจหลัง RESET ROLE (ตารางชั่วคราวสร้างโดย postgres ตอนต้น)
INSERT INTO _same
  SELECT * FROM public.preview_tier_rule_change('2090-01-01',
    (SELECT jsonb_build_object('min_m', max(min_annual) FILTER (WHERE tier = 'M'),
                               'min_l', max(min_annual) FILTER (WHERE tier = 'L'),
                               'min_xl', max(min_annual) FILTER (WHERE tier = 'XL'))
       FROM public.tier_rules_for_month('2090-01-01')));
INSERT INTO _moved
  SELECT * FROM public.preview_tier_rule_change('2090-01-01',
    (SELECT jsonb_build_object('min_m', max(min_annual) FILTER (WHERE tier = 'M'),
                               'min_l', 60000,
                               'min_xl', max(min_annual) FILTER (WHERE tier = 'XL'))
       FROM public.tier_rules_for_month('2090-01-01')));
RESET ROLE;

-- ② parity: เกณฑ์เดิม (ชุดตั้งต้น 30,000 / 50,000 / 100,000 — อ่านจาก tier_rules ไม่ hardcode ในฟังก์ชัน)
SELECT is((SELECT array_agg(min_annual ORDER BY min_annual)::text FROM public.tier_rules_for_month('2090-01-01')),
  '{0.00,30000.00,50000.00,100000.00}', 'precondition: rule set for 2090-01 = baseline used by lib/rules fixtures');
SELECT is((SELECT count(*)::int FROM _same WHERE from_tier <> to_tier), 0, 'same rules → nobody moves');
SELECT is((SELECT sum(contract_count)::int FROM _same), 7, 'scope: 6 parity + cancelled-later (out: ended, cancelled-in-month, cancelled-now)');
SELECT results_eq(
  $$SELECT from_tier || term_group, contract_count FROM _same ORDER BY 1$$,
  $$VALUES ('L1', 1), ('L3', 1), ('M1', 1), ('S1', 1), ('S3', 1), ('XL1', 2)$$,
  'parity: S3 (50k/36) · XL1 (150k/12 + cancelled-later 200k/12) · L3 (150k/36) · S1 (29,999.50/12) · L1 (50k/5) · M1 (35k/14)');

-- ② ย้าย tier: L เริ่ม 60,000 → 150k/36 (= 50,000) L3 → M3 · 50k/5 L1 → M1
SELECT results_eq(
  $$SELECT from_tier, to_tier, term_group, contract_count FROM _moved WHERE from_tier <> to_tier ORDER BY term_group$$,
  $$VALUES ('L'::text, 'M'::text, '1'::text, 1), ('L', 'M', '3', 1)$$,
  'L start 60,000 moves L1→M1 (50k/5) and L3→M3 (150k/36)');
SELECT is((SELECT sum(contract_count)::int FROM _moved), 7, 'moved preview counts the same scope');

-- ② helper มูลค่าต่อปี
SELECT is(round(public.contract_annual_value(50000, 36), 2), 16666.67, 'annual 50k/36 = ÷3 (16,666.67)');
SELECT is(public.contract_annual_value(50000, 5), 50000::numeric, 'annual 50k/5 = actual (no scale-up)');
SELECT is(public.contract_annual_value(35000, 14), 30000::numeric, 'annual 35k/14 = 30,000 exactly');
SELECT is(public.contract_annual_value(150000, 12), 150000::numeric, 'annual 150k/12 = 150k');
SELECT is(public.contract_annual_value(36000, 18), 24000::numeric, 'annual 36k/18 = × 12 ÷ 18 (no integer division)');

-- =====================================================================
-- ③ list_notification_read_status
-- =====================================================================
INSERT INTO user_notifications (user_id, kind, payload, created_at, read_at) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'position_changed', '{"secret": "x"}', '2090-01-01 09:00+07', NULL),
  ('00000000-0000-0000-0000-0000000000a2', 'position_changed', '{}',             '2090-01-02 09:00+07', NULL),
  ('00000000-0000-0000-0000-0000000000a3', 'position_changed', '{}',             '2090-01-01 09:00+07', '2090-01-01 10:00+07'),
  ('00000000-0000-0000-0000-0000000000a4', 'other_kind',       '{}',             '2090-01-01 09:00+07', NULL);

SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.list_notification_read_status()'::regprocedure)
          AND (SELECT proconfig::text LIKE '%search_path%' FROM pg_proc
                WHERE oid = 'public.list_notification_read_status()'::regprocedure),
  'read status: SECURITY DEFINER + pinned search_path');
SELECT is((SELECT array_agg(a ORDER BY o)::text FROM pg_proc p,
             unnest(p.proargnames, p.proargmodes::text[]) WITH ORDINALITY AS x(a, m, o)
           WHERE p.oid = 'public.list_notification_read_status()'::regprocedure AND x.m = 't'),
  '{user_id,has_unread_position_change,unread_count,oldest_unread_at}', 'no payload/message column');
SELECT ok(NOT has_function_privilege('anon', 'public.list_notification_read_status()', 'EXECUTE'),
  'anon cannot call read status');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT * FROM public.list_notification_read_status()$$, '42501', NULL, 'recorder → 42501');
-- RLS เดิม: recorder ยังเห็นเฉพาะของตัวเอง
SELECT is((SELECT count(*)::int FROM user_notifications), 1, 'RLS unchanged: recorder sees only own notifications');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT is((SELECT count(*)::int FROM user_notifications), 0, 'RLS unchanged: host does not read others directly');
INSERT INTO _st SELECT * FROM public.list_notification_read_status();
RESET ROLE;

SELECT results_eq(
  $$SELECT user_id, has_unread_position_change, unread_count, oldest_unread_at FROM _st
     WHERE user_id IN ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
                       '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4')
     ORDER BY user_id$$,
  $$VALUES ('00000000-0000-0000-0000-0000000000a1'::uuid, false, 0, NULL::timestamptz),
           ('00000000-0000-0000-0000-0000000000a2'::uuid, true,  2, '2090-01-01 09:00+07'::timestamptz),
           ('00000000-0000-0000-0000-0000000000a3'::uuid, false, 0, NULL::timestamptz),
           ('00000000-0000-0000-0000-0000000000a4'::uuid, false, 0, NULL::timestamptz)$$,
  'per user: unread position_changed only (read / other kinds ignored) + oldest unread');
SELECT is((SELECT count(*)::int FROM _st), (SELECT count(*)::int FROM profiles), 'one row per profile');

SELECT * FROM finish();
ROLLBACK;
