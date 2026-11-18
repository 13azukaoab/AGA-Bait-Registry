-- M40 (20261115280000): ด่านตัวเลข monthly_branch_snapshots + รายการแก้หลังปิด
--   (a) ผู้ใช้ทาง API: host เท่านั้น · เฉพาะแถว manual ของสาขาต่างจังหวัด (SN001 / SN002) · service_role / RPC M39 ไม่กระทบ
--   (b) แถว manual: ฐานข้อมูลคำนวณ cust / vS / vM / vL / vXL / value จาก 8 tier · CHECK จำนวน/มูลค่า ≥ 0 · จำนวน 0 ⇒ มูลค่า 0
--   (c) confirmed_at / confirmed_by ประทับที่เซิร์ฟเวอร์
--   (d) list_post_close_edits(p_month, p_scope)
-- go-live ในเทส = 2026-09 · ข้อมูลสมมติทั้งหมด
BEGIN;
SELECT plan(78);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recprov@test.local'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recoff@test.local'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope, position_code) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'host',     'user_e1', 'host',     '{central,province}', 'pm'),
  ('00000000-0000-0000-0000-0000000000e2', 'admin',    'user_e2', 'admin',    '{central,province}', 'job_admin'),
  ('00000000-0000-0000-0000-0000000000e3', 'recorder', 'user_e3', 'recorder', '{central}',          'supervisor'),
  ('00000000-0000-0000-0000-0000000000e4', 'recprov',  'user_e4', 'recorder', '{province}',         'supervisor'),
  ('00000000-0000-0000-0000-0000000000e5', 'recoff',   'user_e5', 'recorder', '{central}',          'supervisor'),
  ('00000000-0000-0000-0000-0000000000e6', 'viewer',   'user_e6', 'viewer',   '{central}',          NULL);
UPDATE profiles SET is_active = false WHERE user_id = '00000000-0000-0000-0000-0000000000e5';

UPDATE app_settings SET go_live_month = '2026-09-01';

CREATE TEMP TABLE _b AS
  SELECT (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1)          AS prov_id,
         (SELECT id FROM branches WHERE division = 'province' ORDER BY name OFFSET 1 LIMIT 1) AS prov2_id,
         (SELECT id FROM branches WHERE division = 'central'  ORDER BY name LIMIT 1)          AS cen_id;
GRANT ALL ON _b TO PUBLIC;

CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', p::text, 'role', 'authenticated')::text, true);
$$;
CREATE FUNCTION pg_temp.no_user() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.no_user() TO PUBLIC;

-- แถวตั้งต้น (postgres) — legacy ต่างจังหวัด (v_s* = 0 แต่มีจำนวน · รูปแบบเดียวกับข้อมูลนำเข้าจริง) + computed ส่วนกลาง
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, cust, "vS", value)
  SELECT '2026-08', prov_id, 'legacy', 5, 5, 150000, 150000 FROM _b;
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, cust, "vS", value)
  SELECT '2026-08', cen_id, 'computed', 2, 7, 80000, 90000 FROM _b;

-- =====================================================================
-- 1. โครงสร้าง / สิทธิ์
-- =====================================================================
SELECT has_trigger('public', 'monthly_branch_snapshots', 'snapshots_manual_guard', 'guard trigger exists');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.snapshots_manual_guard()'::regprocedure),
  'guard function is SECURITY INVOKER (sees the API role as current_user)');
SELECT ok(NOT has_function_privilege('anon', 'public.snapshots_manual_guard()', 'EXECUTE'), 'anon cannot execute the guard function');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.list_post_close_edits(text, public.closure_scope)'::regprocedure)
          AND (SELECT proconfig::text LIKE '%search_path=public, pg_temp%' FROM pg_proc
                WHERE oid = 'public.list_post_close_edits(text, public.closure_scope)'::regprocedure),
  'list_post_close_edits is SECURITY DEFINER with a pinned search_path');
SELECT ok(NOT has_function_privilege('anon', 'public.list_post_close_edits(text, public.closure_scope)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.list_post_close_edits(text, public.closure_scope)', 'EXECUTE'),
  'list_post_close_edits: anon no · authenticated yes');
SELECT is((SELECT array_agg(n ORDER BY n) FROM unnest((SELECT proargnames FROM pg_proc
             WHERE oid = 'public.list_post_close_edits(text, public.closure_scope)'::regprocedure)) n
             WHERE n NOT LIKE 'p\_%'),
  ARRAY['action', 'actor_name', 'actor_position_code', 'actor_position_name', 'branch_id', 'branch_name', 'changed_at', 'table_name'],
  'list_post_close_edits returns only the narrow columns (no old/new data, no row ids)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.monthly_branch_snapshots', 'TRUNCATE'),
  'authenticated cannot TRUNCATE snapshots (would skip RLS + triggers)');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.monthly_branch_snapshots'::regclass
            AND conname IN ('snapshots_manual_counts_nonneg', 'snapshots_manual_values_nonneg', 'snapshots_manual_zero_count_value',
                            'snapshots_manual_report_cust_matches', 'snapshots_manual_report_value_matches')),
  5, 'new manual CHECKs exist and the report CHECKs (5.11) are kept');

-- =====================================================================
-- 2. (a) ด่าน — host ทาง API
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');

SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots
      (month_key, branch_id, source, s1, s3, m1, xl3, v_s1, v_s3, v_m1, v_xl3, cust, "vS", "vM", "vL", "vXL", value)
    SELECT '2026-10', prov_id, 'manual', 2, 1, 1, 1, 20000, 90000, 40000.50, 600000, 999, 1, 2, 3, 4, 5 FROM _b$$,
  'host inserts a manual row for a province branch');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT '2026-10', prov2_id, 'computed' FROM _b$$,
  'SN001', NULL, 'host cannot insert a computed row');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT '2026-10', prov2_id, 'legacy' FROM _b$$,
  'SN001', NULL, 'host cannot insert a legacy row');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT '2026-10', cen_id, 'manual' FROM _b$$,
  'SN002', NULL, 'host cannot insert a manual row for a central branch');
SELECT throws_ok($$UPDATE monthly_branch_snapshots SET value = 1 WHERE month_key = '2026-08' AND source = 'computed'$$,
  'SN001', NULL, 'host cannot update a computed (central) row');
SELECT throws_ok($$UPDATE monthly_branch_snapshots SET "vS" = 1 WHERE month_key = '2026-08' AND source = 'legacy'$$,
  'SN001', NULL, 'host cannot update a legacy row');
SELECT throws_ok($$UPDATE monthly_branch_snapshots SET source = 'manual' WHERE month_key = '2026-08' AND source = 'legacy'$$,
  'SN001', NULL, 'host cannot turn a legacy row into a manual one');
SELECT throws_ok($$DELETE FROM monthly_branch_snapshots WHERE month_key = '2026-08' AND source = 'legacy'$$,
  'SN001', NULL, 'host cannot delete a legacy row');
SELECT throws_ok($$DELETE FROM monthly_branch_snapshots WHERE month_key = '2026-08' AND source = 'computed'$$,
  'SN001', NULL, 'host cannot delete a computed row');
SELECT throws_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1)
    SELECT '2026-08', prov_id, 'manual', 1, 1000 FROM _b
    ON CONFLICT (month_key, branch_id) DO UPDATE SET source = EXCLUDED.source, s1 = EXCLUDED.s1, v_s1 = EXCLUDED.v_s1$$,
  'SN001', NULL, 'upsert of a manual row onto an existing legacy row is refused');
SELECT throws_ok($$UPDATE monthly_branch_snapshots SET source = 'computed' WHERE month_key = '2026-10' AND source = 'manual'$$,
  'SN001', NULL, 'host cannot change a manual row into computed');
SELECT throws_ok($$UPDATE monthly_branch_snapshots SET branch_id = (SELECT cen_id FROM _b) WHERE month_key = '2026-10' AND source = 'manual'$$,
  'SN002', NULL, 'host cannot move a manual row to a central branch');
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1) SELECT '2026-09', prov2_id, 'manual', 1, 1000 FROM _b$$,
  'host inserts a second manual row');
SELECT lives_ok($$DELETE FROM monthly_branch_snapshots WHERE month_key = '2026-09' AND source = 'manual'$$,
  'host deletes a manual province row');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots WHERE month_key = '2026-09'), 0, 'the manual delete really happened (RETURN OLD)');
SELECT is((SELECT row(source, "vS", value)::text FROM monthly_branch_snapshots WHERE month_key = '2026-08' AND branch_id = (SELECT prov_id FROM _b)),
  row('legacy', 150000.00::numeric(14,2), 150000.00::numeric(14,2))::text, 'legacy row untouched by the refused writes');
SELECT is((SELECT row(cust, value)::text FROM monthly_branch_snapshots WHERE month_key = '2026-08' AND branch_id = (SELECT cen_id FROM _b)),
  row(7, 90000.00::numeric(14,2))::text, 'computed row untouched (and not recomputed)');

-- ผู้ใช้อื่น → 42501 (เหมือน RLS เดิม)
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT '2026-11', prov2_id, 'manual' FROM _b$$,
  '42501', NULL, 'recorder cannot write a manual row');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT '2026-11', prov2_id, 'manual' FROM _b$$,
  '42501', NULL, 'admin cannot write a manual row');
RESET ROLE;

-- service_role (ฝั่ง server) ไม่ติดด่าน
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT lives_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, cust) SELECT '2026-07', cen_id, 'computed', 1, 1 FROM _b$$,
  'service_role writes a computed central row');
SELECT lives_ok($$UPDATE monthly_branch_snapshots SET cust = 3 WHERE month_key = '2026-07' AND source = 'computed'$$,
  'service_role updates a computed row');
SELECT lives_ok($$DELETE FROM monthly_branch_snapshots WHERE month_key = '2026-07' AND source = 'computed'$$,
  'service_role deletes a computed row');
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, cust, value, confirmed_at, confirmed_by)
    SELECT '2026-07', prov2_id, 'manual', 3, 3000, 50, 1, '2026-08-02 10:00+07', '00000000-0000-0000-0000-0000000000e3' FROM _b$$,
  'service_role writes a manual row');
RESET ROLE;
SELECT is((SELECT row(cust, value)::text FROM monthly_branch_snapshots WHERE month_key = '2026-07' AND source = 'manual'),
  row(3, 3000.00::numeric(14,2))::text, 'manual totals are recomputed for service_role writes too');
SELECT is((SELECT row(confirmed_at, confirmed_by)::text FROM monthly_branch_snapshots WHERE month_key = '2026-07' AND source = 'manual'),
  row('2026-08-02 10:00+07'::timestamptz, '00000000-0000-0000-0000-0000000000e3'::uuid)::text,
  'service_role confirmation values are kept (trusted server path)');

-- =====================================================================
-- 3. (b) ยอดรวมคำนวณที่ฐานข้อมูล + CHECK
-- =====================================================================
SELECT is((SELECT row(cust, "vS", "vM", "vL", "vXL", value)::text FROM monthly_branch_snapshots
            WHERE month_key = '2026-10' AND source = 'manual'),
  row(5, 110000.00::numeric(14,2), 40000.50::numeric(14,2), 0.00::numeric(14,2), 600000.00::numeric(14,2), 750000.50::numeric(14,2))::text,
  'client totals (999 / 1 / 2 / 3 / 4 / 5) are replaced by the sums of the 8 tiers');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
SELECT lives_ok($$UPDATE monthly_branch_snapshots SET l1 = 2, v_l1 = 30000, cust = 0, value = 0 WHERE month_key = '2026-10' AND source = 'manual'$$,
  'host edits one tier');
SELECT is((SELECT row(cust, "vL", value)::text FROM monthly_branch_snapshots WHERE month_key = '2026-10' AND source = 'manual'),
  row(7, 30000.00::numeric(14,2), 780000.50::numeric(14,2))::text, 'totals recomputed on update (client zeros ignored)');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1) SELECT '2026-11', prov2_id, 'manual', -1 FROM _b$$,
  '23514', NULL, 'negative count → 23514');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, m1, v_m1) SELECT '2026-11', prov2_id, 'manual', 1, 5000, 1, -1 FROM _b$$,
  '23514', NULL, 'negative value → 23514');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, v_m3) SELECT '2026-11', prov2_id, 'manual', 1, 5000, 100 FROM _b$$,
  '23514', NULL, 'count 0 with a value → 23514');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1) SELECT '2026-11', prov2_id, 'manual', 1, 'NaN' FROM _b$$,
  '23514', NULL, 'NaN value → 23514');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, report_cust) SELECT '2026-11', prov2_id, 'manual', 1, 5000, 2 FROM _b$$,
  '23514', NULL, 'report_cust mismatch still refused (5.11)');
SELECT throws_ok($$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, report_value) SELECT '2026-11', prov2_id, 'manual', 1, 5000, 5001 FROM _b$$,
  '23514', NULL, 'report_value mismatch still refused (5.11)');
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, m1, report_cust, report_value)
    SELECT '2026-11', prov2_id, 'manual', 1, 5000, 1, 2, 5000 FROM _b$$,
  'count > 0 with value 0 is allowed (warning only in the app)');
RESET ROLE;

-- legacy / computed ไม่ติด CHECK ใหม่และไม่ถูกคำนวณใหม่
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, cust, "vS", value) SELECT '2026-06', prov2_id, 'legacy', 4, 4, 70000, 70000 FROM _b$$,
  'legacy row with counts but no per-tier values is accepted');
SELECT is((SELECT row(cust, "vS", value)::text FROM monthly_branch_snapshots WHERE month_key = '2026-06'),
  row(4, 70000.00::numeric(14,2), 70000.00::numeric(14,2))::text, 'legacy totals kept as imported');

-- =====================================================================
-- 4. (c) confirmed_at / confirmed_by
-- =====================================================================
SELECT is((SELECT row(confirmed_at, confirmed_by)::text FROM monthly_branch_snapshots WHERE month_key = '2026-10' AND source = 'manual'),
  row(NULL::timestamptz, NULL::uuid)::text, 'insert without confirmed_at stays "not updated"');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, confirmed_at, confirmed_by)
    SELECT '2026-12', prov2_id, 'manual', 1, 1000, '2020-01-01', '00000000-0000-0000-0000-0000000000e3' FROM _b$$,
  'host inserts with a forged confirmed_at / confirmed_by');
SELECT lives_ok(
  $$INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, confirmed_by)
    SELECT '2027-01', prov2_id, 'manual', 1, 1000, '00000000-0000-0000-0000-0000000000e3' FROM _b$$,
  'host inserts with confirmed_by but no confirmed_at');
RESET ROLE;
SELECT is((SELECT row(confirmed_at, confirmed_by)::text FROM monthly_branch_snapshots WHERE month_key = '2026-12'),
  row(now(), '00000000-0000-0000-0000-0000000000e1'::uuid)::text, 'server stamps now() + the host (forged values ignored)');
SELECT is((SELECT row(confirmed_at, confirmed_by)::text FROM monthly_branch_snapshots WHERE month_key = '2027-01'),
  row(NULL::timestamptz, NULL::uuid)::text, 'no confirmed_at → confirmed_by cleared');

-- แถวที่ยืนยันไว้แล้ว (จำลองว่ายืนยันเมื่อวันก่อน)
UPDATE monthly_branch_snapshots SET confirmed_at = '2026-11-02 09:00+07', confirmed_by = '00000000-0000-0000-0000-0000000000e1'
 WHERE month_key = '2026-12';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
UPDATE monthly_branch_snapshots SET confirmed_at = '2020-01-01', confirmed_by = '00000000-0000-0000-0000-0000000000e3'
 WHERE month_key = '2026-12';
RESET ROLE;
SELECT is((SELECT row(confirmed_at, confirmed_by)::text FROM monthly_branch_snapshots WHERE month_key = '2026-12'),
  row('2026-11-02 09:00+07'::timestamptz, '00000000-0000-0000-0000-0000000000e1'::uuid)::text,
  'update with no data change keeps the original stamp (client values ignored)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
UPDATE monthly_branch_snapshots SET v_s1 = 1200 WHERE month_key = '2026-12';
RESET ROLE;
SELECT is((SELECT row(confirmed_at, confirmed_by)::text FROM monthly_branch_snapshots WHERE month_key = '2026-12'),
  row(now(), '00000000-0000-0000-0000-0000000000e1'::uuid)::text, 'saving changed numbers re-stamps now() + host');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
UPDATE monthly_branch_snapshots SET confirmed_at = NULL WHERE month_key = '2026-12';
RESET ROLE;
SELECT is((SELECT row(confirmed_at, confirmed_by)::text FROM monthly_branch_snapshots WHERE month_key = '2026-12'),
  row(NULL::timestamptz, NULL::uuid)::text, 'clearing confirmed_at clears both');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
UPDATE monthly_branch_snapshots SET confirmed_at = '2020-01-01' WHERE month_key = '2026-12';
RESET ROLE;
SELECT is((SELECT row(confirmed_at, confirmed_by)::text FROM monthly_branch_snapshots WHERE month_key = '2026-12'),
  row(now(), '00000000-0000-0000-0000-0000000000e1'::uuid)::text, '"ยืนยันใช้ค่าเดิม" on an unconfirmed row stamps now() + host');

-- =====================================================================
-- 5. audit — ลงแถวเดียว ด้วยค่าที่คำนวณแล้ว
-- =====================================================================
DELETE FROM audit_log;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source, s1, v_s1, cust, value, confirmed_at)
  SELECT '2027-02', prov2_id, 'manual', 2, 4000, 99, 1, now() FROM _b;
UPDATE monthly_branch_snapshots SET s3 = 1, v_s3 = 500 WHERE month_key = '2027-02';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'monthly_branch_snapshots' AND action = 'insert'), 1,
  'one audit row for the insert');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'monthly_branch_snapshots' AND action = 'update'), 1,
  'one audit row for the update (recompute adds none)');
SELECT is((SELECT row(new_data ->> 'cust', new_data ->> 'value', new_data ->> 'confirmed_by', changed_by)::text FROM audit_log
            WHERE table_name = 'monthly_branch_snapshots' AND action = 'insert'),
  row('2', '4000.00', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1'::uuid)::text,
  'audit stores the recomputed totals and the server stamp');

-- =====================================================================
-- 6. RPC ของ M39 (SECURITY DEFINER) ยังเขียนแถว computed ได้
-- =====================================================================
CREATE TEMP TABLE _j (k text PRIMARY KEY, v jsonb);
GRANT ALL ON _j TO PUBLIC;
INSERT INTO _j
SELECT 'good', jsonb_agg(jsonb_build_object(
         'branch_id', b.id, 's1', 1, 's3', 0, 'm1', 0, 'm3', 0, 'l1', 0, 'l3', 0, 'xl1', 0, 'xl3', 0,
         'cust', 1, 'vS', 100, 'vM', 0, 'vL', 0, 'vXL', 0, 'value', 100))
  FROM branches b WHERE b.division = 'central';
INSERT INTO _j
SELECT 'changed', jsonb_agg(CASE WHEN (e ->> 'branch_id')::uuid = (SELECT cen_id FROM _b)
                                 THEN e || '{"vS": 200, "value": 200}'::jsonb ELSE e END)
  FROM _j, jsonb_array_elements(v) e WHERE k = 'good';

SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT lives_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000e1', '2026-09', 'central',
                                                (SELECT v FROM _j WHERE k = 'good'), 'เหตุผลทดสอบ M40')$$,
  'close_month_part (DEFINER) still writes the 24 computed central rows');
SELECT is((public.resync_month_part('00000000-0000-0000-0000-0000000000e1', '2026-09', 'central', (SELECT v FROM _j WHERE k = 'changed'))
           ->> 'changed_branches')::int, 1, 'resync_month_part (DEFINER) still rewrites a computed row');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots s JOIN branches b ON b.id = s.branch_id
            WHERE s.month_key = '2026-09' AND s.source = 'computed' AND b.division = 'central'),
  (SELECT count(*)::int FROM branches WHERE division = 'central'), 'all central computed rows exist for 2026-09');
SELECT is((SELECT row(cust, value)::text FROM monthly_branch_snapshots WHERE month_key = '2026-09' AND branch_id = (SELECT cen_id FROM _b)),
  row(1, 200.00::numeric(14,2))::text, 'computed totals stored as the server sent them (no manual recompute)');

-- =====================================================================
-- 7. (d) list_post_close_edits
-- =====================================================================
-- ปิด 2026-10 ทั้ง 2 ส่วน (postgres ตรง — กำหนดเวลาเองได้) · ส่วนกลางคำนวณใหม่ภายหลัง
INSERT INTO month_closures (month_key, scope, closed_by, closed_at, last_resync_at) VALUES
  ('2026-10', 'central',  '00000000-0000-0000-0000-0000000000e1', '2026-11-01 10:00+07', '2026-11-03 10:00+07'),
  ('2026-10', 'province', '00000000-0000-0000-0000-0000000000e1', '2026-11-01 10:00+07', NULL);

DELETE FROM audit_log;
INSERT INTO audit_log (table_name, action, old_data, new_data, changed_by, changed_at, branch_id, month_key, actor_position_code)
SELECT t.tbl, t.act::public.audit_action, '{"secret":"old"}', '{"secret":"new"}', t.who, t.at, t.br, t.mk, t.pos
  FROM _b, LATERAL (VALUES
    -- ส่วนกลาง: ก่อนปิด / ระหว่างปิดกับคำนวณใหม่ / หลังคำนวณใหม่ (แสดง) / เดือนอื่น / branch ว่าง / ตารางปิดเดือน
    ('visits',          'update', '00000000-0000-0000-0000-0000000000e3'::uuid, '2026-10-31 10:00+07'::timestamptz, cen_id, '2026-10', 'supervisor'),
    ('station_checks',  'update', '00000000-0000-0000-0000-0000000000e3'::uuid, '2026-11-02 10:00+07'::timestamptz, cen_id, '2026-10', 'supervisor'),
    ('visits',          'delete', '00000000-0000-0000-0000-0000000000e3'::uuid, '2026-11-04 10:00+07'::timestamptz, cen_id, '2026-10', 'supervisor'),
    ('station_checks',  'update', '00000000-0000-0000-0000-0000000000e1'::uuid, '2026-11-05 10:00+07'::timestamptz, cen_id, '2026-10', 'pm'),
    ('visits',          'update', '00000000-0000-0000-0000-0000000000e3'::uuid, '2026-11-05 10:00+07'::timestamptz, cen_id, '2026-09', 'supervisor'),
    ('visits',          'update', '00000000-0000-0000-0000-0000000000e3'::uuid, '2026-11-05 10:00+07'::timestamptz, NULL::uuid, '2026-10', 'supervisor'),
    ('month_closures',  'update', '00000000-0000-0000-0000-0000000000e1'::uuid, '2026-11-05 10:00+07'::timestamptz, cen_id, '2026-10', 'pm'),
    -- ต่างจังหวัด: ก่อนปิด / หลังปิด (แสดงเฉพาะใน province)
    ('monthly_branch_snapshots', 'update', '00000000-0000-0000-0000-0000000000e1'::uuid, '2026-10-30 10:00+07'::timestamptz, prov_id, '2026-10', 'pm'),
    ('monthly_branch_snapshots', 'update', '00000000-0000-0000-0000-0000000000e1'::uuid, '2026-11-06 10:00+07'::timestamptz, prov_id, '2026-10', 'pm')
  ) AS t(tbl, act, who, at, br, mk, pos);

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
SELECT is((SELECT array_agg(table_name || ':' || action ORDER BY changed_at) FROM public.list_post_close_edits('2026-10', 'central')),
  ARRAY['visits:delete', 'station_checks:update'],
  'host central: only edits after the later of closed_at / last_resync_at · no other month / null branch / closure rows');
SELECT is((SELECT row(branch_id, branch_name, actor_name, actor_position_code, actor_position_name)::text
             FROM public.list_post_close_edits('2026-10', 'central') WHERE action = 'update'),
  (SELECT row(cen_id, (SELECT name FROM branches WHERE id = cen_id), 'host', 'pm', (SELECT name_th FROM positions WHERE code = 'pm'))::text FROM _b),
  'row carries branch name + actor name + position');
SELECT is((SELECT array_agg(table_name) FROM public.list_post_close_edits('2026-10', 'province')),
  ARRAY['monthly_branch_snapshots'], 'host province: only the province edit after close');
SELECT is((SELECT count(*)::int FROM public.list_post_close_edits('2026-08', 'central')), 0, 'part not closed → 0 rows');
SELECT throws_ok($$SELECT * FROM public.list_post_close_edits('2026-13', 'central')$$, 'MC001', NULL, 'bad month → MC001');
SELECT throws_ok($$SELECT * FROM public.list_post_close_edits('2026-10', NULL)$$, 'MC001', NULL, 'null scope → MC001');

SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
SELECT is((SELECT count(*)::int FROM public.list_post_close_edits('2026-10', 'central')), 2, 'central recorder sees central edits');
SELECT is((SELECT actor_name FROM public.list_post_close_edits('2026-10', 'central') WHERE action = 'delete'),
  'recorder', 'central recorder sees who edited');
SELECT throws_ok($$SELECT * FROM public.list_post_close_edits('2026-10', 'province')$$, '42501', NULL, 'central recorder: province → 42501');
SELECT is((SELECT count(*)::int FROM audit_log), 0, 'recorder still cannot read audit_log directly');

SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e4');
SELECT throws_ok($$SELECT * FROM public.list_post_close_edits('2026-10', 'central')$$, '42501', NULL, 'recorder without central scope → 42501');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
SELECT throws_ok($$SELECT * FROM public.list_post_close_edits('2026-10', 'central')$$, '42501', NULL, 'inactive recorder → 42501');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
SELECT throws_ok($$SELECT * FROM public.list_post_close_edits('2026-10', 'central')$$, '42501', NULL, 'admin → 42501');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e6');
SELECT throws_ok($$SELECT * FROM public.list_post_close_edits('2026-10', 'central')$$, '42501', NULL, 'viewer → 42501');
SELECT throws_ok($$SELECT * FROM public.list_post_close_edits('2026-10', '2026-13')$$, '22P02', NULL, 'bad scope literal rejected by the enum');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.no_user();
SELECT throws_ok($$SELECT * FROM public.list_post_close_edits('2026-10', 'central')$$, '42501', NULL, 'anon → 42501');
RESET ROLE;

-- แก้จริงผ่าน trigger หลังปิดต่างจังหวัด → ขึ้นในรายการ (เวลาปิด 1 พ.ย. < now() ของเทส)
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
UPDATE monthly_branch_snapshots SET m3 = 1, v_m3 = 70000 WHERE month_key = '2026-10' AND source = 'manual';
SELECT is((SELECT count(*)::int FROM public.list_post_close_edits('2026-10', 'province')), 2,
  'a real manual edit after the province close is listed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
