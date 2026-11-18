-- M39 (20261115270000): ปิดเดือน 2 ส่วน · คำนวณ snapshot ใหม่ · แก้ผู้ปิด · สถานะแบบแคบ · month_closures RPC-only
--   * close_month_part / resync_month_part: service role เท่านั้น + ตรวจสิทธิ์ผู้กด (p_actor) ซ้ำ · audit ในนามผู้กด
--   * ปิดส่วนกลาง = host หรือ recorder ส่วนกลาง · ต่างจังหวัด / คำนวณใหม่ / ปิดข้าม = host
--   * "พร้อมปิด" = ไม่มีสัญญาส่วนกลางค้างบริการเดือนนั้น (เกณฑ์เดียวกับ list_pending_missed_services)
--   * month_closures: เขียนตรงไม่ได้ทุก role · อ่านเหมือนเดิม
--   * start_sync_log(p_source, p_actor): close/resync = service role ในนามผู้กด
-- go-live ในเทส = 2026-09 → ปิดได้ 2026-09 (recorder หลังบันทึกครบ) และ 2026-10 (host ปิดข้าม)
-- ข้อมูลสมมติทั้งหมด
BEGIN;
SELECT plan(109);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recprov@test.local'),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recoff@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope, position_code) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'host',     'user_b1', 'host',     '{central,province}', 'pm'),
  ('00000000-0000-0000-0000-0000000000b2', 'admin',    'user_b2', 'admin',    '{central}',          'job_admin'),
  ('00000000-0000-0000-0000-0000000000b3', 'recorder', 'user_b3', 'recorder', '{central}',          'supervisor'),
  ('00000000-0000-0000-0000-0000000000b4', 'viewer',   'user_b4', 'viewer',   '{central}',          NULL),
  ('00000000-0000-0000-0000-0000000000b5', 'recprov',  'user_b5', 'recorder', '{province}',         'supervisor'),
  ('00000000-0000-0000-0000-0000000000b6', 'recoff',   'user_b6', 'recorder', '{central}',          'supervisor');
UPDATE profiles SET is_active = false WHERE user_id = '00000000-0000-0000-0000-0000000000b6';

UPDATE app_settings SET go_live_month = '2026-09-01';

-- สัญญาส่วนกลาง 1 ราย (สาขาแรกตามชื่อ) ตั้งสถานีแล้ว ยังไม่มีการเข้า → ค้างบริการ ก.ย. + ต.ค.
CREATE TEMP TABLE _b AS SELECT (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1) AS cen_id;
GRANT ALL ON _b TO PUBLIC;
INSERT INTO customers (id, branch_id, name)
  SELECT '00000000-0000-0000-0000-0000000000c1', cen_id, 'Central' FROM _b;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_months, value_total, stations_initialized_at)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'T-53', '2026-09-01', 12, 50000,
          '2026-09-01 09:00+07');

-- แถวส่วนกลางที่ server คำนวณ (จำลอง) · ค่าเดียวกันทุกสาขา
CREATE TEMP TABLE _j (k text PRIMARY KEY, v jsonb);
GRANT ALL ON _j TO PUBLIC;
INSERT INTO _j
SELECT 'good', jsonb_agg(jsonb_build_object(
         'branch_id', b.id, 's1', 1, 's3', 0, 'm1', 0, 'm3', 0, 'l1', 0, 'l3', 0, 'xl1', 0, 'xl3', 0,
         'cust', 1, 'vS', 100, 'vM', 0, 'vL', 0, 'vXL', 0, 'value', 100))
  FROM branches b WHERE b.division = 'central';
INSERT INTO _j SELECT 'short', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(v) e LIMIT 23) x) FROM _j WHERE k = 'good';
INSERT INTO _j SELECT 'negative', jsonb_set(v, '{0,s1}', '-1') FROM _j WHERE k = 'good';
INSERT INTO _j SELECT 'province_row', (SELECT jsonb_agg(jsonb_set(e, '{branch_id}', to_jsonb(
         (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1))))
       FROM (SELECT e FROM jsonb_array_elements(v) e LIMIT 1) x) || (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(v) e OFFSET 1) y)
  FROM _j WHERE k = 'good';
INSERT INTO _j
SELECT 'changed', jsonb_agg(CASE WHEN (e ->> 'branch_id')::uuid = (SELECT cen_id FROM _b)
                                 THEN e || '{"vS": 200, "value": 200}'::jsonb ELSE e END)
  FROM _j, jsonb_array_elements(v) e WHERE k = 'good';

-- ล้างผู้ใช้ใน claim ก่อนเรียกแบบ service role — พิสูจน์ว่า audit ได้ผู้กดจาก p_actor ไม่ใช่ค่าที่ค้างอยู่
CREATE FUNCTION pg_temp.no_user() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
$$;

-- =====================================================================
-- 1. โครงสร้าง / สิทธิ์
-- =====================================================================
SELECT has_table('public', 'month_closure_overrides', 'month_closure_overrides exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.month_closure_overrides'::regclass), 'RLS is enabled on overrides');
SELECT ok(NOT has_table_privilege('anon', 'public.month_closure_overrides', 'SELECT'), 'anon cannot read overrides');
SELECT ok(has_table_privilege('authenticated', 'public.month_closure_overrides', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.month_closure_overrides', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.month_closure_overrides', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.month_closure_overrides', 'DELETE'),
  'authenticated: SELECT only on overrides');
SELECT has_trigger('public', 'monthly_branch_snapshots', 'audit_snapshots_computed_update', 'computed-update audit trigger exists');
SELECT ok(has_function_privilege('service_role', 'public.close_month_part(uuid, text, public.closure_scope, jsonb, text, boolean)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.close_month_part(uuid, text, public.closure_scope, jsonb, text, boolean)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.close_month_part(uuid, text, public.closure_scope, jsonb, text, boolean)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.resync_month_part(uuid, text, public.closure_scope, jsonb, timestamptz)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.resync_month_part(uuid, text, public.closure_scope, jsonb, timestamptz)', 'EXECUTE'),
  'close/resync RPCs: service_role only (callers cannot send numbers)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.month_close_write_central_rows(text, jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('service_role', 'public.month_close_as_actor(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('service_role', 'public.central_unready_branches(text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.month_close_actor_can(uuid, public.closure_scope, text)', 'EXECUTE'),
  'internal helpers are not callable by API roles');
SELECT ok(has_function_privilege('authenticated', 'public.can_close_month_part(public.closure_scope)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.can_close_month_part(public.closure_scope)', 'EXECUTE'),
  'can_close_month_part: authenticated yes · anon no');
SELECT ok(NOT has_function_privilege('anon', 'public.get_sync_status()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.list_month_closures(text, text)', 'EXECUTE'),
  'anon cannot execute status RPCs');
SELECT is((SELECT array_agg(policyname::text) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'month_closures'),
  ARRAY['month_closures_select'], 'month_closures keeps only the read policy');
SELECT ok(NOT has_table_privilege('authenticated', 'public.month_closures', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.month_closures', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.month_closures', 'DELETE')
          AND NOT has_table_privilege('service_role', 'public.month_closures', 'INSERT')
          AND NOT has_table_privilege('service_role', 'public.month_closures', 'UPDATE')
          AND NOT has_table_privilege('service_role', 'public.month_closures', 'DELETE')
          AND has_table_privilege('authenticated', 'public.month_closures', 'SELECT'),
  'month_closures: no direct writes for authenticated / service_role · read kept');

-- =====================================================================
-- 2. ผู้ใช้: can_close_month_part · เรียก RPC เขียนตรงไม่ได้ · เขียนตารางตรงไม่ได้
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT ok(public.can_close_month_part('central') AND public.can_close_month_part('province'), 'host may close both parts');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'province', NULL, NULL, true)$$,
  '42501', NULL, 'host cannot call close_month_part directly');
SELECT throws_ok($$INSERT INTO month_closures (month_key, scope) VALUES ('2026-10', 'province')$$,
  '42501', NULL, 'host cannot insert month_closures directly');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT ok(public.can_close_month_part('central') AND NOT public.can_close_month_part('province'),
  'central recorder may close central only');
SELECT throws_ok($$INSERT INTO month_closures (month_key, scope) VALUES ('2026-10', 'central')$$,
  '42501', NULL, 'recorder cannot insert month_closures directly');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b5', true);
SELECT ok(NOT public.can_close_month_part('central'), 'province-only recorder cannot close central');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b6', true);
SELECT ok(NOT public.can_close_month_part('central'), 'deactivated recorder cannot close');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
SELECT ok(NOT public.can_close_month_part('central'), 'admin cannot close');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b4', true);
SELECT ok(NOT public.can_close_month_part('central'), 'viewer cannot close');
RESET ROLE;

-- =====================================================================
-- 3. service role: ตรวจสิทธิ์ผู้กด + ด่านเดือน/แถว
-- =====================================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT throws_ok($$SELECT public.close_month_part(NULL, '2026-10', 'province', NULL, NULL, true)$$,
  '42501', NULL, 'no actor → 42501');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b2', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'))$$,
  '42501', NULL, 'actor admin → 42501');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b3', '2026-10', 'province', NULL, NULL, true)$$,
  '42501', NULL, 'actor recorder closing province → 42501');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b5', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'))$$,
  '42501', NULL, 'actor province-only recorder closing central → 42501');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b6', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'))$$,
  '42501', NULL, 'actor deactivated recorder → 42501');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-13', 'central', (SELECT v FROM _j WHERE k = 'good'), 'เหตุผลทดสอบ')$$,
  'MC001', NULL, 'bad month → MC001');
SELECT throws_ok(format('SELECT public.close_month_part(%L, %L, %L, NULL, NULL, true)',
                        '00000000-0000-0000-0000-0000000000b1', to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM'), 'province'),
  'MC002', NULL, 'current month (Bangkok) → MC002');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-08', 'province', NULL, NULL, true)$$,
  'MC003', NULL, 'month before go-live → MC003');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'short'), 'เหตุผลทดสอบ')$$,
  'MC005', NULL, '23 central rows → MC005');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'negative'), 'เหตุผลทดสอบ')$$,
  'MC005', NULL, 'negative count → MC005');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'province_row'), 'เหตุผลทดสอบ')$$,
  'MC005', NULL, 'a province branch in central rows → MC005');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', '{"x":1}'::jsonb, 'เหตุผลทดสอบ')$$,
  'MC005', NULL, 'rows not an array → MC005');
RESET ROLE;

-- =====================================================================
-- 4. ความพร้อม (ค้างบริการ) — เกณฑ์เดียวกับ list_pending_missed_services
-- =====================================================================
SELECT is((SELECT array_agg(row(branch_id, pending_count)::text) FROM public.central_unready_branches('2026-10')),
  ARRAY[(SELECT row(cen_id, 1)::text FROM _b)], 'contract without a visit → its branch is not ready (1 pending)');
CREATE TEMP TABLE _pending (missed_month date, branch_id uuid);
GRANT ALL ON _pending TO PUBLIC;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
INSERT INTO _pending
  SELECT p.missed_month, p.branch_id FROM public.list_pending_missed_services(NULL, '2026-11-01') p
    JOIN branches b ON b.id = p.branch_id AND b.division = 'central';
RESET ROLE;
SELECT is((SELECT array_agg(branch_id ORDER BY branch_id) FROM _pending WHERE missed_month = '2026-10-01'),
  (SELECT array_agg(branch_id ORDER BY branch_id) FROM public.central_unready_branches('2026-10')),
  'drift guard: same branches as list_pending_missed_services for 2026-10');
INSERT INTO missed_service_notes (contract_id, missed_month, note)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-10-01', 'ลูกค้าไม่อยู่');
SELECT is((SELECT count(*)::int FROM public.central_unready_branches('2026-10')), 0,
  'missed + missed-service note → recorded, branch ready (owner 18 Nov: notes count for readiness only)');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT is((SELECT count(*)::int FROM public.list_pending_missed_services(NULL, '2026-11-01')
            WHERE missed_month = '2026-10-01' AND contract_id = '00000000-0000-0000-0000-0000000000d1'),
  1, 'the noted month is still pending in list_pending_missed_services (note only affects readiness)');
RESET ROLE;
DELETE FROM missed_service_notes WHERE contract_id = '00000000-0000-0000-0000-0000000000d1';
SELECT is((SELECT count(*)::int FROM public.central_unready_branches('2026-10')), 1, 'missed without a note → not ready');
INSERT INTO missed_service_resolutions (contract_id, missed_month, kind, reason)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-10-01', 'waived', 'ลูกค้าขอเลื่อน');
SELECT is((SELECT count(*)::int FROM public.central_unready_branches('2026-10')), 0, 'a waived month counts as recorded');
DELETE FROM missed_service_resolutions WHERE contract_id = '00000000-0000-0000-0000-0000000000d1';

-- =====================================================================
-- 5. recorder ปิดส่วนกลาง ก.ย.: ไม่พร้อม → MC006 / MC014 · บันทึกครบแล้ว → ปิดได้ (audit ในนาม recorder)
-- =====================================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b3', '2026-09', 'central', (SELECT v FROM _j WHERE k = 'good'))$$,
  'MC006', NULL, 'recorder: branch not ready → MC006');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b3', '2026-09', 'central', (SELECT v FROM _j WHERE k = 'good'), 'ขอปิดก่อน')$$,
  'MC014', NULL, 'recorder sending an override reason → MC014');
RESET ROLE;
INSERT INTO visits (contract_id, visit_date, visit_type, start_time, end_time)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-09-15', 'routine', '09:00', '10:00');
SELECT is((SELECT count(*)::int FROM public.central_unready_branches('2026-09')), 0, 'routine visit in September → ready');
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT is((public.close_month_part('00000000-0000-0000-0000-0000000000b3', '2026-09', 'central', (SELECT v FROM _j WHERE k = 'good'))
           ->> 'overridden')::boolean, false, 'central recorder closes a ready month (no override)');
RESET ROLE;
SELECT is((SELECT closed_by FROM month_closures WHERE month_key = '2026-09' AND scope = 'central'),
  '00000000-0000-0000-0000-0000000000b3'::uuid, 'closed_by = actor (recorder)');
SELECT is((SELECT row(changed_by, actor_position_code)::text FROM audit_log
            WHERE table_name = 'month_closures' AND action = 'insert' AND month_key = '2026-09'),
  row('00000000-0000-0000-0000-0000000000b3'::uuid, 'supervisor')::text,
  'closure audited in the name of the actor (not the service role)');
SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots s JOIN branches b ON b.id = s.branch_id
            WHERE s.month_key = '2026-09' AND s.source = 'computed' AND b.division = 'central'),
  24, '24 computed central rows stored for 2026-09');
SELECT is((SELECT count(*)::int FROM month_closure_overrides WHERE month_key = '2026-09'), 0, 'no override row when ready');

-- =====================================================================
-- 6. host ปิดส่วนกลาง ต.ค. (ยังค้าง) ด้วยเหตุผล
-- =====================================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'))$$,
  'MC006', NULL, 'host: not ready and no reason → MC006');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'), '  ab  ')$$,
  'MC007', NULL, 'reason shorter than 5 chars → MC007');
SELECT throws_ok(format('SELECT public.close_month_part(%L, %L, %L, (SELECT v FROM _j WHERE k = %L), %L)',
                        '00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', 'good', repeat(chr(10) || chr(9), 3)),
  'MC007', NULL, 'whitespace-only reason (newlines/tabs) → MC007');
RESET ROLE;

-- แถว legacy ของสาขาส่วนกลางในเดือนนั้น → ไม่เขียนทับ (MC008)
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source) SELECT '2026-10', cen_id, 'legacy' FROM _b;
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'), 'เหตุผลทดสอบ')$$,
  'MC008', NULL, 'existing legacy row for a central branch → MC008');
RESET ROLE;
DELETE FROM monthly_branch_snapshots WHERE month_key = '2026-10';
SELECT is((SELECT count(*)::int FROM month_closures WHERE month_key = '2026-10'), 0, 'failed closes leave no closure row');

SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT is((public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'),
                                   '  ยังไม่ได้เข้าลูกค้า 1 ราย  ') ->> 'overridden')::boolean,
  true, 'host closes central with an override reason');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'), 'เหตุผลทดสอบ')$$,
  'MC004', NULL, 'closing the same part again → MC004');
RESET ROLE;
SELECT is((SELECT row(reason, unconfirmed_branch_ids, overridden_by)::text FROM month_closure_overrides WHERE month_key = '2026-10'),
  row('ยังไม่ได้เข้าลูกค้า 1 ราย', ARRAY[(SELECT cen_id FROM _b)], '00000000-0000-0000-0000-0000000000b1'::uuid)::text,
  'override stores trimmed reason, the not-ready branch, who');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'month_closure_overrides' AND action = 'insert'
            AND changed_by = '00000000-0000-0000-0000-0000000000b1'),
  1, 'override audited in the name of the host');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'monthly_branch_snapshots' AND month_key IN ('2026-09', '2026-10')
            AND action <> 'delete'),
  0, 'computed snapshot inserts on close are not audited');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT is((SELECT count(*)::int FROM month_closure_overrides), 1, 'host reads the override');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
SELECT is((SELECT count(*)::int FROM month_closure_overrides), 0, 'admin reads 0 overrides');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT is((SELECT count(*)::int FROM month_closure_overrides), 0, 'recorder reads 0 overrides');
SELECT throws_ok($$INSERT INTO month_closure_overrides (month_key, scope, reason) VALUES ('2026-09', 'central', 'เหตุผลทดสอบ')$$,
  '42501', NULL, 'direct insert into overrides is denied');
RESET ROLE;

-- =====================================================================
-- 7. ต่างจังหวัด (host)
-- =====================================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'province', (SELECT v FROM _j WHERE k = 'good'), NULL, true)$$,
  'MC005', NULL, 'province close does not accept rows → MC005');
SELECT throws_ok($$SELECT public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'province')$$,
  'MC009', NULL, 'carried branches not acknowledged → MC009');
SELECT is((public.close_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'province', NULL, NULL, true) ->> 'carried_count')::int,
  19, 'province closes after acknowledging 19 carried branches');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM month_closures WHERE month_key = '2026-10'), 2, 'both parts of 2026-10 closed');

-- =====================================================================
-- 8. resync (service role · actor host)
-- =====================================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT throws_ok($$SELECT public.resync_month_part('00000000-0000-0000-0000-0000000000b3', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'changed'))$$,
  '42501', NULL, 'actor recorder cannot resync');
SELECT throws_ok($$SELECT public.resync_month_part('00000000-0000-0000-0000-0000000000b1', '2026-08', 'central', (SELECT v FROM _j WHERE k = 'changed'))$$,
  'MC010', NULL, 'resync of a part that is not closed → MC010');
SELECT throws_ok($$SELECT public.resync_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'short'))$$,
  'MC005', NULL, 'resync with bad rows → MC005');
SELECT is((public.resync_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'changed')) ->> 'changed_branches')::int,
  1, 'resync rewrites only the changed branch');
SELECT is((public.resync_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'changed')) ->> 'changed_branches')::int,
  0, 'resync with identical numbers changes nothing');
SELECT throws_ok(format('SELECT public.resync_month_part(%L, %L, %L, (SELECT v FROM _j WHERE k = %L), %L)',
                        '00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', 'good', now() - interval '1 minute'),
  'MC013', NULL, 'resync computed before the latest resync → MC013');
SELECT throws_ok($$SELECT public.resync_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'province', (SELECT v FROM _j WHERE k = 'good'))$$,
  'MC005', NULL, 'province resync does not accept rows → MC005');
SELECT is((public.resync_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'province') ->> 'changed_branches')::int,
  0, 'province resync = re-send only');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'monthly_branch_snapshots' AND action = 'update'
            AND changed_by = '00000000-0000-0000-0000-0000000000b1'
            AND (old_data ->> 'value')::numeric = 100 AND (new_data ->> 'value')::numeric = 200),
  1, 'resync audit row has old/new value in the name of the host');
SELECT is((SELECT count(*)::int FROM month_closures WHERE month_key = '2026-10'
            AND last_resync_by = '00000000-0000-0000-0000-0000000000b1' AND last_resync_at IS NOT NULL),
  2, 'last_resync_at / by set on both parts');

-- ลบแถว computed ตรง ลงประวัติ · resync เติมแถวที่หายของเดือนที่ปิดแล้ว ลงประวัติ
DELETE FROM monthly_branch_snapshots WHERE month_key = '2026-10' AND branch_id = (SELECT cen_id FROM _b);
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'monthly_branch_snapshots' AND action = 'delete'
            AND month_key = '2026-10'), 1, 'deleting a computed row is audited');
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT is((public.resync_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'changed'), now())
           ->> 'changed_branches')::int, 1, 'resync re-creates the missing row');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'monthly_branch_snapshots' AND action = 'insert'
            AND month_key = '2026-10' AND changed_by = '00000000-0000-0000-0000-0000000000b1'),
  1, 'computed insert into a closed month is audited');

-- คงยืนยัน (confirmed_at) เดิมเมื่อ resync
UPDATE monthly_branch_snapshots SET confirmed_at = now() WHERE month_key = '2026-10' AND source = 'computed';
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT lives_ok($$SELECT public.resync_month_part('00000000-0000-0000-0000-0000000000b1', '2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'))$$,
  'resync back to the original numbers');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots WHERE month_key = '2026-10' AND source = 'computed' AND confirmed_at IS NULL),
  0, 'resync keeps confirmed_at');

-- =====================================================================
-- 9. set_month_closer (DECISIONS 5.8 · JWT ของ host)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'central', '00000000-0000-0000-0000-0000000000b3', '2026-11-02 09:00+07')$$,
  '42501', NULL, 'recorder cannot edit the closer');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT throws_ok($$SELECT public.set_month_closer('2026-08', 'central', '00000000-0000-0000-0000-0000000000b3', '2026-11-02 09:00+07')$$,
  'MC010', NULL, 'closer of a part that is not closed → MC010');
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'central', '00000000-0000-0000-0000-0000000000b4', '2026-11-02 09:00+07')$$,
  'MC011', NULL, 'viewer as closer → MC011');
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'province', '00000000-0000-0000-0000-0000000000b3', '2026-11-02 09:00+07')$$,
  'MC011', NULL, 'recorder as province closer → MC011');
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'central', '00000000-0000-0000-0000-0000000000b6', '2026-11-02 09:00+07')$$,
  'MC011', NULL, 'deactivated recorder as closer → MC011');
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'central', '00000000-0000-0000-0000-0000000000b5', '2026-11-02 09:00+07')$$,
  'MC011', NULL, 'province-only recorder as central closer → MC011');
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'central', '00000000-0000-0000-0000-0000000000b3', '2026-10-31 23:00+07')$$,
  'MC012', NULL, 'closed_at before the month ended (Bangkok) → MC012');
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'central', '00000000-0000-0000-0000-0000000000b3', now() + interval '1 day')$$,
  'MC012', NULL, 'closed_at in the future → MC012');
SELECT lives_ok($$SELECT public.set_month_closer('2026-10', 'central', '00000000-0000-0000-0000-0000000000b3', '2026-11-01 00:00+07')$$,
  'host sets recorder as central closer at the first allowed instant');
RESET ROLE;
SELECT is((SELECT row(closed_by, closed_at)::text FROM month_closures WHERE month_key = '2026-10' AND scope = 'central'),
  row('00000000-0000-0000-0000-0000000000b3'::uuid, '2026-11-01 00:00+07'::timestamptz)::text, 'closer + time updated');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'month_closures' AND action = 'update'
            AND changed_by = '00000000-0000-0000-0000-0000000000b1'
            AND old_data ->> 'closed_by' = '00000000-0000-0000-0000-0000000000b1'
            AND new_data ->> 'closed_by' = '00000000-0000-0000-0000-0000000000b3'),
  1, 'closer edit audited with old/new');

-- =====================================================================
-- 10. start_sync_log(p_source, p_actor) / finish_sync_log: close / resync
-- =====================================================================
CREATE TEMP TABLE _ids (k text PRIMARY KEY, id bigint);
GRANT ALL ON _ids TO PUBLIC;
SELECT ok(has_function_privilege('authenticated', 'public.start_sync_log(text, uuid)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.start_sync_log(text, uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.start_sync_log(text, uuid)', 'EXECUTE'),
  'start_sync_log(text, uuid): authenticated/service_role yes · anon no');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT throws_ok($$SELECT public.start_sync_log('close', '00000000-0000-0000-0000-0000000000b1')$$,
  '42501', NULL, 'a user cannot open a close run (server only)');
SELECT throws_ok($$SELECT public.start_sync_log('export')$$, 'SY002', NULL, 'export still unsupported → SY002');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT throws_ok($$SELECT public.start_sync_log('close')$$, '42501', NULL, 'close run without actor → 42501');
SELECT throws_ok($$SELECT public.start_sync_log('close', '00000000-0000-0000-0000-0000000000b4')$$,
  '42501', NULL, 'close run for a viewer → 42501');
SELECT throws_ok($$SELECT public.start_sync_log('resync', '00000000-0000-0000-0000-0000000000b3')$$,
  '42501', NULL, 'resync run for a recorder → 42501');
INSERT INTO _ids VALUES ('c1', public.start_sync_log('close', '00000000-0000-0000-0000-0000000000b3'));
SELECT is((SELECT triggered_by FROM sync_logs WHERE id = (SELECT id FROM _ids WHERE k = 'c1')),
  '00000000-0000-0000-0000-0000000000b3'::uuid, 'close run opened for the recorder (triggered_by = actor)');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT throws_ok(format('SELECT public.finish_sync_log(%s, %L)', (SELECT id FROM _ids WHERE k = 'c1'), 'success'),
  '42501', NULL, 'a user cannot finish a server close run');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.no_user();
SELECT lives_ok(format('SELECT public.finish_sync_log(%s, %L, %L)', (SELECT id FROM _ids WHERE k = 'c1'), 'failed', 'github_502'),
  'server finishes the close run');
INSERT INTO _ids VALUES ('r1', public.start_sync_log('resync', '00000000-0000-0000-0000-0000000000b1'));
SELECT lives_ok(format('SELECT public.finish_sync_log(%s, %L)', (SELECT id FROM _ids WHERE k = 'r1'), 'skipped'),
  'server opens and finishes a resync run for the host');
RESET ROLE;

-- =====================================================================
-- 11. get_sync_status / list_month_closures
-- =====================================================================
INSERT INTO sync_logs (source, triggered_by, started_at, finished_at, result, error_code, error_message)
VALUES ('auto', NULL, now() - interval '2 days', now() - interval '2 days', 'failed', 'github_401', 'token secret detail'),
       ('auto', NULL, now() - interval '1 day',  now() - interval '1 day',  'success', NULL, NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT is((SELECT count(*)::int FROM public.get_sync_status()), 3, 'recorder sees one row per source (auto, close, resync)');
SELECT is((SELECT row(result, error_code)::text FROM public.get_sync_status() WHERE source = 'auto'),
  row('success', NULL::text)::text, 'latest auto run is returned');
SELECT is((SELECT row(result, error_code)::text FROM public.get_sync_status() WHERE source = 'close'),
  row('failed', 'github_502')::text, 'close run status + error_code');
SELECT is((SELECT count(*)::int FROM sync_logs), 0, 'recorder still cannot read sync_logs directly');
SELECT is((SELECT closed_by_name FROM public.list_month_closures('2026-10', '2026-10') WHERE scope = 'central'),
  'recorder', 'list_month_closures returns the closer display name');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
SELECT is((SELECT count(*)::int FROM public.list_month_closures()), 3, 'admin lists closures');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b4', true);
SELECT throws_ok($$SELECT * FROM public.get_sync_status()$$, '42501', NULL, 'viewer cannot read sync status');
SELECT throws_ok($$SELECT * FROM public.list_month_closures()$$, '42501', NULL, 'viewer cannot list closures');
RESET ROLE;

SELECT ok(pg_get_function_result('public.get_sync_status()'::regprocedure) !~ '(error_message|triggered_by)',
  'get_sync_status exposes no error_message / triggered_by');

SELECT * FROM finish();
ROLLBACK;
