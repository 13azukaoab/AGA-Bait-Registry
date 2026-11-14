-- B1: role backup_reader (20261114100000) — อ่านอย่างเดียว สำหรับงานสำรองข้อมูล
-- seed ด้วย postgres แล้ว SET LOCAL ROLE backup_reader เพื่อทดสอบสิทธิ์จริง
BEGIN;
SELECT plan(23);

-- ---------- โครงสร้างของ role ----------
SELECT ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_reader'), 'role backup_reader exists');
SELECT ok(NOT (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication
                 FROM pg_roles WHERE rolname = 'backup_reader'),
  'not superuser / createdb / createrole / replication');
SELECT ok((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'backup_reader'),
  'BYPASSRLS (pg_dump ต้องข้าม RLS)');
SELECT ok(pg_has_role('backup_reader', 'pg_read_all_data', 'MEMBER'), 'member of pg_read_all_data');
SELECT ok(NOT pg_has_role('backup_reader', 'pg_write_all_data', 'MEMBER'), 'NOT member of pg_write_all_data');
SELECT ok((SELECT rolconfig @> ARRAY['default_transaction_read_only=on'] FROM pg_roles WHERE rolname = 'backup_reader'),
  'default_transaction_read_only = on');
SELECT ok(NOT has_table_privilege('anon', 'public.customers', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.audit_log', 'INSERT'),
  'anon / authenticated ไม่ได้สิทธิ์เพิ่มจาก migration นี้');
SELECT ok(NOT pg_has_role('anon', 'backup_reader', 'MEMBER')
      AND NOT pg_has_role('authenticated', 'backup_reader', 'MEMBER'),
  'anon / authenticated ไม่ได้เป็นสมาชิก backup_reader');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('backup_reader', p.oid, 'EXECUTE')),
  0, 'backup_reader ไม่มี EXECUTE บน SECURITY DEFINER function ใดใน public');

-- ---------- seed ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'host', 'bk_host', 'host', '{central,province}');
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000b2',
   (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Backup cust');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, status) VALUES
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2', 'BK-1', '2026-01-15', 1, 50000, 'active');

-- ---------- อ่านได้ ----------
-- postgres สร้าง role นี้ จึงมี ADMIN OPTION แต่ไม่มีสิทธิ์ SET ROLE (PG16+) — ให้เฉพาะใน transaction ของเทส (ROLLBACK ท้ายไฟล์)
GRANT backup_reader TO postgres WITH SET TRUE;
SET LOCAL ROLE backup_reader;
SELECT is((SELECT count(*)::int FROM customers WHERE name = 'Backup cust'), 1,
  'อ่าน customers ได้ แม้ RLS เปิด (BYPASSRLS)');
SELECT is((SELECT count(*)::int FROM contracts WHERE contract_no = 'BK-1'), 1, 'อ่าน contracts ได้');
SELECT is((SELECT count(*)::int FROM audit_log) > 0, true, 'อ่าน audit_log ได้');
SELECT is((SELECT count(*)::int FROM auth.users WHERE email = 'bk@test.local'), 1, 'อ่าน auth.users ได้');
SELECT is((SELECT count(*)::int FROM storage.buckets WHERE id = 'contract-files'), 1, 'อ่าน storage.buckets ได้');
SELECT lives_ok($$SELECT count(*) FROM storage.objects$$, 'อ่าน storage.objects ได้ (วัดพื้นที่)');

-- ---------- เขียนไม่ได้ ----------
SELECT throws_ok($$INSERT INTO zones (name, sort_order) VALUES ('bk-zone', 9999)$$, '42501', NULL, 'INSERT ไม่ได้');
SELECT throws_ok($$UPDATE customers SET name = 'x'$$, '42501', NULL, 'UPDATE ไม่ได้');
SELECT throws_ok($$DELETE FROM customers$$, '42501', NULL, 'DELETE ไม่ได้');
SELECT throws_ok($$TRUNCATE customers CASCADE$$, '42501', NULL, 'TRUNCATE ไม่ได้');
SELECT throws_ok($$DELETE FROM auth.users$$, '42501', NULL, 'DELETE auth.users ไม่ได้');
SELECT throws_ok($$DELETE FROM storage.objects$$, '42501', NULL, 'DELETE storage.objects ไม่ได้');
SELECT throws_ok($$CREATE TABLE public.bk_zz (a int)$$, '42501', NULL, 'CREATE TABLE ไม่ได้');
-- เรียก RPC ที่เขียนข้อมูล: function ใน public ถอด EXECUTE จาก PUBLIC แล้ว (20261111090500)
SELECT throws_ok(
  $$SELECT public.delete_job_opening('00000000-0000-0000-0000-0000000000b3')$$,
  '42501', NULL, 'เรียก RPC เขียนข้อมูลไม่ได้');

SELECT * FROM finish();
ROLLBACK;
