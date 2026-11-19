-- M41 (20261115290000): contracts.import_batch — สัญญานำเข้าทะเบียนเดิมไม่ขึ้นรายการ Renew ไม่ผูก (M28b)
--   * โครงสร้าง: คอลัมน์ / CHECK รูปแบบ / trigger / function guard เรียกตรงไม่ได้
--   * list_unlinked_renewals: Renew ไม่ผูกที่นำเข้า (service_role) ถูกซ่อน · ที่เปิดในแอป (NULL) ยังขึ้น · host + admin
--   * ผู้ใช้ล็อกอิน (host / admin / recorder) ตั้งค่าตอน INSERT ไม่ได้ · เปลี่ยน/ล้างตอน UPDATE ไม่ได้ → AG020
--   * service_role / postgres ตั้ง/แก้ได้ · audit_log เก็บค่า
-- ข้อมูลสมมติทั้งหมด (ไม่ใช่ข้อมูลลูกค้าจริง)
BEGIN;
SELECT plan(36);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}');

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
CREATE FUNCTION pg_temp.bc() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.bc() TO PUBLIC;
CREATE FUNCTION pg_temp.bp() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.bp() TO PUBLIC;
CREATE FUNCTION pg_temp.listed(p_c text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.list_unlinked_renewals() WHERE contract_id = pg_temp.id(p_c))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.listed(text) TO PUBLIC;
CREATE FUNCTION pg_temp.batch(p_c text) RETURNS text LANGUAGE sql AS $$
  SELECT import_batch FROM public.contracts WHERE id = pg_temp.id(p_c)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.batch(text) TO PUBLIC;
-- INSERT สัญญา New (ถูกกฎอื่นทุกข้อ → แยก AG020 ได้ชัด) ด้วย import_batch ที่กำหนด
CREATE FUNCTION pg_temp.ins(p_c text, p_cust text, p_batch text) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type, import_batch)
                 VALUES (%L, %L, %L, %L, 12, 24000, %L, %L)',
                pg_temp.id(p_c), pg_temp.id(p_cust), 'T-' || p_c, '2027-01-01', 'new', p_batch)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ins(text, text, text) TO PUBLIC;
CREATE FUNCTION pg_temp.upd(p_c text, p_batch text) RETURNS text LANGUAGE sql AS $$
  SELECT format('UPDATE public.contracts SET import_batch = %L WHERE id = %L', p_batch, pg_temp.id(p_c))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.upd(text, text) TO PUBLIC;

INSERT INTO customers (id, branch_id, name) VALUES
  (pg_temp.id('c1'), pg_temp.bc(), 'Alpha (สมมติ)'),
  (pg_temp.id('c2'), pg_temp.bp(), 'Beta province (สมมติ)');

-- Renew ไม่ผูกที่เปิดในแอป (import_batch NULL · ข้อมูลเก่า: postgres ไม่บังคับเหตุผล)
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type) VALUES
  (pg_temp.id('a1'), pg_temp.id('c1'), 'U-1', '2026-10-01', 12, 24000, 'renew'),
  (pg_temp.id('a2'), pg_temp.id('c2'), 'U-P', '2026-10-01', 12, 24000, 'renew');

-- =====================================================================
-- โครงสร้าง
-- =====================================================================
SELECT has_column('public', 'contracts', 'import_batch', 'contracts.import_batch exists');
SELECT col_is_null('public', 'contracts', 'import_batch', 'import_batch is nullable (NULL = entered in the app)');
SELECT has_trigger('public', 'contracts', 'contracts_zz_import_batch_guard', 'import_batch guard trigger exists');
SELECT ok(NOT has_function_privilege('authenticated', 'public.contracts_import_batch_guard()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.contracts_import_batch_guard()', 'EXECUTE'),
  'guard function is not callable directly');
SELECT is((SELECT array_agg(tgname::text ORDER BY tgname::text) FILTER (WHERE tgname::text > 'contracts_zz_import_batch_guard')
             FROM pg_trigger
            WHERE tgrelid = 'public.contracts'::regclass AND NOT tgisinternal
              AND (tgtype & 2) = 2),                                   -- BEFORE triggers
  NULL::text[], 'the import_batch guard is the last BEFORE trigger (existing errors still win)');

-- CHECK รูปแบบ (postgres ข้าม trigger guard แต่ CHECK ยังบังคับ)
SELECT throws_ok(pg_temp.ins('x1', 'c1', ''), '23514', NULL, 'blank import_batch is rejected (CHECK)');
SELECT throws_ok(pg_temp.ins('x2', 'c1', 'registry OCT26'), '23514', NULL, 'import_batch with a space is rejected (CHECK)');
SELECT throws_ok(pg_temp.ins('x3', 'c1', repeat('a', 65)), '23514', NULL, 'import_batch longer than 64 chars is rejected (CHECK)');
SELECT lives_ok(pg_temp.ins('x4', 'c1', repeat('a', 64)), '64-char import_batch is accepted');

-- =====================================================================
-- service_role (ตัวนำเข้า) ตั้งค่าได้ · audit ลง
-- =====================================================================
SET LOCAL ROLE service_role;
SELECT lives_ok(
  format('INSERT INTO public.contracts (id, customer_id, contract_no, start_date, term_months, value_total, sale_type, import_batch)
          VALUES (%L, %L, %L, %L, 12, 24000, %L, %L), (%L, %L, %L, %L, 12, 24000, %L, %L), (%L, %L, %L, %L, 12, 24000, %L, %L)',
         pg_temp.id('b1'), pg_temp.id('c1'), 'I-1', '2026-10-01', 'renew', 'registry-OCT26',
         pg_temp.id('b2'), pg_temp.id('c2'), 'I-P', '2026-10-01', 'renew', 'registry-OCT26',
         pg_temp.id('b3'), pg_temp.id('c1'), 'I-N', '2026-10-01', 'new',   'registry-OCT26'),
  'service_role inserts imported contracts (unlinked Renew + New) with import_batch');
SELECT lives_ok(pg_temp.upd('b3', 'registry-OCT26.v2'), 'service_role can change import_batch');
SELECT lives_ok(pg_temp.upd('b3', 'registry-OCT26'), 'service_role can change it back');
RESET ROLE;
SELECT is(pg_temp.batch('b1'), 'registry-OCT26', 'import_batch is stored for the imported Renew');
SELECT ok(EXISTS (SELECT 1 FROM audit_log
                   WHERE table_name = 'contracts' AND row_id = pg_temp.id('b1') AND action = 'insert'
                     AND new_data->>'import_batch' = 'registry-OCT26'),
  'the imported insert is recorded in audit_log with import_batch');
SELECT lives_ok(pg_temp.upd('x4', 'manual-fix'), 'postgres (DB admin / migration) can set import_batch');

-- =====================================================================
-- list_unlinked_renewals: ซ่อนสัญญานำเข้า · ที่เปิดในแอปยังขึ้น
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT ok(pg_temp.listed('a1') AND pg_temp.listed('a2'), 'host: unlinked Renews entered in the app are still listed');
SELECT ok(NOT pg_temp.listed('b1') AND NOT pg_temp.listed('b2'), 'host: imported unlinked Renews are hidden');
SELECT is((SELECT count(*)::int FROM public.list_unlinked_renewals()), 2, 'host: count = app-entered unlinked Renews only');
SELECT is((SELECT count(*)::int FROM public.list_unlinked_renewals(pg_temp.bc())), 1, 'host: branch filter count excludes imported rows');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT ok(pg_temp.listed('a1') AND NOT pg_temp.listed('b1'), 'admin: app-entered Renew listed · imported Renew hidden');
SELECT is((SELECT count(*)::int FROM public.list_unlinked_renewals()), 1, 'admin (central scope): count = 1');

-- =====================================================================
-- ผู้ใช้ล็อกอินตั้ง/แก้ไม่ได้ → AG020
-- =====================================================================
-- host
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(pg_temp.ins('h1', 'c1', 'registry-OCT26'), 'AG020', NULL, 'host cannot insert a contract with import_batch');
SELECT lives_ok(pg_temp.ins('h2', 'c1', NULL), 'host inserts a normal contract (import_batch NULL) as before');
SELECT throws_ok(pg_temp.upd('h2', 'registry-OCT26'), 'AG020', NULL, 'host cannot set import_batch on an app contract');
SELECT throws_ok(pg_temp.upd('b3', 'other-batch'), 'AG020', NULL, 'host cannot change import_batch');
SELECT throws_ok(pg_temp.upd('b3', NULL), 'AG020', NULL, 'host cannot clear import_batch');
SELECT lives_ok(format('UPDATE public.contracts SET note = %L WHERE id = %L', 'แก้หมายเหตุ', pg_temp.id('b3')),
  'host can still edit other fields of an imported contract');
SELECT is(pg_temp.batch('b3'), 'registry-OCT26', 'import_batch unchanged after host edits');
-- admin (ในขอบเขต)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(pg_temp.ins('m1', 'c1', 'registry-OCT26'), 'AG020', NULL, 'admin cannot insert a contract with import_batch');
SELECT throws_ok(pg_temp.upd('b3', 'other-batch'), 'AG020', NULL, 'admin (in scope) cannot change import_batch');
SELECT throws_ok(pg_temp.upd('b3', NULL), 'AG020', NULL, 'admin (in scope) cannot clear import_batch');
-- recorder (ไม่มีสิทธิ์ UPDATE ตาม RLS → 0 แถว ค่าเดิม · INSERT ติด guard ก่อน RLS WITH CHECK)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(pg_temp.ins('r1', 'c1', 'registry-OCT26'), 'AG020', NULL, 'recorder cannot insert a contract with import_batch');
SELECT lives_ok(pg_temp.upd('b3', NULL), 'recorder update matches no row (no UPDATE policy)');
RESET ROLE;
SELECT is(pg_temp.batch('b3'), 'registry-OCT26', 'import_batch unchanged after admin/recorder attempts');
SELECT is((SELECT count(*)::int FROM contracts WHERE id IN (pg_temp.id('h1'), pg_temp.id('m1'), pg_temp.id('r1'))), 0,
  'refused inserts wrote nothing');
SELECT is(pg_temp.batch('h2'), NULL, 'app contract keeps import_batch NULL');

SELECT * FROM finish();
ROLLBACK;
