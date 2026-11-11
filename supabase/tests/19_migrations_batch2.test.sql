-- migration ก้อนสอง 11 พ.ย. 2026 (20261111100000, 20261111100100)
--   ① ลบสัญญาเปล่าแล้วสถานีหายตาม (CASCADE) · ผลบริการ/ผลตรวจยังกันการลบ
--   M6 (ค) anon อ่าน snapshot ทาง view เท่านั้น · (จ) ยอดรายงานต้องตรง + ปิดได้เฉพาะเดือนที่จบแล้ว
--      (ก)(ข) เขียน snapshot ได้เฉพาะ host / service_role · (ง) แก้ผู้ปิด/เวลาปิดได้ มีประวัติ
BEGIN;
SELECT plan(26);

-- ---------- seed ----------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'b2_host',  'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'b2_admin', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'b2_rec',   'recorder', '{central}');

CREATE TEMP TABLE _b AS
  SELECT (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1) AS cen_id,
         (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1) AS prov_id;

INSERT INTO customers (id, branch_id, name) SELECT '00000000-0000-0000-0000-0000000000c1', cen_id, 'B2' FROM _b;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'B2-EMPTY',  '2026-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'B2-VISIT',  '2026-01-15', 1, 50000),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'B2-CHECK',  '2026-01-15', 1, 50000);
INSERT INTO stations (id, contract_id, code, type) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'S-01', 'IG'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'S-02', 'IC'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d2', 'S-01', 'IG'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d3', 'S-01', 'IG');
-- d2: มีการเข้าบริการ แต่ไม่มีผลตรวจสถานี
INSERT INTO visits (id, contract_id, visit_date, visit_type) VALUES
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2', '2026-09-10', 'routine'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d3', '2026-09-10', 'routine');
-- d3: มีผลตรวจสถานี 1 แถว
INSERT INTO station_checks (id, visit_id, station_id) VALUES
  ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e4');

-- ===================== ① cascade =====================
SELECT fk_ok('public', 'stations', 'contract_id', 'public', 'contracts', 'id', 'stations -> contracts FK');
SELECT is((SELECT confdeltype FROM pg_constraint WHERE conname = 'stations_contract_id_fkey'), 'c'::"char",
  'stations -> contracts is ON DELETE CASCADE');
SELECT is((SELECT confdeltype FROM pg_constraint WHERE conname = 'visits_contract_id_fkey'), 'r'::"char",
  'visits -> contracts stays RESTRICT');
SELECT is((SELECT confdeltype FROM pg_constraint WHERE conname = 'station_checks_station_id_fkey'), 'r'::"char",
  'station_checks -> stations stays RESTRICT');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT lives_ok($$DELETE FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d1'$$,
  'admin deletes an empty contract that still has stations');
SELECT throws_ok($$DELETE FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23503', NULL, 'contract with a visit cannot be deleted (stations not removed either)');
SELECT throws_ok($$DELETE FROM contracts WHERE id = '00000000-0000-0000-0000-0000000000d3'$$,
  '23503', NULL, 'contract whose station has a check cannot be deleted');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM stations WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'), 0,
  'stations of the deleted contract are gone');
SELECT is((SELECT count(*)::int FROM stations WHERE id IN ('00000000-0000-0000-0000-0000000000e3',
                                                            '00000000-0000-0000-0000-0000000000e4')), 2,
  'stations of the blocked contracts are untouched (whole delete rolled back)');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE table_name = 'stations' AND action = 'delete'
              AND contract_id = '00000000-0000-0000-0000-0000000000d1'), 2,
  'stations removed by the cascade are written to audit_log');

-- ===================== M6 (ค) anon reads snapshots through the view only =====================
INSERT INTO monthly_branch_snapshots
  (month_key, branch_id, source, s1, v_s1, cust, value, report_cust, report_value, confirmed_at)
SELECT '2026-09', prov_id, 'manual', 2, 30000, 2, 30000, 2, 30000, now() FROM _b;

SELECT table_privs_are('public', 'monthly_branch_snapshots', 'anon', ARRAY[]::text[],
  'anon has no privilege on the snapshot table');
SELECT hasnt_column('public', 'v_branch_summary', 'report_cust',  'view hides report_cust');
SELECT hasnt_column('public', 'v_branch_summary', 'confirmed_by', 'view hides confirmed_by');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok($$SELECT report_cust FROM monthly_branch_snapshots$$, '42501', NULL,
  'anon cannot read report_cust from the table');
SELECT is((SELECT count(*)::int FROM v_branch_summary WHERE month_key = '2026-09'), 1,
  'anon still reads the summary view (/summary page)');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is((SELECT report_cust FROM monthly_branch_snapshots WHERE month_key = '2026-09'), 2,
  'signed-in staff still read the full snapshot row');

-- ===================== M6 (ก)(ข) only host / service_role write snapshots =====================
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source)
    SELECT '2026-08', cen_id, 'computed' FROM _b$$,
  '42501', NULL, 'recorder cannot write a snapshot by hand');
RESET ROLE;

-- ===================== M6 (จ) report totals must match the 8 tiers =====================
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, s3, report_cust)
    SELECT '2026-08', prov_id, 'manual', 1, 1, 3 FROM _b$$,
  '23514', NULL, 'manual row: report_cust different from the 8-tier count is rejected');
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, v_m3, report_value)
    SELECT '2026-08', prov_id, 'manual', 1, 1000, 500, 1000 FROM _b$$,
  '23514', NULL, 'manual row: report_value different from the 8-tier value is rejected');
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1)
    SELECT '2026-07', prov_id, 'manual', 1, 1000 FROM _b$$,
  'manual row without report totals can be saved (not compared yet)');
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, report_cust)
    SELECT '2026-07', cen_id, 'computed', 1, 99 FROM _b$$,
  'computed rows are not checked against report totals');

-- ===================== M6 (จ) close only months that have ended (Asia/Bangkok) =====================
SELECT throws_ok(
  format($$INSERT INTO month_closures (month_key, scope) VALUES (%L, 'central')$$,
         to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')),
  'P0001', NULL, 'the current Bangkok month cannot be closed');
SELECT throws_ok(
  format($$INSERT INTO month_closures (month_key, scope) VALUES (%L, 'central')$$,
         to_char((now() AT TIME ZONE 'Asia/Bangkok') + interval '1 month', 'YYYY-MM')),
  'P0001', NULL, 'a future month cannot be closed');
SELECT lives_ok(
  format($$INSERT INTO month_closures (month_key, scope) VALUES (%L, 'central')$$,
         to_char((now() AT TIME ZONE 'Asia/Bangkok') - interval '1 month', 'YYYY-MM')),
  'last month can be closed');

-- ===================== M6 (ง) closed_by / closed_at can be corrected, with history =====================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(
  format($$UPDATE month_closures SET closed_by = %L, closed_at = '2026-10-01 09:00+07'
            WHERE month_key = %L AND scope = 'central'$$,
         '00000000-0000-0000-0000-0000000000a3',
         to_char((now() AT TIME ZONE 'Asia/Bangkok') - interval '1 month', 'YYYY-MM')),
  'host corrects who closed the month and when');
RESET ROLE;
SELECT ok((SELECT count(*) FROM audit_log
            WHERE table_name = 'month_closures' AND action = 'update'
              AND changed_by = '00000000-0000-0000-0000-0000000000a1') = 1,
  'the correction is written to audit_log');

SELECT * FROM finish();
ROLLBACK;
