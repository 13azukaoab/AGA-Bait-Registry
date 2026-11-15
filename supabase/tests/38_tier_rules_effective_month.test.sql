-- M20 (20261115130000): เกณฑ์ Tier ตามเดือนที่เริ่มใช้ (DECISIONS 2.31)
--   tier_rules.effective_month · ชุดต้องครบ/ต่อกันพอดี (TR004) · เดือนที่ปิดแล้วคงเกณฑ์เดิม (TR002)
--   · tier_rules_for_month / v_tier_rules_current · save_tier_rule_set (host เท่านั้น) · audit_tier_rules · สิทธิ์
-- เดือนอ้างจาก "เดือนปัจจุบัน" (Asia/Bangkok) ผ่าน pg_temp.m(n) → เทสไม่พังเมื่อเวลาผ่านไป
-- ชุดเกณฑ์ใหม่ในไฟล์นี้ (40,000 / 60,000 / 120,000 ฯลฯ) เป็น **ข้อมูลสมมติ** ใช้ทดสอบเท่านั้น
BEGIN;
SELECT plan(65);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer',   'user_a4', 'viewer',   '{central}');

CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
-- คำสั่งเรียก RPC (payload เป็น jsonb ดิบ ให้ทดสอบชนิดข้อมูลผิดได้)
CREATE FUNCTION pg_temp.save(p jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT format('SELECT public.save_tier_rule_set(%L::jsonb)', p) $$;
GRANT EXECUTE ON FUNCTION pg_temp.save(jsonb) TO PUBLIC;
CREATE FUNCTION pg_temp.set(n int, m numeric, l numeric, xl numeric, reason text DEFAULT 'ทดสอบ') RETURNS text
LANGUAGE sql STABLE AS
  $$ SELECT pg_temp.save(jsonb_build_object('effective_month', to_char(pg_temp.m(n), 'YYYY-MM'),
                                            'min_m', m, 'min_l', l, 'min_xl', xl, 'reason', reason)) $$;
GRANT EXECUTE ON FUNCTION pg_temp.set(int, numeric, numeric, numeric, text) TO PUBLIC;
CREATE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || p, true) $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;

-- ================= 1. โครงสร้าง + ชุดตั้งต้น =================
SELECT has_column('public', 'tier_rules', 'effective_month', 'tier_rules.effective_month มีแล้ว');
SELECT col_not_null('public', 'tier_rules', 'effective_month', 'effective_month NOT NULL');
SELECT has_column('public', 'tier_rules', 'change_reason', 'tier_rules.change_reason มีแล้ว');
SELECT col_is_pk('public', 'tier_rules', ARRAY['effective_month', 'tier'], 'PK = (effective_month, tier)');
SELECT results_eq(
  $$SELECT effective_month, tier, min_annual::numeric, max_annual::numeric FROM tier_rules ORDER BY min_annual$$,
  $$VALUES ('2000-01-01'::date, 'S'::text, 0::numeric, 29999.99::numeric), ('2000-01-01', 'M', 30000, 49999.99),
           ('2000-01-01', 'L', 50000, 99999.99), ('2000-01-01', 'XL', 100000, NULL)$$,
  'ชุดตั้งต้น = ค่าเดิมทุกตัว · effective_month 2000-01-01');
SELECT throws_ok(
  $$INSERT INTO tier_rules (effective_month, tier, min_annual) VALUES ('2030-01-15', 'S', 0)$$,
  '23514', NULL, 'effective_month ต้องเป็นวันที่ 1');

-- ================= 2. อ่านชุดของเดือน =================
SELECT results_eq(
  $$SELECT tier, min_annual::numeric FROM tier_rules_for_month(pg_temp.m(0))$$,
  $$VALUES ('S'::text, 0::numeric), ('M', 30000), ('L', 50000), ('XL', 100000)$$,
  'tier_rules_for_month(เดือนนี้) = ชุดตั้งต้น เรียงตาม min');
SELECT is((SELECT count(*)::int FROM tier_rules_for_month('1999-12-01')), 0, 'เดือนก่อนชุดแรก → ไม่มีเกณฑ์ (ไม่เดา)');
SELECT is((SELECT count(*)::int FROM v_tier_rules_current), 4, 'v_tier_rules_current = 4 แถว');

-- ================= 3. สิทธิ์ function / view =================
SELECT ok(NOT has_function_privilege('anon', 'public.save_tier_rule_set(jsonb)', 'EXECUTE'), 'anon เรียก save_tier_rule_set ไม่ได้');
SELECT ok(NOT has_function_privilege('anon', 'public.tier_rules_for_month(date)', 'EXECUTE'), 'anon เรียก tier_rules_for_month ไม่ได้');
SELECT ok(has_function_privilege('authenticated', 'public.save_tier_rule_set(jsonb)', 'EXECUTE'), 'authenticated เรียก RPC ได้ (role ตรวจในตัว)');
SELECT ok(has_function_privilege('authenticated', 'public.tier_rules_for_month(date)', 'EXECUTE'), 'authenticated เรียก tier_rules_for_month ได้');
SELECT ok(NOT has_function_privilege('authenticated', 'public.tier_rules_check_set(date)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.tier_rules_closed_month_guard()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.tier_rules_valid_set_trigger()', 'EXECUTE'),
  'function ภายใน (trigger/ตรวจชุด) เรียกตรงไม่ได้');
SELECT ok(NOT has_table_privilege('anon', 'public.v_tier_rules_current', 'SELECT'), 'anon อ่าน v_tier_rules_current ไม่ได้');
SELECT ok(NOT has_table_privilege('authenticated', 'public.v_tier_rules_current', 'INSERT'), 'authenticated เขียน view ไม่ได้');
SELECT ok(NOT has_table_privilege('anon', 'public.tier_rules', 'SELECT'), 'anon อ่าน tier_rules ไม่ได้ (เหมือนเดิม)');

-- ================= 4. ทั้งตารางต้องเหลืออย่างน้อย 1 ชุด (ยังไม่มีเดือนที่ปิด) =================
SET CONSTRAINTS public.tier_rules_valid_set IMMEDIATE;
SELECT throws_ok($$DELETE FROM tier_rules$$, 'TR004', NULL, 'ลบเกณฑ์จนหมดตารางไม่ได้');

-- ================= 5. role อื่นบันทึกไม่ได้ =================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2');
SELECT throws_ok(pg_temp.set(1, 40000, 60000, 120000), '42501', NULL, 'admin บันทึกเกณฑ์ไม่ได้ (host เท่านั้น)');
SELECT pg_temp.as_user('a3');
SELECT throws_ok(pg_temp.set(1, 40000, 60000, 120000), '42501', NULL, 'recorder บันทึกเกณฑ์ไม่ได้');
SELECT pg_temp.as_user('a4');
SELECT throws_ok(pg_temp.set(1, 40000, 60000, 120000), '42501', NULL, 'viewer บันทึกเกณฑ์ไม่ได้');
SELECT cmp_ok((SELECT count(*)::int FROM tier_rules), '>=', 4, 'viewer อ่าน tier_rules ได้ (เหมือนเดิม)');
SELECT is((SELECT count(*)::int FROM v_tier_rules_current), 4, 'viewer อ่าน v_tier_rules_current ได้');
SELECT throws_ok(
  $$INSERT INTO tier_rules (effective_month, tier, min_annual) VALUES ('2030-01-01', 'S', 0)$$,
  '42501', NULL, 'viewer เขียน tier_rules ตรงไม่ได้');
SELECT pg_temp.as_user('a3');
WITH u AS (UPDATE tier_rules SET change_reason = 'x' RETURNING 1)
SELECT is(count(*)::int, 0, 'recorder แก้ tier_rules ตรงไม่ได้ (RLS เห็น 0 แถว)') FROM u;
RESET ROLE;

-- ================= 6. host บันทึกชุดใหม่ =================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.set(1, 40000, 60000, 120000, 'ปรับเกณฑ์ปีหน้า'), 'host บันทึกชุดเริ่มใช้เดือนหน้าได้');
SELECT results_eq(
  format($$SELECT tier, min_annual::numeric, max_annual::numeric, change_reason FROM tier_rules
           WHERE effective_month = %L ORDER BY min_annual$$, pg_temp.m(1)),
  $$VALUES ('S'::text, 0::numeric, 39999.99::numeric, 'ปรับเกณฑ์ปีหน้า'::text),
           ('M', 40000, 59999.99, 'ปรับเกณฑ์ปีหน้า'), ('L', 60000, 119999.99, 'ปรับเกณฑ์ปีหน้า'),
           ('XL', 120000, NULL, 'ปรับเกณฑ์ปีหน้า')$$,
  'สร้าง 4 แถว: S เริ่ม 0 · max = จุดเริ่มถัดไป − 0.01 · XL ไม่มี max · เก็บเหตุผล');
SELECT results_eq(
  $$SELECT min_annual::numeric FROM tier_rules_for_month(pg_temp.m(0))$$,
  $$VALUES (0::numeric), (30000), (50000), (100000)$$,
  'เดือนนี้ (ก่อนเริ่มใช้) ยังใช้ชุดเดิม');
SELECT results_eq(
  $$SELECT min_annual::numeric FROM tier_rules_for_month(pg_temp.m(1))$$,
  $$VALUES (0::numeric), (40000), (60000), (120000)$$,
  'เดือนที่เริ่มใช้ → ชุดใหม่');
SELECT results_eq(
  $$SELECT min_annual::numeric FROM tier_rules_for_month(pg_temp.m(6) + 14)$$,
  $$VALUES (0::numeric), (40000), (60000), (120000)$$,
  'เดือนหลังจากนั้น (ส่งวันกลางเดือนก็ได้) → ชุดใหม่');
SELECT is((SELECT count(*)::int FROM v_tier_rules_current WHERE effective_month = '2000-01-01'), 4,
  'v_tier_rules_current ยังเป็นชุดของเดือนนี้');
SELECT is(
  (SELECT (public.save_tier_rule_set(jsonb_build_object(
     'effective_month', to_char(pg_temp.m(2), 'YYYY-MM-DD'), 'min_m', 35000, 'min_l', 55000, 'min_xl', 110000.5,
     'reason', 'รูปแบบวันที่ 1')) ->> 'effective_month')),
  to_char(pg_temp.m(2), 'YYYY-MM-DD'),
  'รับ effective_month รูปแบบ YYYY-MM-01 ได้ · คืนเดือนที่บันทึก');
SELECT is((SELECT max_annual FROM tier_rules WHERE effective_month = pg_temp.m(2) AND tier = 'L'), 110000.49::numeric,
  'ทศนิยม 2 ตำแหน่งได้ · max ของ L = 110,000.50 − 0.01');
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM audit_log WHERE table_name = 'tier_rules' AND action = 'insert'
      AND (new_data ->> 'effective_month')::date = pg_temp.m(1)
      AND changed_by = '00000000-0000-0000-0000-0000000000a1'
      AND row_id IS NOT NULL),
  4, 'audit_log: insert 4 แถว · ผู้แก้ = host · มี row_id');
SELECT is(
  (SELECT new_data ->> 'change_reason' FROM audit_log WHERE table_name = 'tier_rules'
      AND (new_data ->> 'effective_month')::date = pg_temp.m(1) AND new_data ->> 'tier' = 'M'),
  'ปรับเกณฑ์ปีหน้า', 'audit_log เก็บเหตุผล');

-- ================= 7. บันทึกเดือนเดิมซ้ำ = แทนชุดเดิม =================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT lives_ok(pg_temp.set(1, 45000, 65000, 125000, 'แก้ตัวเลข'), 'บันทึกเดือนเดิมซ้ำได้');
SELECT results_eq(
  format($$SELECT min_annual::numeric FROM tier_rules WHERE effective_month = %L ORDER BY min_annual$$, pg_temp.m(1)),
  $$VALUES (0::numeric), (45000), (65000), (125000)$$,
  'แทนชุดเดิมของเดือนนั้น (ยังมี 4 แถว)');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM audit_log WHERE table_name = 'tier_rules' AND action = 'update'
      AND (new_data ->> 'effective_month')::date = pg_temp.m(1)),
  4, 'audit_log: แทนชุดเดิม = update 4 แถว (มี old_data)');

-- ================= 8. ตรวจข้อมูลที่ส่งมา =================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.set(3, 40000.005, 60000, 120000), 'TR001', NULL, 'ทศนิยมเกิน 2 ตำแหน่ง → TR001 (ไม่ปัดเงียบ)');
SELECT throws_ok(pg_temp.set(3, 60000, 40000, 120000), 'TR001', NULL, 'จุดเริ่มไม่เรียง → TR001');
SELECT throws_ok(pg_temp.set(3, 40000, 40000, 120000), 'TR001', NULL, 'จุดเริ่มซ้ำ → TR001');
SELECT throws_ok(pg_temp.set(3, 0, 60000, 120000), 'TR001', NULL, 'จุดเริ่ม M = 0 → TR001');
SELECT throws_ok(pg_temp.set(3, 0.01, 60000, 120000), 'TR001', NULL, 'จุดเริ่ม M = 0.01 (S ไม่มีช่วง) → TR001 ไม่ใช่ 23514');
SELECT throws_ok(pg_temp.set(3, 40000, 60000, 120000, '   '), 'TR003', NULL, 'ไม่มีเหตุผล → TR003');
SELECT throws_ok(
  pg_temp.save('{"effective_month": "2030-13", "min_m": 1, "min_l": 2, "min_xl": 3, "reason": "x"}'),
  'TR001', NULL, 'เดือนผิดรูปแบบ → TR001');
SELECT throws_ok(
  pg_temp.save('{"effective_month": "2030-01", "min_m": "40000", "min_l": 2, "min_xl": 3, "reason": "x"}'),
  'TR001', NULL, 'ตัวเลขส่งเป็นข้อความ → TR001');
SELECT throws_ok(
  pg_temp.save('{"effective_month": "2000-01", "min_m": 1, "min_l": 2, "min_xl": 3, "reason": "x"}'),
  'TR001', NULL, 'แทนชุดตั้งต้น / ก่อนชุดตั้งต้นไม่ได้ → TR001');
RESET ROLE;

-- ================= 9. ชุดไม่ครบ / ไม่ต่อกัน (เขียนตรงโดย host) =================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES (%L, 'S', 0, 39999.99)$$, pg_temp.m(4)),
  'TR004', NULL, 'ชุดไม่ครบ 4 tier → TR004');
SELECT throws_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 0, 39999.99), (%1$L, 'M', 40000, 59999.99), (%1$L, 'L', 60000, 99999.99), (%1$L, 'XL', 120000, NULL)$$,
         pg_temp.m(4)),
  'TR004', NULL, 'มีช่องว่างระหว่าง L กับ XL → TR004');
SELECT throws_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 10, 39999.99), (%1$L, 'M', 40000, 59999.99), (%1$L, 'L', 60000, 119999.99), (%1$L, 'XL', 120000, NULL)$$,
         pg_temp.m(4)),
  'TR004', NULL, 'S ไม่เริ่มที่ 0 → TR004');
SELECT throws_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 0, 39999.99), (%1$L, 'M', 40000, 59999.99), (%1$L, 'L', 60000, 119999.99), (%1$L, 'XL', 120000, 999999)$$,
         pg_temp.m(4)),
  'TR004', NULL, 'XL มีปลายช่วง → TR004');
SELECT lives_ok(
  format($$INSERT INTO tier_rules (effective_month, tier, min_annual, max_annual) VALUES
           (%1$L, 'S', 0, 39999.99), (%1$L, 'M', 40000, 59999.99), (%1$L, 'L', 60000, 119999.99), (%1$L, 'XL', 120000, NULL)$$,
         pg_temp.m(4)),
  'host เขียนตรงชุดที่ครบและต่อกันได้ (กติกาเดียวกับ RPC)');
SELECT lives_ok(format($$DELETE FROM tier_rules WHERE effective_month = %L$$, pg_temp.m(4)),
  'ลบทั้งชุดของเดือนที่ยังไม่ปิดได้');
SELECT throws_ok($$DELETE FROM tier_rules WHERE effective_month = '2000-01-01'$$,
  'TR004', NULL, 'ลบชุดตั้งต้นไม่ได้ (เดือนเก่าจะไม่มีเกณฑ์)');
SELECT throws_ok($$UPDATE tier_rules SET effective_month = '2001-01-01' WHERE effective_month = '2000-01-01'$$,
  'TR004', NULL, 'ย้ายเดือนของชุดตั้งต้นไม่ได้');
-- ชุดก่อนเดือนที่จะปิด (ใช้ทดสอบช่วงมีผลในข้อ 10)
SELECT lives_ok(pg_temp.set(-4, 40000, 60000, 120000), 'บันทึกย้อนหลังเดือนที่ยังไม่ปิดได้');
RESET ROLE;

-- ================= 10. เดือนที่ปิดแล้วคงเกณฑ์เดิม (2.31) =================
INSERT INTO month_closures (month_key, scope) VALUES (to_char(pg_temp.m(-2), 'YYYY-MM'), 'central');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1');
SELECT throws_ok(pg_temp.set(-2, 40000, 60000, 120000), 'TR002', NULL, 'เริ่มใช้ในเดือนที่ปิดแล้ว → TR002');
SELECT throws_ok(pg_temp.set(-3, 40000, 60000, 120000), 'TR002', NULL, 'เริ่มใช้ก่อนเดือนที่ปิดแล้ว (จะกระทบเดือนที่ปิด) → TR002');
SELECT lives_ok(pg_temp.set(-1, 40000, 60000, 120000), 'เริ่มใช้หลังเดือนที่ปิดล่าสุดได้ (ย้อนหลังเดือนที่ยังเปิด)');
SELECT throws_ok(format($$UPDATE tier_rules SET change_reason = 'แก้' WHERE effective_month = %L$$, pg_temp.m(-4)),
  'TR002', NULL, 'แก้ชุดที่ครอบเดือนที่ปิดแล้วตรงๆ ก็ไม่ได้ → TR002');
SELECT throws_ok(format($$DELETE FROM tier_rules WHERE effective_month = %L$$, pg_temp.m(-4)),
  'TR002', NULL, 'ลบชุดที่ครอบเดือนที่ปิดแล้วไม่ได้ → TR002');
SELECT lives_ok(pg_temp.set(-6, 35000, 55000, 110000), 'ชุดที่ช่วงมีผลจบก่อนเดือนที่ปิด บันทึกได้');
SELECT lives_ok($$UPDATE tier_rules SET change_reason = 'แก้ชุดตั้งต้น' WHERE effective_month = '2000-01-01'$$,
  'แก้ชุดตั้งต้นได้ถ้าช่วงมีผลไม่ครอบเดือนที่ปิด');
SELECT lives_ok($$UPDATE tier_rules SET max_annual = max_annual WHERE effective_month = '2000-01-01' AND tier = 'S'$$,
  'UPDATE ที่ค่าไม่เปลี่ยนผ่านได้ (08_rls เดิม)');
RESET ROLE;
SELECT results_eq(
  $$SELECT min_annual::numeric FROM tier_rules_for_month(pg_temp.m(-2))$$,
  $$VALUES (0::numeric), (40000), (60000), (120000)$$,
  'เดือนที่ปิดแล้วยังได้ชุดเดิม (ชุด m(-4) ที่บันทึกก่อนปิด)');

SELECT * FROM finish();
ROLLBACK;
