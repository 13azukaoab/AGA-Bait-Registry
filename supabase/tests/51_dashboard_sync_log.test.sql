-- M27 (20261115250000): sync_logs + start_sync_log / finish_sync_log
--   * โครงสร้าง + สิทธิ์: RLS เปิด · anon ไม่มีสิทธิ์ · authenticated/service_role อ่านอย่างเดียว ไม่มีสิทธิ์เขียนตรง
--   * อ่าน: host เห็น · admin / recorder / viewer เห็น 0 แถว
--   * start: auto = service_role เท่านั้น · manual = host เท่านั้น (triggered_by = auth.uid()) · ช่องทางอื่น SY002
--   * กันส่งซ้อน: manual ชน → SY001 · auto ชน → แถว skipped/busy + คืน NULL · ค้าง > 10 นาที → failed/timeout
--   * finish: ครั้งเดียว (SY003) · service_role ปิดได้แค่ auto · host ปิดได้แค่ manual ของตัวเอง · ผลผิด SY002
-- ข้อมูลสมมติทั้งหมด
BEGIN;
SELECT plan(44);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host2@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope, position_code) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}', 'pm'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}',          'job_admin'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}',          'supervisor'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer',   'user_a4', 'viewer',   '{central}',          NULL),
  ('00000000-0000-0000-0000-0000000000a6', 'host2',    'user_a6', 'host',     '{central,province}', 'om');

-- เก็บ id ระหว่างเปลี่ยน role
CREATE TEMP TABLE _ids (k text PRIMARY KEY, id bigint);
GRANT ALL ON _ids TO PUBLIC;

-- =====================================================================
-- โครงสร้าง / สิทธิ์
-- =====================================================================
SELECT has_table('public', 'sync_logs', 'sync_logs exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_logs'::regclass), 'RLS is enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.sync_logs', 'SELECT'), 'anon cannot read');
SELECT ok(has_table_privilege('authenticated', 'public.sync_logs', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.sync_logs', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.sync_logs', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.sync_logs', 'DELETE'),
  'authenticated: SELECT only');
SELECT ok(NOT has_table_privilege('service_role', 'public.sync_logs', 'INSERT')
          AND NOT has_table_privilege('service_role', 'public.sync_logs', 'UPDATE')
          AND NOT has_table_privilege('service_role', 'public.sync_logs', 'DELETE'),
  'service_role: no direct writes (RPC only)');
SELECT ok(has_function_privilege('authenticated', 'public.start_sync_log(text)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.start_sync_log(text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.start_sync_log(text)', 'EXECUTE'),
  'start_sync_log: authenticated/service_role yes · anon no');
SELECT ok(NOT has_function_privilege('anon', 'public.finish_sync_log(bigint, text, text, text, text[], int, text)', 'EXECUTE'),
  'finish_sync_log: anon no');
SELECT ok((SELECT bool_and(prosecdef AND proconfig::text LIKE '%search_path%') FROM pg_proc
           WHERE oid IN ('public.start_sync_log(text)'::regprocedure,
                         'public.finish_sync_log(bigint, text, text, text, text[], int, text)'::regprocedure)),
  'both RPCs are SECURITY DEFINER with a pinned search_path');
SELECT throws_ok($$INSERT INTO sync_logs (source, finished_at) VALUES ('auto', now())$$,
  '23514', NULL, 'CHECK: finished row must have a result');
SELECT throws_ok($$INSERT INTO sync_logs (source, finished_at, result, commit_sha) VALUES ('auto', now(), 'skipped', repeat('a', 40))$$,
  '23514', NULL, 'CHECK: commit sha only on success');
SELECT throws_ok($$INSERT INTO sync_logs (source) VALUES ('other')$$,
  '23514', NULL, 'CHECK: unknown source rejected');

-- =====================================================================
-- start: สิทธิ์ตามช่องทาง
-- =====================================================================
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.start_sync_log('auto')$$, '42501', NULL, 'anon cannot start');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok($$SELECT public.start_sync_log('auto')$$, '42501', NULL, 'host cannot start an auto run');
SELECT throws_ok($$SELECT public.start_sync_log('close')$$, 'SY002', NULL, 'unsupported source → SY002');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok($$SELECT public.start_sync_log('manual')$$, '42501', NULL, 'admin cannot start manual');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$SELECT public.start_sync_log('manual')$$, '42501', NULL, 'recorder cannot start manual');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok($$SELECT public.start_sync_log('manual')$$, '42501', NULL, 'viewer cannot start manual');
SELECT throws_ok($$INSERT INTO sync_logs (source) VALUES ('manual')$$, '42501', NULL, 'REST insert denied');

-- host เริ่มรอบ manual
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
INSERT INTO _ids VALUES ('m1', public.start_sync_log('manual'));
SELECT ok((SELECT id FROM _ids WHERE k = 'm1') IS NOT NULL, 'host starts a manual run');
SELECT is((SELECT triggered_by FROM sync_logs WHERE id = (SELECT id FROM _ids WHERE k = 'm1')),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'triggered_by = auth.uid()');
SELECT throws_ok($$SELECT public.start_sync_log('manual')$$, 'SY001', NULL, 'second manual run while one is running → SY001');
SELECT throws_ok($$UPDATE sync_logs SET result = 'success'$$, '42501', NULL, 'REST update denied');
RESET ROLE;

-- cron ชนรอบที่กำลังส่ง → แถว skipped/busy + NULL
SET LOCAL ROLE service_role;
SELECT is(public.start_sync_log('auto'), NULL::bigint, 'auto run while busy returns NULL');
SELECT is((SELECT count(*)::int FROM sync_logs WHERE source = 'auto' AND result = 'skipped' AND error_code = 'busy'),
  1, 'auto busy run is logged as skipped/busy');
SELECT throws_ok($$SELECT public.start_sync_log('manual')$$, '42501', NULL, 'service_role cannot start a manual run');
SELECT throws_ok(format('SELECT public.finish_sync_log(%s, %L)', (SELECT id FROM _ids WHERE k = 'm1'), 'success'),
  '42501', NULL, 'service_role cannot finish a manual run');
RESET ROLE;

-- =====================================================================
-- finish (manual)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a6', true);
SELECT throws_ok(format('SELECT public.finish_sync_log(%s, %L)', (SELECT id FROM _ids WHERE k = 'm1'), 'success'),
  '42501', NULL, 'another host cannot finish someone else''s run');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(format('SELECT public.finish_sync_log(%s, %L)', (SELECT id FROM _ids WHERE k = 'm1'), 'ok'),
  'SY002', NULL, 'invalid result → SY002');
SELECT lives_ok(format(
  'SELECT public.finish_sync_log(%s, %L, NULL, NULL, ARRAY[%L, %L], 22, %L)',
  (SELECT id FROM _ids WHERE k = 'm1'), 'success', 'SEP.26', 'OCT.26', repeat('ab', 20)),
  'host finishes own manual run');
SELECT is((SELECT row(result, months_sent, month_count, commit_sha)::text FROM sync_logs WHERE id = (SELECT id FROM _ids WHERE k = 'm1')),
  row('success', ARRAY['SEP.26', 'OCT.26'], 22, repeat('ab', 20))::text, 'finish stores result / months / count / sha');
SELECT ok((SELECT finished_at IS NOT NULL FROM sync_logs WHERE id = (SELECT id FROM _ids WHERE k = 'm1')), 'finished_at set');
SELECT throws_ok(format('SELECT public.finish_sync_log(%s, %L)', (SELECT id FROM _ids WHERE k = 'm1'), 'failed'),
  'SY003', NULL, 'finishing twice → SY003');
SELECT is((SELECT count(*)::int FROM sync_logs), 2, 'host reads all rows');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT is((SELECT count(*)::int FROM sync_logs), 0, 'admin reads 0 rows');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is((SELECT count(*)::int FROM sync_logs), 0, 'recorder reads 0 rows');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT is((SELECT count(*)::int FROM sync_logs), 0, 'viewer reads 0 rows');
RESET ROLE;

-- =====================================================================
-- auto: เริ่ม/จบ + ข้อความยาวถูกตัด + sha ไม่เก็บเมื่อไม่สำเร็จ
-- =====================================================================
SET LOCAL ROLE service_role;
INSERT INTO _ids VALUES ('a1', public.start_sync_log('auto'));
SELECT ok((SELECT id FROM _ids WHERE k = 'a1') IS NOT NULL, 'service_role starts an auto run');
SELECT is((SELECT triggered_by FROM sync_logs WHERE id = (SELECT id FROM _ids WHERE k = 'a1')), NULL::uuid,
  'auto run has no triggered_by');
SELECT lives_ok(format('SELECT public.finish_sync_log(%s, %L, %L, %L, NULL, 22, %L)',
  (SELECT id FROM _ids WHERE k = 'a1'), 'failed', 'github_401', repeat('x', 900), repeat('c', 40)),
  'service_role finishes an auto run');
SELECT is((SELECT row(result, error_code, char_length(error_message), commit_sha IS NULL, months_sent)::text
           FROM sync_logs WHERE id = (SELECT id FROM _ids WHERE k = 'a1')),
  row('failed', 'github_401', 500, true, '{}'::text[])::text, 'long message trimmed to 500 · no sha on failure · months default {}');
RESET ROLE;

-- =====================================================================
-- รอบค้าง > 10 นาที ถูกปิดเป็น timeout แล้วเริ่มรอบใหม่ได้
-- =====================================================================
INSERT INTO sync_logs (source, triggered_by, started_at)
VALUES ('manual', '00000000-0000-0000-0000-0000000000a1', now() - interval '11 minutes');
SET LOCAL ROLE service_role;
INSERT INTO _ids VALUES ('a2', public.start_sync_log('auto'));
SELECT ok((SELECT id FROM _ids WHERE k = 'a2') IS NOT NULL, 'stale run does not block a new run');
SELECT is((SELECT count(*)::int FROM sync_logs WHERE result = 'failed' AND error_code = 'timeout'), 1,
  'stale run closed as failed/timeout');
SELECT lives_ok(format('SELECT public.finish_sync_log(%s, %L)', (SELECT id FROM _ids WHERE k = 'a2'), 'skipped'),
  'auto run finished as skipped');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
