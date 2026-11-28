-- Tier XXL (20261115390000 · DECISIONS 2.112 / 2.115)
--   ① schema: CHECK รับ XXL · ไม่เติม XXL ให้ชุดเดิม (ชุดตั้งต้นยัง 4 แถว)
--   ② save_tier_rule_set + min_xxl (ไม่บังคับ) · ชุด 5 แถว · บันทึกเดือนเดิมซ้ำแบบไม่มี XXL = ลบแถว XXL · audit
--   ③ ตรวจค่า min_xxl (TR001) · สิทธิ์ host เท่านั้น
--   ④ เขียนตรง: ชุด 5 แถวต้องต่อกันพอดี (TR004)
--   ⑤ versioning: เดือนก่อนชุดที่มี XXL ไม่มี XXL · เพิ่ม XXL ย้อนให้ชุดที่ครอบเดือนปิดแล้วไม่ได้ (TR002)
--   ⑥ preview_tier_rule_change + min_xxl (TR006 · จัด XXL ได้ทั้งฝั่งเดิมและฝั่งเสนอ)
-- เกณฑ์ทุกชุดในไฟล์นี้เป็น **ข้อมูลสมมติ** (300,000 = ค่าตั้งต้นตาม 2.115 ใช้เป็นตัวอย่างเท่านั้น) · สัญญาเทสอยู่ปี 2090
-- เดือนอ้างจาก "เดือนปัจจุบัน" (Asia/Bangkok) ผ่าน pg_temp.m(n) → เทสไม่พังเมื่อเวลาผ่านไป
BEGIN;
SELECT plan(49);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope, position_code) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',  'user_a1', 'host',  '{central,province}', 'pm'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'user_a2', 'admin', '{central}',          'job_admin');

CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.save(p jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT format('SELECT public.save_tier_rule_set(%L::jsonb)', p) $$;
GRANT EXECUTE ON FUNCTION pg_temp.save(jsonb) TO PUBLIC;
-- บันทึกชุดเกณฑ์ M/L/XL + XXL (xxl = NULL → ไม่ส่งช่อง min_xxl)
CREATE FUNCTION pg_temp.setx(n int, m numeric, l numeric, xl numeric, xxl numeric) RETURNS text
LANGUAGE sql STABLE AS
  $$ SELECT pg_temp.save(jsonb_strip_nulls(jsonb_build_object(
       'effective_month', to_char(pg_temp.m(n), 'YYYY-MM'),
       'min_m', m, 'min_l', l, 'min_xl', xl, 'min_xxl', xxl, 'reason', 'ทดสอบ XXL'))) $$;
GRANT EXECUTE ON FUNCTION pg_temp.setx(int, numeric, numeric, numeric, numeric) TO PUBLIC;
-- payload ดิบ (ทดสอบชนิดข้อมูลผิด / null)
CREATE FUNCTION pg_temp.setraw(n int, xxl jsonb) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT pg_temp.save(jsonb_build_object(
       'effective_month', to_char(pg_temp.m(n), 'YYYY-MM'),
       'min_m', 30000, 'min_l', 50000, 'min_xl', 100000, 'min_xxl', xxl, 'reason', 'ทดสอบ XXL')) $$;
GRANT EXECUTE ON FUNCTION pg_temp.setraw(int, jsonb) TO PUBLIC;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || p, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;
CREATE FUNCTION pg_temp.rows_of(n int) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT format($q$SELECT tier, min_annual::numeric, max_annual::numeric FROM tier_rules
                     WHERE effective_month = %L ORDER BY min_annual$q$, pg_temp.m(n)) $$;
GRANT EXECUTE ON FUNCTION pg_temp.rows_of(int) TO PUBLIC;

CREATE TEMP TABLE _same   (from_tier text, to_tier text, term_group text, contract_count integer);
CREATE TEMP TABLE _noxxl  (from_tier text, to_tier text, term_group text, contract_count integer);
CREATE TEMP TABLE _lower  (from_tier text, to_tier text, term_group text, contract_count integer);
GRANT ALL ON _same, _noxxl, _lower TO PUBLIC;

-- เกณฑ์ห้ามย้อนก่อน go_live_month() (M25) → เลื่อนเดือนเริ่มใช้ระบบไปก่อนเดือนที่ไฟล์นี้ใช้ (rollback ตอนจบ)
UPDATE app_settings SET go_live_month = pg_temp.m(-12);

-- ================= ① schema + ไม่ backfill =================
SELECT ok((SELECT pg_get_constraintdef(oid) LIKE '%XXL%' FROM pg_constraint
            WHERE conrelid = 'public.tier_rules'::regclass AND conname = 'tier_rules_tier_check'),
  'tier_rules_tier_check รับ XXL');
SELECT throws_ok($$INSERT INTO tier_rules (effective_month, tier, min_annual) VALUES ('2030-01-01', 'XXXL', 0)$$,
  '23514', NULL, 'ชื่อ tier อื่นยังถูกปฏิเสธ');
SELECT is((SELECT count(*)::int FROM tier_rules WHERE tier = 'XXL'), 0, 'ไม่เติม XXL ให้ชุดเกณฑ์ที่มีอยู่ (2.115)');
SELECT results_eq(
  $$SELECT tier, min_annual::numeric, max_annual::numeric FROM tier_rules
     WHERE effective_month = '2000-01-01' ORDER BY min_annual$$,
  $$VALUES ('S'::text, 0::numeric, 29999.99::numeric), ('M', 30000, 49999.99), ('L', 50000, 99999.99), ('XL', 100000, NULL)$$,
  'ชุดตั้งต้นคงเดิมทุกค่า (XL ไม่มีปลายช่วง)');

-- ================= ② บันทึกชุดที่มี XXL =================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.setx(2, 30000, 50000, 100000, 300000), 'host บันทึกชุดที่มี XXL 300,000 ได้');
SELECT results_eq(pg_temp.rows_of(2),
  $$VALUES ('S'::text, 0::numeric, 29999.99::numeric), ('M', 30000, 49999.99), ('L', 50000, 99999.99),
           ('XL', 100000, 299999.99), ('XXL', 300000, NULL)$$,
  '5 แถว: XL ปลายช่วง = XXL − 0.01 · XXL ไม่มีปลายช่วง');
SELECT is(
  (SELECT jsonb_array_length(public.save_tier_rule_set(jsonb_build_object(
     'effective_month', to_char(pg_temp.m(2), 'YYYY-MM'), 'min_m', 30000, 'min_l', 50000, 'min_xl', 100000,
     'min_xxl', 300000, 'reason', 'ทดสอบ XXL')) -> 'rules')),
  5, 'RPC คืน rules 5 แถว (บันทึกซ้ำค่าเดิมได้)');
SELECT is((SELECT count(*)::int FROM tier_rules_for_month(pg_temp.m(1))), 4,
  'เดือนก่อนชุดที่มี XXL ยังใช้ชุดเดิม 4 แถว (ไม่มี XXL)');
SELECT results_eq(
  $$SELECT tier, min_annual::numeric FROM tier_rules_for_month(pg_temp.m(2))$$,
  $$VALUES ('S'::text, 0::numeric), ('M', 30000), ('L', 50000), ('XL', 100000), ('XXL', 300000)$$,
  'เดือนที่เริ่มใช้ → ชุด 5 แถว');
SELECT is((SELECT count(*)::int FROM v_tier_rules_current WHERE tier = 'XXL'), 0,
  'v_tier_rules_current (เดือนนี้) ยังไม่มี XXL');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM audit_log WHERE table_name = 'tier_rules' AND action = 'insert'
      AND new_data ->> 'tier' = 'XXL' AND new_data ->> 'change_reason' = 'ทดสอบ XXL'
      AND changed_by = '00000000-0000-0000-0000-0000000000a1'),
  1, 'audit_log: insert แถว XXL · ผู้แก้ = host · มีเหตุผล');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.setx(2, 30000, 50000, 100000, NULL), 'บันทึกเดือนเดิมซ้ำแบบไม่ส่ง min_xxl ได้');
SELECT results_eq(pg_temp.rows_of(2),
  $$VALUES ('S'::text, 0::numeric, 29999.99::numeric), ('M', 30000, 49999.99), ('L', 50000, 99999.99), ('XL', 100000, NULL)$$,
  'ไม่ส่ง min_xxl → ลบแถว XXL เดิม · XL กลับไม่มีปลายช่วง (ไม่ค้าง 5 แถว)');
SELECT lives_ok(pg_temp.setraw(2, 'null'::jsonb), 'min_xxl = null ก็ได้ (= ไม่มี XXL)');
SELECT is((SELECT count(*)::int FROM tier_rules WHERE effective_month = pg_temp.m(2)), 4, 'min_xxl null → 4 แถว');
SELECT lives_ok(pg_temp.setx(2, 30000, 50000, 100000, 250000), 'แก้ค่า XXL ของเดือนเดิมได้');
SELECT is((SELECT max_annual FROM tier_rules WHERE effective_month = pg_temp.m(2) AND tier = 'XL'), 249999.99::numeric,
  'แก้ XXL → ปลายช่วง XL ตาม');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM audit_log WHERE table_name = 'tier_rules' AND action = 'delete'
      AND old_data ->> 'tier' = 'XXL'),
  1, 'audit_log: ลบแถว XXL ลง audit');

-- ================= ③ ตรวจค่า min_xxl (TR001) + สิทธิ์ =================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT throws_ok(pg_temp.setx(3, 30000, 50000, 100000, 300000), '42501', NULL, 'admin บันทึกชุดที่มี XXL ไม่ได้');
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.setx(3, 30000, 50000, 100000, 100000), 'TR001', NULL, 'XXL = XL → TR001');
SELECT throws_ok(pg_temp.setx(3, 30000, 50000, 100000, 100000.01), 'TR001', NULL, 'XXL = XL + 0.01 → TR001 (XL ไม่มีช่วง)');
SELECT throws_ok(pg_temp.setx(3, 30000, 50000, 100000, 90000), 'TR001', NULL, 'XXL < XL → TR001');
SELECT throws_ok(pg_temp.setx(3, 30000, 50000, 100000, 300000.005), 'TR001', NULL, 'XXL ทศนิยม 3 ตำแหน่ง → TR001');
SELECT throws_ok(pg_temp.setx(3, 30000, 50000, 100000, 10000000000), 'TR001', NULL, 'XXL เกินเพดาน → TR001');
SELECT throws_ok(pg_temp.setraw(3, '"300000"'::jsonb), 'TR001', NULL, 'XXL ส่งเป็นข้อความ → TR001');
SELECT throws_ok(pg_temp.setraw(3, '0'::jsonb), 'TR001', NULL, 'XXL = 0 → TR001');
SELECT lives_ok(pg_temp.setx(3, 30000, 50000, 100000, 100000.02), 'XXL = XL + 0.02 ได้ (ขอบล่างสุด)');
SELECT is((SELECT max_annual FROM tier_rules WHERE effective_month = pg_temp.m(3) AND tier = 'XL'), 100000.01::numeric,
  'XL ช่วง 100,000–100,000.01');
RESET ROLE;

-- ================= ④ เขียนตรง (host) — ชุด 5 แถวต้องต่อกันพอดี (TR004) =================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 0, 29999.99), (%1$L, 'M', 30000, 49999.99), (%1$L, 'L', 50000, 99999.99),
           (%1$L, 'XL', 100000, NULL), (%1$L, 'XXL', 300000, NULL)$$, pg_temp.m(4)),
  'TR004', NULL, 'มี XXL แต่ XL ไม่มีปลายช่วง → TR004');
SELECT throws_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 0, 29999.99), (%1$L, 'M', 30000, 49999.99), (%1$L, 'L', 50000, 99999.99),
           (%1$L, 'XL', 100000, 299999.99), (%1$L, 'XXL', 300000, 999999)$$, pg_temp.m(4)),
  'TR004', NULL, 'XXL มีปลายช่วง → TR004');
SELECT throws_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 0, 29999.99), (%1$L, 'M', 30000, 49999.99), (%1$L, 'L', 50000, 99999.99),
           (%1$L, 'XL', 100000, 199999.99), (%1$L, 'XXL', 300000, NULL)$$, pg_temp.m(4)),
  'TR004', NULL, 'ช่องว่างระหว่าง XL กับ XXL → TR004');
SELECT throws_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 0, 29999.99), (%1$L, 'M', 30000, 49999.99), (%1$L, 'L', 50000, 99999.99),
           (%1$L, 'XL', 100000, 299999.99), (%1$L, 'XXL', 80000, NULL)$$, pg_temp.m(4)),
  'TR004', NULL, 'XXL ต่ำกว่า XL (ลำดับผิด) → TR004');
SELECT throws_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 0, 29999.99), (%1$L, 'M', 30000, 49999.99), (%1$L, 'L', 50000, 299999.99),
           (%1$L, 'XXL', 300000, NULL)$$, pg_temp.m(4)),
  'TR004', NULL, 'มี XXL แต่ไม่มี XL → TR004');
SELECT lives_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 0, 29999.99), (%1$L, 'M', 30000, 49999.99), (%1$L, 'L', 50000, 99999.99),
           (%1$L, 'XL', 100000, 299999.99), (%1$L, 'XXL', 300000, NULL)$$, pg_temp.m(4)),
  'host เขียนตรงชุด 5 แถวที่ต่อกันพอดีได้');
SELECT throws_ok(format($$DELETE FROM tier_rules WHERE effective_month = %L AND tier = 'XXL'$$, pg_temp.m(4)),
  'TR004', NULL, 'ลบแถว XXL ตรงๆ โดยไม่แก้ปลาย XL → TR004');
RESET ROLE;

-- ================= ⑤ versioning + เดือนที่ปิดแล้ว =================
INSERT INTO month_closures (month_key, scope) VALUES (to_char(pg_temp.m(-2), 'YYYY-MM'), 'central');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(
  $$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES ('2000-01-01', 'XXL', 300000, NULL)$$,
  'TR002', NULL, 'เติม XXL ย้อนให้ชุดตั้งต้น (ครอบเดือนที่ปิดแล้ว) ไม่ได้ → TR002');
SELECT throws_ok(pg_temp.setx(-2, 30000, 50000, 100000, 300000), 'TR002', NULL,
  'เริ่มใช้ XXL ในเดือนที่ปิดแล้วไม่ได้ → TR002');
SELECT is((SELECT count(*)::int FROM tier_rules_for_month(pg_temp.m(-2)) WHERE tier = 'XXL'), 0,
  'เดือนที่ปิดแล้วยังไม่มี XXL');
SELECT is((SELECT count(*)::int FROM tier_rules_for_month(pg_temp.m(4)) WHERE tier = 'XXL'), 1,
  'เดือนของชุดที่มี XXL → มี XXL 1 แถว');
RESET ROLE;

-- ================= ⑥ preview_tier_rule_change + XXL =================
-- ชุดล่าสุด (ใช้กับปี 2090): 30,000 / 50,000 / 100,000 / XXL 300,000 (ข้อมูลสมมติ)
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.setx(6, 30000, 50000, 100000, 300000), 'ชุดล่าสุดมี XXL 300,000');
RESET ROLE;

INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c9',
   (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Test Tier XXL');
INSERT INTO contracts (customer_id, contract_no, start_date, term_months, value_total, status) VALUES
  ('00000000-0000-0000-0000-0000000000c9', 'TST-XXL1', '2090-01-15', 12, 300000,    'active'), -- XXL1
  ('00000000-0000-0000-0000-0000000000c9', 'TST-XXL3', '2090-01-15', 36, 900000,    'active'), -- XXL3 (÷ 3 = 300,000)
  ('00000000-0000-0000-0000-0000000000c9', 'TST-XL1A', '2090-01-15', 12, 299999.99, 'active'), -- XL1
  ('00000000-0000-0000-0000-0000000000c9', 'TST-XL1B', '2090-01-15', 12, 150000,    'active'), -- XL1
  ('00000000-0000-0000-0000-0000000000c9', 'TST-CUS5', '2090-01-15', 5,  300000,    'active'); -- XXL1 (Custom 5 เดือน = มูลค่าจริง)

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01',
                   '{"min_m": 30000, "min_l": 50000, "min_xl": 100000, "min_xxl": 100000}')$$,
  'TR006', NULL, 'preview: XXL = XL → TR006');
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01',
                   '{"min_m": 30000, "min_l": 50000, "min_xl": 100000, "min_xxl": "300000"}')$$,
  'TR006', NULL, 'preview: XXL เป็นข้อความ → TR006');
SELECT throws_ok($$SELECT * FROM public.preview_tier_rule_change('2090-01-01',
                   '{"min_m": 30000, "min_l": 50000, "min_xl": 100000, "min_xxl": 300000.001}')$$,
  'TR006', NULL, 'preview: XXL ทศนิยม 3 ตำแหน่ง → TR006');
INSERT INTO _same SELECT * FROM public.preview_tier_rule_change('2090-01-01',
  '{"min_m": 30000, "min_l": 50000, "min_xl": 100000, "min_xxl": 300000}');
INSERT INTO _noxxl SELECT * FROM public.preview_tier_rule_change('2090-01-01',
  '{"min_m": 30000, "min_l": 50000, "min_xl": 100000}');
INSERT INTO _lower SELECT * FROM public.preview_tier_rule_change('2090-01-01',
  '{"min_m": 30000, "min_l": 50000, "min_xl": 100000, "min_xxl": 150000}');
RESET ROLE;

SELECT is((SELECT array_agg(tier ORDER BY min_annual)::text FROM public.tier_rules_for_month('2090-01-01')),
  '{S,M,L,XL,XXL}', 'precondition: ชุดของ 2090-01 มี XXL');
SELECT results_eq(
  $$SELECT from_tier || term_group, contract_count FROM _same ORDER BY 1$$,
  $$VALUES ('XL1'::text, 2), ('XXL1', 2), ('XXL3', 1)$$,
  'จัด Tier ปัจจุบัน: 300k/12 + 300k/5 = XXL1 · 900k/36 = XXL3 · 299,999.99 + 150k = XL1');
SELECT is((SELECT count(*)::int FROM _same WHERE from_tier <> to_tier), 0, 'เกณฑ์เดิม → ไม่มีใครย้าย');
SELECT results_eq(
  $$SELECT from_tier, to_tier, term_group, contract_count FROM _noxxl WHERE from_tier <> to_tier ORDER BY term_group$$,
  $$VALUES ('XXL'::text, 'XL'::text, '1'::text, 2), ('XXL', 'XL', '3', 1)$$,
  'เสนอชุดไม่มี XXL → XXL ย้ายไป XL ทั้งหมด');
SELECT results_eq(
  $$SELECT from_tier, to_tier, term_group, contract_count FROM _lower WHERE from_tier <> to_tier ORDER BY term_group$$,
  $$VALUES ('XL'::text, 'XXL'::text, '1'::text, 2)$$,
  'ลด XXL เป็น 150,000 → XL1 สองสัญญาย้ายเป็น XXL');
SELECT results_eq(
  $$SELECT from_tier || '>' || to_tier FROM _lower ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], from_tier), 1$$,
  $$VALUES ('XL>XXL'::text), ('XXL>XXL'), ('XXL>XXL')$$,
  'ผลเรียง XL ก่อน XXL');

SELECT * FROM finish();
ROLLBACK;
