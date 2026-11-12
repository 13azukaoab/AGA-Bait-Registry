-- migration ก้อนแรก 11 พ.ย. 2026: M2 admin ลบ · M3 audit ไม่เก็บ INSERT · M4 province ·
-- M5 onboarding · ถอน EXECUTE ของ anon (20261111090000 – 20261111090500)
BEGIN;
SELECT plan(30);

-- ---------- seed ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec2@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',      'b1_host',  'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',     'b1_admin', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder',  'b1_rec',   'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'recorder2', 'b1_rec2',  'recorder', '{central}');

CREATE TEMP TABLE _b AS
  SELECT (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1) AS cen_id,
         (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1) AS prov_id;
GRANT SELECT ON _b TO authenticated;

INSERT INTO customers (id, branch_id, name) SELECT '00000000-0000-0000-0000-0000000000c1', cen_id,  'Used'  FROM _b;
INSERT INTO customers (id, branch_id, name) SELECT '00000000-0000-0000-0000-0000000000c2', cen_id,  'Empty' FROM _b;
INSERT INTO customers (id, branch_id, name) SELECT '00000000-0000-0000-0000-0000000000c3', prov_id, 'Prov'  FROM _b;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'B1-USED',  '2026-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', 'B1-EMPTY', '2026-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c3', 'B1-PROV',  '2026-01-15', 1, 50000);
INSERT INTO stations (id, contract_id, code, type) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'S-01', 'IG'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'S-02', 'IG'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d2', 'S-01', 'IG');
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-09-10', 'routine', '09:00', '10:00');
INSERT INTO station_checks (id, visit_id, station_id) VALUES
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1');

-- ===================== M2: admin delete (แบบ ก) =====================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$DELETE FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23503', NULL, 'admin cannot delete a contract that has visits');
SELECT throws_ok($$DELETE FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e1'$$,
  '23503', NULL, 'admin cannot delete a station that has station checks');
SELECT lives_ok($$DELETE FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e2'$$,
  'admin deletes a station without checks');
SELECT throws_ok($$DELETE FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23503', NULL, 'admin cannot delete a customer that still has a contract');
SELECT lives_ok($$DELETE FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d2'$$,
  'admin removes the stations of an unused contract');
SELECT lives_ok($$DELETE FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'$$,
  'admin deletes an unused contract');
SELECT lives_ok($$DELETE FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c2'$$,
  'admin deletes a customer with no contract left');
-- นอกขอบเขตหน่วยงาน: RLS กรองจนกระทบ 0 แถว
DELETE FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d3';
RESET ROLE;

SELECT is((SELECT count(*)::int FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d3'), 1,
  'admin delete outside their division affects 0 rows');
SELECT is((SELECT count(*)::int FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f1'), 1,
  'service results are never removed by a cascade');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE action = 'delete' AND changed_by = '00000000-0000-0000-0000-0000000000a2'
              AND table_name IN ('customers', 'contracts', 'stations')),
  4, 'every admin delete is in audit_log (2 stations + contract + customer)');

-- recorder still cannot delete customers / contracts / stations
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
DELETE FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e1';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM stations WHERE id = '00000000-0000-0000-0000-0000000000e1'), 1,
  'recorder delete of a station affects 0 rows');

-- ===================== M3: audit ไม่เก็บ INSERT ของผลบริการ =====================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
INSERT INTO visits (id, contract_id, visit_date, visit_type, created_by, start_time, end_time) VALUES
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', '2026-10-05', 'routine',
   '00000000-0000-0000-0000-0000000000a4', '09:00', '10:00');  -- พยายามใส่ชื่อคนอื่น
INSERT INTO station_checks (id, visit_id, station_id) VALUES
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name IN ('visits', 'station_checks') AND action = 'insert'),
  0, 'INSERT of visits / station_checks is not audited');
SELECT is((SELECT created_by FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f2'),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'visits.created_by = the real signed-in user (cannot be spoofed)');
SELECT is((SELECT created_by FROM station_checks WHERE id = '00000000-0000-0000-0000-000000000a02'),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'station_checks.created_by = the signed-in user');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
UPDATE visits SET note = 'fixed', created_by = '00000000-0000-0000-0000-0000000000a4'
 WHERE id = '00000000-0000-0000-0000-0000000000f2';
UPDATE station_checks SET note = 'fixed' WHERE id = '00000000-0000-0000-0000-000000000a02';
RESET ROLE;

SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name IN ('visits', 'station_checks') AND action = 'update'
              AND changed_by = '00000000-0000-0000-0000-0000000000a4'),
  2, 'UPDATE of visits / station_checks is still audited');
SELECT is((SELECT created_by FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f2'),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'an edit keeps the original created_by');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
DELETE FROM station_checks WHERE id = '00000000-0000-0000-0000-000000000a02';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'station_checks' AND action = 'delete'),
  1, 'DELETE of station_checks is still audited');

-- ===================== M4: province =====================
SELECT enum_has_labels('public', 'closure_scope', ARRAY['central', 'province'],
  'closure_scope labels are central / province');
SELECT is((SELECT count(*)::int FROM pg_enum WHERE enumlabel = 'provincial'), 0,
  'no enum label "provincial" left anywhere');
SELECT lives_ok($$INSERT INTO month_closures (month_key, scope) VALUES ('2026-08', 'province')$$,
  'a province closure can be stored');

-- ===================== M5: onboarding =====================
SELECT has_column('public', 'profiles', 'onboarding_completed_at', 'profiles.onboarding_completed_at');
SELECT has_column('public', 'profiles', 'onboarding_skipped_at', 'profiles.onboarding_skipped_at');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT public.skip_onboarding();
SELECT public.complete_onboarding();
-- ผู้ใช้เขียน profiles ของคนอื่นตรงๆ ไม่ได้ (policy เดิม: host เท่านั้น)
UPDATE profiles SET onboarding_completed_at = now() WHERE user_id = '00000000-0000-0000-0000-0000000000a4';
RESET ROLE;

SELECT ok((SELECT onboarding_completed_at IS NOT NULL AND onboarding_skipped_at IS NULL
             FROM profiles WHERE user_id = '00000000-0000-0000-0000-0000000000a3'),
  'own onboarding completed (skip flag cleared)');
SELECT ok((SELECT onboarding_completed_at IS NULL AND onboarding_skipped_at IS NULL
             FROM profiles WHERE user_id = '00000000-0000-0000-0000-0000000000a4'),
  'another user onboarding is untouched');
SELECT is_definer('public', 'complete_onboarding', ARRAY[]::text[], 'complete_onboarding is security definer');

-- ===================== anon cannot execute any public function =====================
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                       WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')),
  0, 'anon can execute no function in schema public');
SELECT ok(has_function_privilege('authenticated', 'public.contract_in_scope(uuid)', 'EXECUTE'),
  'authenticated still executes the scope helpers');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.current_app_role()$$, '42501', NULL, 'anon cannot call current_app_role()');
SELECT lives_ok($$SELECT count(*) FROM v_branch_summary$$,
  'anon still reads v_branch_summary after the revoke');
-- M6 ค (20261111100100): ตาราง snapshot ปิดสำหรับ anon แล้ว อ่านทาง view เท่านั้น
SELECT throws_ok($$SELECT count(*) FROM monthly_branch_snapshots$$, '42501', NULL,
  'anon reads snapshots only through the view (table denied)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
