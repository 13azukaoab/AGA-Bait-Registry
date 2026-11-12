-- M9: ช่องเปิดงานใน contracts ให้ตรง mockup เปิดงาน FINAL (เจ้าของอนุมัติ 12 พ.ย. 2026)
--   is_urgent · renewed_from_contract_id (+ trigger ลูกค้าคนเดิม) · mail_received_date ·
--   first_service_date / first_service_time · note
-- Role simulation: seed as postgres, then SET LOCAL ROLE authenticated/anon and set
-- request.jwt.claim.sub (what auth.uid() reads). RESET ROLE to inspect as superuser.
BEGIN;
SELECT plan(28);

-- ---------- structure ----------
SELECT has_column('public', 'contracts', 'is_urgent',                'contracts.is_urgent');
SELECT col_not_null('public', 'contracts', 'is_urgent',              'is_urgent NOT NULL');
SELECT col_default_is('public', 'contracts', 'is_urgent', 'false',   'is_urgent defaults to false');
SELECT has_column('public', 'contracts', 'renewed_from_contract_id', 'contracts.renewed_from_contract_id');
SELECT has_column('public', 'contracts', 'mail_received_date',       'contracts.mail_received_date');
SELECT col_type_is('public', 'contracts', 'first_service_date', 'date', 'first_service_date is a date');
SELECT col_type_is('public', 'contracts', 'first_service_time', 'time without time zone',
  'first_service_time is a plain time (Thai local time, no time zone)');
SELECT has_column('public', 'contracts', 'note',                     'contracts.note');
SELECT has_index('public', 'contracts', 'contracts_renewed_from_contract_id_idx',
  'index on renewed_from_contract_id');
SELECT is((SELECT confdeltype FROM pg_constraint WHERE conname = 'contracts_renewed_from_contract_id_fkey'),
  'n'::"char", 'renewed_from_contract_id is ON DELETE SET NULL');
SELECT is_definer('public', 'contracts_renewal_same_customer', ARRAY[]::text[],
  'renewal trigger function is security definer (sees every contract)');
SELECT function_privs_are('public', 'contracts_renewal_same_customer', ARRAY[]::text[], 'anon',
  ARRAY[]::text[], 'anon cannot execute the renewal trigger function');

-- ---------- seed ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'm9_host',  'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'm9_admin', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'm9_rec',   'recorder', '{central}');

INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1), 'Same'),
  ('00000000-0000-0000-0000-0000000000c2', (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1), 'Other'),
  ('00000000-0000-0000-0000-0000000000c3', (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1), 'Prov');
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'M9-OLD',   '2025-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'M9-NEW',   '2026-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c2', 'M9-OTHER', '2025-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c3', 'M9-PROV',  '2026-01-15', 1, 50000);

SELECT ok((SELECT NOT is_urgent AND renewed_from_contract_id IS NULL AND mail_received_date IS NULL
                  AND first_service_date IS NULL AND first_service_time IS NULL AND note IS NULL
             FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'),
  'a contract created without the new fields keeps working (defaults / NULL = รอนัดบริการ)');

-- ---------- CHECK constraints ----------
SELECT throws_ok(
  $$UPDATE contracts SET renewed_from_contract_id = id WHERE id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', NULL, 'a contract cannot be renewed from itself');
SELECT throws_ok(
  $$UPDATE contracts SET first_service_time = '09:30' WHERE id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', NULL, 'first service time without a date is rejected');
SELECT lives_ok(
  $$UPDATE contracts SET first_service_date = '2026-02-01' WHERE id = '00000000-0000-0000-0000-0000000000d2'$$,
  'first service date without a time is allowed');

-- ---------- admin in scope: new fields + renewal of the same customer ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok(
  $$UPDATE contracts
       SET is_urgent = true, renewed_from_contract_id = '00000000-0000-0000-0000-0000000000d1',
           mail_received_date = '2026-01-10', first_service_time = '09:30', note = 'm9 note'
     WHERE id = '00000000-0000-0000-0000-0000000000d2'$$,
  'admin fills the job-opening fields and links the previous contract of the same customer');
SELECT throws_ok(
  $$UPDATE contracts SET renewed_from_contract_id = '00000000-0000-0000-0000-0000000000d3'
     WHERE id = '00000000-0000-0000-0000-0000000000d2'$$,
  'P0001', 'a renewal must link to a contract of the same customer',
  'linking a contract of another customer is rejected (generic message, no other contract data)');
-- admin นอกขอบเขต: RLS กรองจนกระทบ 0 แถว
UPDATE contracts SET note = 'out of scope' WHERE id = '00000000-0000-0000-0000-0000000000d4';
RESET ROLE;
SELECT is((SELECT note FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d4'), NULL,
  'admin cannot write the new fields outside their division');

SELECT results_eq(
  $$SELECT is_urgent, renewed_from_contract_id, mail_received_date, first_service_date, first_service_time, note
      FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'$$,
  $$VALUES (true, '00000000-0000-0000-0000-0000000000d1'::uuid, '2026-01-10'::date,
            '2026-02-01'::date, '09:30'::time, 'm9 note'::text)$$,
  'all six job-opening values are stored');

-- moving the old contract to another customer would break the link -> rejected
SELECT throws_ok(
  $$UPDATE contracts SET customer_id = '00000000-0000-0000-0000-0000000000c2'
     WHERE id = '00000000-0000-0000-0000-0000000000d1'$$,
  'P0001', 'a renewal must link to a contract of the same customer',
  'changing the customer of a contract that was renewed from is rejected');

-- ---------- audit ----------
SELECT ok(
  (SELECT count(*) FROM audit_log
    WHERE table_name = 'contracts' AND action = 'update'
      AND row_id = '00000000-0000-0000-0000-0000000000d2'
      AND new_data->>'note' = 'm9 note' AND new_data->>'is_urgent' = 'true'
      AND changed_by = '00000000-0000-0000-0000-0000000000a2') = 1,
  'editing the new fields is written to audit_log');

-- ---------- recorder: read only ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is((SELECT note FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'), 'm9 note',
  'recorder reads the new fields');
UPDATE contracts SET is_urgent = false WHERE id = '00000000-0000-0000-0000-0000000000d2';
RESET ROLE;
SELECT is((SELECT is_urgent FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'), true,
  'recorder update of contracts affects 0 rows');

-- ---------- host ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(
  $$UPDATE contracts SET is_urgent = true, note = 'host note' WHERE id = '00000000-0000-0000-0000-0000000000d4'$$,
  'host writes the new fields on any contract');
RESET ROLE;

-- ---------- anon: nothing (PDPA) ----------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok($$SELECT note FROM contracts$$, '42501', NULL, 'anon cannot read the new contract fields');
RESET ROLE;

-- ---------- ON DELETE SET NULL ----------
DELETE FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d1';
SELECT is((SELECT renewed_from_contract_id FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'), NULL,
  'deleting the previous contract clears the link (ON DELETE SET NULL)');
SELECT is((SELECT count(*)::int FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'), 1,
  'the renewal contract itself is kept');

SELECT * FROM finish();
ROLLBACK;
