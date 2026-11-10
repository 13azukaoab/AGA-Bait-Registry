-- M1: contract_files + bucket `contract-files` (20261111090300) — SPEC §6.6
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(34);

-- ---------- structure ----------
SELECT has_table('public', 'contract_files', 'contract_files exists');
SELECT enum_has_labels('public', 'contract_file_kind', ARRAY['contract_pdf', 'site_plan'],
  'kind = contract_pdf / site_plan');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contract_files'::regclass),
  'RLS enabled on contract_files');
SELECT has_trigger('public', 'contract_files', 'audit_contract_files', 'contract_files audited');
SELECT ok(
  (SELECT NOT public AND file_size_limit = 5242880 FROM storage.buckets WHERE id = 'contract-files'),
  'bucket contract-files is private with a 5 MB limit');

-- ---------- privileges ----------
SELECT table_privs_are('public', 'contract_files', 'anon', ARRAY[]::text[],
  'anon has no privilege on contract_files');
SELECT ok(has_table_privilege('authenticated', 'public.contract_files', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated may reach contract_files (RLS decides rows)');

-- ---------- seed ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'cf_host',  'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'cf_admin', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'cf_rec',   'recorder', '{central}');

INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1',
   (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1), 'Central cust'),
  ('00000000-0000-0000-0000-0000000000c2',
   (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1), 'Province cust');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, status) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'CF-1', '2026-01-15', 1, 50000, 'active'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', 'CF-2', '2026-01-15', 1, 50000, 'active'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'CF-3', '2026-01-15', 1, 50000, 'closed');

-- ---------- admin in scope ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

SELECT throws_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes, reason)
    VALUES ('00000000-0000-0000-0000-0000000000d1', 'site_plan', 'd1/sp0.pdf', 'sp0.pdf', 'application/pdf', 1000, 'move')$$,
  'P0001', NULL, 'site plan before the contract PDF is rejected');

SELECT lives_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes)
    VALUES ('00000000-0000-0000-0000-0000000000d1', 'contract_pdf', 'd1/contract.pdf', 'contract.pdf', 'application/pdf', 4000000)$$,
  'admin attaches the contract PDF in scope');
SELECT throws_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes)
    VALUES ('00000000-0000-0000-0000-0000000000d1', 'contract_pdf', 'd1/contract2.pdf', 'contract2.pdf', 'application/pdf', 1000)$$,
  '23505', NULL, 'a second contract PDF row is rejected (replace = update)');
SELECT throws_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes)
    VALUES ('00000000-0000-0000-0000-0000000000d1', 'contract_pdf', 'd1/img.png', 'img.png', 'image/png', 1000)$$,
  '23514', NULL, 'contract PDF must be a PDF');
SELECT throws_ok(
  $$UPDATE contract_files SET size_bytes = 5242881 WHERE storage_path = 'd1/contract.pdf'$$,
  '23514', NULL, 'stored file over 5 MB is rejected');
SELECT throws_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes)
    VALUES ('00000000-0000-0000-0000-0000000000d1', 'site_plan', 'd1/sp-noreason.pdf', 'sp.pdf', 'application/pdf', 1000)$$,
  '23514', NULL, 'site plan without a reason is rejected');

SELECT lives_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes, reason)
    VALUES ('00000000-0000-0000-0000-0000000000d1', 'site_plan', 'd1/sp1.png', 'sp1.png', 'image/png', 2000, 'first change')$$,
  'site plan v1 (PNG allowed)');
SELECT lives_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes, reason, version)
    VALUES ('00000000-0000-0000-0000-0000000000d1', 'site_plan', 'd1/sp2.pdf', 'sp2.pdf', 'application/pdf', 2000, 'moved station', 99)$$,
  'site plan v2 (client version ignored)');
SELECT throws_ok(
  $$UPDATE contract_files SET reason = 'rewrite history' WHERE storage_path = 'd1/sp1.png'$$,
  'P0001', NULL, 'old site plan versions cannot be edited');
SELECT throws_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes)
    VALUES ('00000000-0000-0000-0000-0000000000d2', 'contract_pdf', 'd2/contract.pdf', 'contract.pdf', 'application/pdf', 1000)$$,
  '42501', NULL, 'admin cannot attach files outside their division');
RESET ROLE;

SELECT results_eq(
  $$SELECT version, is_current FROM contract_files
     WHERE contract_id = '00000000-0000-0000-0000-0000000000d1' AND kind = 'site_plan' ORDER BY version$$,
  $$VALUES (1, false), (2, true)$$,
  'versions counted 1, 2 and only the latest is current');
SELECT is((SELECT uploaded_by FROM contract_files WHERE storage_path = 'd1/contract.pdf'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'uploaded_by = the signed-in uploader');

-- deleting the current site plan promotes the previous version
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
DELETE FROM contract_files WHERE storage_path = 'd1/sp2.pdf';
RESET ROLE;
SELECT is((SELECT is_current FROM contract_files WHERE storage_path = 'd1/sp1.png'), true,
  'deleting the current version promotes the latest remaining one');

-- ---------- closed contract: files locked (even for host) ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes)
    VALUES ('00000000-0000-0000-0000-0000000000d3', 'contract_pdf', 'd3/contract.pdf', 'c.pdf', 'application/pdf', 1000)$$,
  'P0001', NULL, 'host cannot attach a file to a closed contract');
RESET ROLE;
UPDATE contracts SET status = 'closed' WHERE id = '00000000-0000-0000-0000-0000000000d1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(
  $$DELETE FROM contract_files WHERE storage_path = 'd1/contract.pdf'$$,
  'P0001', NULL, 'files of a contract that became closed are locked');
RESET ROLE;
UPDATE contracts SET status = 'active' WHERE id = '00000000-0000-0000-0000-0000000000d1';

-- ---------- recorder: read only ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is((SELECT count(*)::int FROM contract_files), 2, 'recorder reads contract files');
SELECT throws_ok(
  $$INSERT INTO contract_files (contract_id, kind, storage_path, file_name, mime_type, size_bytes, reason)
    VALUES ('00000000-0000-0000-0000-0000000000d1', 'site_plan', 'd1/sp9.pdf', 'sp9.pdf', 'application/pdf', 10, 'x')$$,
  '42501', NULL, 'recorder cannot add files');
RESET ROLE;

SELECT ok((SELECT count(*) FROM audit_log WHERE table_name = 'contract_files') > 0,
  'file changes are written to audit_log');

-- ---------- anon: nothing on the table ----------
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT 1 FROM contract_files$$, '42501', NULL, 'anon cannot read contract_files');
RESET ROLE;

-- ---------- storage bucket ----------
SELECT is(public.storage_contract_id('00000000-0000-0000-0000-0000000000d1/a.pdf'),
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'contract id is read from the first folder');
SELECT is(public.storage_contract_id('not-a-uuid/a.pdf'), NULL, 'bad folder name -> NULL');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('contract-files', '00000000-0000-0000-0000-0000000000d1/contract.pdf')$$,
  'admin uploads into a contract folder in scope');
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('contract-files', '00000000-0000-0000-0000-0000000000d2/contract.pdf')$$,
  '42501', NULL, 'admin cannot upload into a contract outside their division');
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('contract-files', '00000000-0000-0000-0000-0000000000d3/contract.pdf')$$,
  '42501', NULL, 'nobody uploads into a closed contract');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'contract-files'), 1,
  'recorder can read objects in the bucket');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'contract-files'), 0,
  'anon sees no object in the bucket');
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('contract-files', '00000000-0000-0000-0000-0000000000d1/evil.pdf')$$,
  '42501', NULL, 'anon cannot upload into the bucket');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
