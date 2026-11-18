-- M39 (20261115270000): ปิดเดือน 2 ส่วน · คำนวณ snapshot ใหม่ · แก้ผู้ปิด · สถานะแบบแคบ · start/finish_sync_log close/resync
--   * close_month_part: host เท่านั้น · MC001–MC009 · ส่วนกลางเขียน 24 แถว computed + แถวปิด + override (เหตุผล host อ่านคนเดียว)
--   * resync_month_part: host · ส่วนที่ปิดแล้ว (MC010) · เขียนทับ computed + audit ค่าเก่า/ใหม่ · คง confirmed_at
--   * set_month_closer: host · ผู้ปิดตามสิทธิ์ส่วน (MC011) · เวลา (MC012) · audit
--   * get_sync_status / list_month_closures: host/admin/recorder · ไม่มีรายละเอียด error / ผู้กด
-- go_live_month seed = 2026-10-01 → เดือนที่ปิดได้ในเทส = 2026-10 (จบแล้วเสมอหลัง พ.ย. 2026)
-- ข้อมูลสมมติทั้งหมด
BEGIN;
SELECT plan(75);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope, position_code) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'host',     'user_b1', 'host',     '{central,province}', 'pm'),
  ('00000000-0000-0000-0000-0000000000b2', 'admin',    'user_b2', 'admin',    '{central}',          'job_admin'),
  ('00000000-0000-0000-0000-0000000000b3', 'recorder', 'user_b3', 'recorder', '{central}',          'supervisor'),
  ('00000000-0000-0000-0000-0000000000b4', 'viewer',   'user_b4', 'viewer',   '{central}',          NULL);

-- แถวส่วนกลางที่ route คำนวณมา (จำลอง) · ค่าเดียวกันทุกสาขา
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
-- resync: สาขาแรก (ตามชื่อ) value 100 → 200
INSERT INTO _j
SELECT 'changed', jsonb_agg(CASE WHEN (e ->> 'branch_id')::uuid = (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1)
                                 THEN e || '{"vS": 200, "value": 200}'::jsonb ELSE e END)
  FROM _j, jsonb_array_elements(v) e WHERE k = 'good';

-- =====================================================================
-- โครงสร้าง / สิทธิ์
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
SELECT ok(NOT has_function_privilege('anon', 'public.close_month_part(text, public.closure_scope, jsonb, text, boolean)', 'EXECUTE'),
  'anon cannot execute close_month_part');
SELECT ok(NOT has_function_privilege('authenticated', 'public.month_close_write_central_rows(text, jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.central_unconfirmed_branches(text)', 'EXECUTE'),
  'internal helpers are not callable by authenticated');
SELECT ok(NOT has_function_privilege('anon', 'public.get_sync_status()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.list_month_closures(text, text)', 'EXECUTE'),
  'anon cannot execute status RPCs');

-- =====================================================================
-- close_month_part: สิทธิ์
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'), 'เหตุผลทดสอบ')$$,
  '42501', NULL, 'admin cannot close');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'), 'เหตุผลทดสอบ')$$,
  '42501', NULL, 'recorder cannot close (brief: host only)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b4', true);
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'province', NULL, NULL, true)$$,
  '42501', NULL, 'viewer cannot close');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'province', NULL, NULL, true)$$,
  '42501', NULL, 'service_role (no user) cannot close');
RESET ROLE;

-- =====================================================================
-- close_month_part: ด่านของ host
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT throws_ok($$SELECT public.close_month_part('2026-13', 'central', (SELECT v FROM _j WHERE k = 'good'), 'เหตุผลทดสอบ')$$,
  'MC001', NULL, 'bad month → MC001');
SELECT throws_ok(format('SELECT public.close_month_part(%L, %L, NULL, NULL, true)',
                        to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM'), 'province'),
  'MC002', NULL, 'current month (Bangkok) → MC002');
SELECT throws_ok($$SELECT public.close_month_part('2026-09', 'province', NULL, NULL, true)$$,
  'MC003', NULL, 'month before go-live → MC003');
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'short'), 'เหตุผลทดสอบ')$$,
  'MC005', NULL, '23 central rows → MC005');
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'negative'), 'เหตุผลทดสอบ')$$,
  'MC005', NULL, 'negative count → MC005');
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'province_row'), 'เหตุผลทดสอบ')$$,
  'MC005', NULL, 'a province branch in central rows → MC005');
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', '{"x":1}'::jsonb, 'เหตุผลทดสอบ')$$,
  'MC005', NULL, 'rows not an array → MC005');
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'))$$,
  'MC006', NULL, 'unconfirmed branches without a reason → MC006');
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'), '  ab  ')$$,
  'MC007', NULL, 'reason shorter than 5 chars → MC007');
RESET ROLE;

-- แถว legacy ของสาขาส่วนกลางในเดือนนั้น → ไม่เขียนทับ (MC008)
INSERT INTO monthly_branch_snapshots (month_key, branch_id, source)
SELECT '2026-10', id, 'legacy' FROM branches WHERE division = 'central' ORDER BY name LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'), 'เหตุผลทดสอบ')$$,
  'MC008', NULL, 'existing legacy row for a central branch → MC008');
RESET ROLE;
DELETE FROM monthly_branch_snapshots WHERE month_key = '2026-10';
SELECT is((SELECT count(*)::int FROM month_closures), 0, 'failed closes leave no closure row');

-- =====================================================================
-- close_month_part: ส่วนกลางสำเร็จ (ข้ามด้วยเหตุผล)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT is((public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'), '  ยังไม่มีหน้ายืนยันสาขา  ')
           ->> 'overridden')::boolean, true, 'host closes central with an override reason');
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'good'), 'เหตุผลทดสอบ')$$,
  'MC004', NULL, 'closing the same part again → MC004');
SELECT is((SELECT count(*)::int FROM month_closure_overrides), 1, 'host reads the override');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
SELECT is((SELECT count(*)::int FROM month_closure_overrides), 0, 'admin reads 0 overrides');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT is((SELECT count(*)::int FROM month_closure_overrides), 0, 'recorder reads 0 overrides');
SELECT throws_ok($$INSERT INTO month_closure_overrides (month_key, scope, reason) VALUES ('2026-10', 'province', 'เหตุผลทดสอบ')$$,
  '42501', NULL, 'direct insert into overrides is denied');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots s JOIN branches b ON b.id = s.branch_id
            WHERE s.month_key = '2026-10' AND s.source = 'computed' AND b.division = 'central' AND s.value = 100),
  24, '24 computed central rows stored');
SELECT is((SELECT closed_by FROM month_closures WHERE month_key = '2026-10' AND scope = 'central'),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'closed_by = host');
SELECT is((SELECT row(reason, cardinality(unconfirmed_branch_ids), overridden_by)::text FROM month_closure_overrides),
  row('ยังไม่มีหน้ายืนยันสาขา', 24, '00000000-0000-0000-0000-0000000000b1'::uuid)::text,
  'override stores trimmed reason, 24 unconfirmed branches, who');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'month_closures' AND action = 'insert'
            AND changed_by = '00000000-0000-0000-0000-0000000000b1' AND month_key = '2026-10'),
  1, 'closure insert audited with the host as author');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'month_closure_overrides' AND action = 'insert'
            AND new_data ->> 'reason' = 'ยังไม่มีหน้ายืนยันสาขา'),
  1, 'override audited (reason in new_data)');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'monthly_branch_snapshots'),
  0, 'computed snapshot inserts on close are not audited');

-- ยืนยันครบแล้ว → helper คืนว่าง (ใช้ตรวจนิยาม "ยืนยัน")
UPDATE monthly_branch_snapshots SET confirmed_at = now(), confirmed_by = '00000000-0000-0000-0000-0000000000b3'
 WHERE month_key = '2026-10';
SELECT is(public.central_unconfirmed_branches('2026-10'), '{}'::uuid[], 'all central rows confirmed → none unconfirmed');
SELECT is(cardinality(public.central_unconfirmed_branches('2026-11')), 24, 'month without rows → 24 unconfirmed');

-- =====================================================================
-- close_month_part: ต่างจังหวัด
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'province', (SELECT v FROM _j WHERE k = 'good'), NULL, true)$$,
  'MC005', NULL, 'province close does not accept rows → MC005');
SELECT throws_ok($$SELECT public.close_month_part('2026-10', 'province')$$,
  'MC009', NULL, 'carried branches not acknowledged → MC009');
SELECT is((public.close_month_part('2026-10', 'province', NULL, NULL, true) ->> 'carried_count')::int,
  19, 'province closes after acknowledging 19 carried branches');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM month_closures WHERE month_key = '2026-10'), 2, 'both parts of 2026-10 closed');
SELECT is((SELECT count(*)::int FROM month_closure_overrides WHERE scope = 'province'), 0, 'province close stores no override');

-- =====================================================================
-- resync_month_part
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT throws_ok($$SELECT public.resync_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'changed'))$$,
  '42501', NULL, 'recorder cannot resync (brief: host only)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT throws_ok($$SELECT public.resync_month_part('2026-09', 'central', (SELECT v FROM _j WHERE k = 'changed'))$$,
  'MC010', NULL, 'resync of a part that is not closed → MC010');
SELECT throws_ok($$SELECT public.resync_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'short'))$$,
  'MC005', NULL, 'resync with bad rows → MC005');
SELECT is((public.resync_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'changed')) ->> 'changed_branches')::int,
  1, 'resync rewrites only the changed branch');
SELECT is((public.resync_month_part('2026-10', 'central', (SELECT v FROM _j WHERE k = 'changed')) ->> 'changed_branches')::int,
  0, 'resync with identical numbers changes nothing');
SELECT throws_ok($$SELECT public.resync_month_part('2026-10', 'province', (SELECT v FROM _j WHERE k = 'good'))$$,
  'MC005', NULL, 'province resync does not accept rows → MC005');
SELECT is((public.resync_month_part('2026-10', 'province') ->> 'changed_branches')::int, 0, 'province resync = re-send only');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'monthly_branch_snapshots' AND action = 'update'
            AND changed_by = '00000000-0000-0000-0000-0000000000b1'
            AND (old_data ->> 'value')::numeric = 100 AND (new_data ->> 'value')::numeric = 200),
  1, 'resync audit row has old/new value and the host as author');
SELECT is((SELECT count(*)::int FROM monthly_branch_snapshots WHERE month_key = '2026-10' AND confirmed_at IS NULL),
  0, 'resync keeps confirmed_at');
SELECT is((SELECT count(*)::int FROM month_closures WHERE month_key = '2026-10'
            AND last_resync_by = '00000000-0000-0000-0000-0000000000b1' AND last_resync_at IS NOT NULL),
  2, 'last_resync_at / by set on both parts');

-- =====================================================================
-- set_month_closer (DECISIONS 5.8)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'central', '00000000-0000-0000-0000-0000000000b3', '2026-11-02 09:00+07')$$,
  '42501', NULL, 'recorder cannot edit the closer');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT throws_ok($$SELECT public.set_month_closer('2026-09', 'central', '00000000-0000-0000-0000-0000000000b3', '2026-11-02 09:00+07')$$,
  'MC010', NULL, 'closer of a part that is not closed → MC010');
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'central', '00000000-0000-0000-0000-0000000000b4', '2026-11-02 09:00+07')$$,
  'MC011', NULL, 'viewer as closer → MC011');
SELECT throws_ok($$SELECT public.set_month_closer('2026-10', 'province', '00000000-0000-0000-0000-0000000000b3', '2026-11-02 09:00+07')$$,
  'MC011', NULL, 'recorder as province closer → MC011');
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
-- start_sync_log / finish_sync_log: close / resync
-- =====================================================================
CREATE TEMP TABLE _ids (k text PRIMARY KEY, id bigint);
GRANT ALL ON _ids TO PUBLIC;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
SELECT throws_ok($$SELECT public.start_sync_log('close')$$, '42501', NULL, 'recorder cannot start a close run');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SELECT throws_ok($$SELECT public.start_sync_log('export')$$, 'SY002', NULL, 'export still unsupported → SY002');
INSERT INTO _ids VALUES ('c1', public.start_sync_log('close'));
SELECT ok((SELECT id FROM _ids WHERE k = 'c1') IS NOT NULL, 'host starts a close run');
SELECT lives_ok(format('SELECT public.finish_sync_log(%s, %L, %L)', (SELECT id FROM _ids WHERE k = 'c1'), 'failed', 'github_502'),
  'host finishes own close run');
INSERT INTO _ids VALUES ('r1', public.start_sync_log('resync'));
SELECT lives_ok(format('SELECT public.finish_sync_log(%s, %L)', (SELECT id FROM _ids WHERE k = 'r1'), 'skipped'),
  'host finishes own resync run');
RESET ROLE;

-- =====================================================================
-- get_sync_status / list_month_closures
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
SELECT is((SELECT count(*)::int FROM public.list_month_closures()), 2, 'admin lists closures');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b4', true);
SELECT throws_ok($$SELECT * FROM public.get_sync_status()$$, '42501', NULL, 'viewer cannot read sync status');
SELECT throws_ok($$SELECT * FROM public.list_month_closures()$$, '42501', NULL, 'viewer cannot list closures');
RESET ROLE;

SELECT ok(pg_get_function_result('public.get_sync_status()'::regprocedure) !~ '(error_message|triggered_by)',
  'get_sync_status exposes no error_message / triggered_by');

SELECT * FROM finish();
ROLLBACK;
