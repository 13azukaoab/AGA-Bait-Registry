-- storage_deletion_queue + trigger บน contract_files + policy อ่าน bucket (20261112110100)
-- หลัก: ฐานข้อมูลเป็นตัวตั้ง — ลบ/เปลี่ยนไฟล์สำเร็จ = path ลงคิว · ลบไม่สำเร็จ = ไม่ลงคิว
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(18);

-- ---------- โครงสร้าง + สิทธิ์ ----------
SELECT has_table('public', 'storage_deletion_queue', 'storage_deletion_queue exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.storage_deletion_queue'::regclass),
  true, 'RLS is enabled on the queue');
SELECT table_privs_are('public', 'storage_deletion_queue', 'anon', ARRAY[]::text[],
  'anon has no privilege on the queue');
SELECT table_privs_are('public', 'storage_deletion_queue', 'authenticated', ARRAY['SELECT'],
  'authenticated may only SELECT (RLS limits it to host)');
SELECT has_trigger('public', 'contract_files', 'contract_files_enqueue_object_delete',
  'trigger on contract_files enqueues removed objects');
SELECT is_definer('public', 'contract_files_enqueue_object_delete', ARRAY[]::text[],
  'enqueue trigger function is security definer (users cannot write the queue)');

-- ---------- seed ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}');

INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1',
   (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Q Cust');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Q-1', '2026-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'Q-2', '2026-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'Q-3', '2026-01-15', 1, 50000);
INSERT INTO contract_files (id, contract_id, kind, storage_path, file_name, mime_type, size_bytes) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', 'contract_pdf',
   '00000000-0000-0000-0000-0000000000d1/one.pdf', 'one.pdf', 'application/pdf', 100),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2', 'contract_pdf',
   '00000000-0000-0000-0000-0000000000d2/two.pdf', 'two.pdf', 'application/pdf', 100),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d3', 'contract_pdf',
   '00000000-0000-0000-0000-0000000000d3/three.pdf', 'three.pdf', 'application/pdf', 100);
-- object ใน bucket: 1 ไฟล์มีแถวอ้างอิง · 1 ไฟล์ไม่มีแถว (รอคิวลบ)
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('contract-files', '00000000-0000-0000-0000-0000000000d3/three.pdf'),
  ('contract-files', '00000000-0000-0000-0000-0000000000d3/orphan.pdf');
-- admin เพิ่งอัปโหลด แต่ยังไม่ได้เขียนแถว (owner_id = ผู้อัปโหลด)
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
  ('contract-files', '00000000-0000-0000-0000-0000000000d3/fresh.pdf', '00000000-0000-0000-0000-0000000000a2');

-- ---------- admin ลบ / เปลี่ยนไฟล์ / ลบสัญญา ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
DELETE FROM contract_files WHERE id = '00000000-0000-0000-0000-0000000000f1';
UPDATE contract_files SET storage_path = '00000000-0000-0000-0000-0000000000d2/two-v2.pdf'
 WHERE id = '00000000-0000-0000-0000-0000000000f2';
DELETE FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2';

SELECT is((SELECT count(*)::int FROM storage_deletion_queue), 0,
  'admin cannot read the queue (host only)');
SELECT throws_ok($$INSERT INTO storage_deletion_queue (bucket, path) VALUES ('contract-files', 'x/y.pdf')$$,
  '42501', NULL, 'authenticated cannot write the queue directly');
SELECT is((SELECT count(*)::int FROM storage.objects
            WHERE bucket_id = 'contract-files' AND name = '00000000-0000-0000-0000-0000000000d3/three.pdf'),
  1, 'staff can read an object that still has a contract_files row');
SELECT is((SELECT count(*)::int FROM storage.objects
            WHERE bucket_id = 'contract-files' AND name = '00000000-0000-0000-0000-0000000000d3/orphan.pdf'),
  0, 'staff cannot read an object with no contract_files row (deleted / waiting for cleanup)');

SELECT is((SELECT count(*)::int FROM storage.objects
            WHERE bucket_id = 'contract-files' AND name = '00000000-0000-0000-0000-0000000000d3/fresh.pdf'),
  1, 'the uploader still sees a fresh upload with no row (so the app can remove it on failure)');

-- recorder ลบไฟล์ไม่ได้ (RLS ไม่ลบแถว) → ต้องไม่ลงคิว
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
DELETE FROM contract_files WHERE id = '00000000-0000-0000-0000-0000000000f3';
SELECT is((SELECT count(*)::int FROM storage.objects
            WHERE bucket_id = 'contract-files' AND name = '00000000-0000-0000-0000-0000000000d3/fresh.pdf'),
  0, 'other staff cannot see someone else''s fresh upload with no row');

-- host อ่านคิวได้
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT ok((SELECT count(*) FROM storage_deletion_queue) > 0, 'host can read the queue');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM storage_deletion_queue
            WHERE path = '00000000-0000-0000-0000-0000000000d1/one.pdf'), 1,
  'deleting a file row enqueues its object');
SELECT is((SELECT count(*)::int FROM storage_deletion_queue
            WHERE path = '00000000-0000-0000-0000-0000000000d2/two.pdf'), 1,
  'replacing a file (new storage_path) enqueues the old object');
SELECT is((SELECT count(*)::int FROM storage_deletion_queue
            WHERE path = '00000000-0000-0000-0000-0000000000d2/two-v2.pdf'), 1,
  'deleting the contract (CASCADE) enqueues its current file');
SELECT is((SELECT count(*)::int FROM storage_deletion_queue
            WHERE path = '00000000-0000-0000-0000-0000000000d3/three.pdf'), 0,
  'a delete refused by RLS enqueues nothing (file still in use)');
SELECT is((SELECT count(*)::int FROM storage_deletion_queue WHERE done_at IS NULL AND attempts = 0
            AND bucket = 'contract-files'), 3,
  'new queue rows start pending (bucket set, no attempts)');

SELECT * FROM finish();
ROLLBACK;
