-- M6 (จ) ส่วนเพิ่ม (20261111110000): ยอดมูลค่าจากรายงานยอมคลาด 0.005 บาท ให้ตรงกับ
-- lib/dashboard/manualRow.ts (MONEY_EPSILON) · จำนวนต้องตรงเป๊ะ · ไม่กรอก = ผ่าน
BEGIN;
SELECT plan(6);

CREATE TEMP TABLE _b AS
  SELECT (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1) AS prov_id;

-- ผลรวม 8 tier = 1000.00 + 234.56 = 1234.56
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, m3, v_s1, v_m3, report_value)
    SELECT '2026-01', prov_id, 'manual', 1, 1, 1000.00, 234.56, 1234.56 FROM _b$$,
  'report_value equal to the 8-tier total is accepted');
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, m3, v_s1, v_m3, report_value)
    SELECT '2026-02', prov_id, 'manual', 1, 1, 1000.00, 234.56, 1234.564 FROM _b$$,
  'report_value off by 0.004 is accepted');
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, m3, v_s1, v_m3, report_value)
    SELECT '2026-03', prov_id, 'manual', 1, 1, 1000.00, 234.56, 1234.57 FROM _b$$,
  '23514', NULL, 'report_value off by 0.01 is rejected');
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, m3, v_s1, v_m3, report_value)
    SELECT '2026-04', prov_id, 'manual', 1, 1, 1000.00, 234.56, 1234.55 FROM _b$$,
  '23514', NULL, 'report_value short by 0.01 is rejected');
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, m3, report_cust)
    SELECT '2026-05', prov_id, 'manual', 1, 1, 3 FROM _b$$,
  '23514', NULL, 'report_cust must still match exactly');
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1)
    SELECT '2026-06', prov_id, 'manual', 1, 1000 FROM _b$$,
  'no report totals = accepted (not compared yet)');

SELECT * FROM finish();
ROLLBACK;
