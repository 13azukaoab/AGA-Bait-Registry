-- M18 (20261114200000): ตกบริการ ชดเชย / ไม่ชดเชย (DECISIONS 2.41 + 2.45 — ไม่เลือกเดือนชดเชยล่วงหน้า)
--   ตาราง missed_service_resolutions (waived ผ่าน resolve_missed_service · makeup ระบบสร้างจากการเข้าที่ผูก)
--   · visits.makeup_for_month · save_makeup_service_visit · list_pending_missed_services · bucket หลักฐาน · audit
-- วันที่ทั้งหมดอ้างจาก "เดือนปัจจุบัน" (Asia/Bangkok) ผ่าน pg_temp.m(n) = เดือนปัจจุบัน + n เดือน → เทสไม่พังเมื่อเวลาผ่านไป
--   d1 จบแล้ว (เริ่ม m(-18) · เดือนสุดท้าย m(-7) · เพดาน m(5)) · d2 ต่างจังหวัด · d3 ยังไม่จบ (เริ่ม m(-6))
--   d4 ยกเลิก · d5 ยังไม่ตั้งสถานี · d6 ปิดแล้ว · d7 เลยเพดาน (เดือนสุดท้าย m(-19) · เพดาน m(-7))
--   d8 ตั้งสถานีช้า (m(-10)) — สัญญาเก่าที่นำเข้า
--   dr = สัญญาที่ลูกค้าต่อแล้ว (สัญญาใหม่ dn ใส่ระหว่างเทส — 2.47)
--   da / db / dc = ชุดตาราง host×recorder × ภายใน/เลยเพดาน × waived/makeup × ปิด/ยกเลิก (da ภายใน · db เลย · dc ปิด)
BEGIN;
SELECT plan(148);

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
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Central'),
  ('00000000-0000-0000-0000-0000000000c2', (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1), 'Province');

CREATE FUNCTION pg_temp.m(n int) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')) + make_interval(months => n))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.m(int) TO PUBLIC;
CREATE FUNCTION pg_temp.td() RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.td() TO PUBLIC;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-0000000000' || p)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;

INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at,
                       status, cancelled_at) VALUES
  (pg_temp.id('d1'), pg_temp.id('c1'), 'M-1', pg_temp.m(-18), 1, 150000, pg_temp.m(-18), 'active', NULL),
  (pg_temp.id('d2'), pg_temp.id('c2'), 'M-2', pg_temp.m(-18), 1, 50000,  pg_temp.m(-18), 'active', NULL),
  (pg_temp.id('d3'), pg_temp.id('c1'), 'M-3', pg_temp.m(-6),  1, 24000,  pg_temp.m(-6),  'active', NULL),
  (pg_temp.id('d4'), pg_temp.id('c1'), 'M-4', pg_temp.m(-18), 1, 24000,  pg_temp.m(-18), 'cancelled', pg_temp.m(-10)),
  (pg_temp.id('d5'), pg_temp.id('c1'), 'M-5', pg_temp.m(-18), 1, 24000,  NULL,           'active', NULL),
  (pg_temp.id('d6'), pg_temp.id('c1'), 'M-6', pg_temp.m(-18), 1, 24000,  pg_temp.m(-18), 'closed', NULL),
  (pg_temp.id('d7'), pg_temp.id('c1'), 'M-7', pg_temp.m(-30), 1, 24000,  pg_temp.m(-30), 'active', NULL),
  (pg_temp.id('d8'), pg_temp.id('c1'), 'M-8', pg_temp.m(-18), 1, 24000,  pg_temp.m(-10), 'active', NULL),
  (pg_temp.id('da'), pg_temp.id('c1'), 'M-A', pg_temp.m(-18), 1, 24000,  pg_temp.m(-18), 'active', NULL),
  (pg_temp.id('db'), pg_temp.id('c1'), 'M-B', pg_temp.m(-30), 1, 24000,  pg_temp.m(-30), 'active', NULL),
  (pg_temp.id('dc'), pg_temp.id('c1'), 'M-C', pg_temp.m(-18), 1, 24000,  pg_temp.m(-18), 'closed', NULL),
  (pg_temp.id('dd'), pg_temp.id('c1'), 'M-R', pg_temp.m(-18), 1, 24000,  pg_temp.m(-18), 'active', NULL);
-- d1: m(-15) มี routine (ไม่ตก) · เดือนอื่นตก
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  (pg_temp.id('e1'), pg_temp.id('d1'), pg_temp.m(-15) + 9, 'routine', '09:00', '10:00');
-- ไฟล์หลักฐานที่อัปโหลดแล้ว (ข้อมูลตั้งต้น)
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d1/consent.pdf'),
  ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d2/consent.pdf');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a;
GRANT SELECT ON _t TO PUBLIC;
-- payload ของ resolve_missed_service (ไม่ชดเชย)
CREATE FUNCTION pg_temp.rs(p_contract text, p_missed date, p_reason text DEFAULT NULL, p_evidence text DEFAULT NULL,
                           p_kind text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.resolve_missed_service(%L::jsonb)',
    jsonb_strip_nulls(jsonb_build_object(
      'contract_id', pg_temp.id(p_contract), 'missed_month', p_missed,
      'reason', p_reason, 'evidence_path', p_evidence, 'kind', p_kind)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.rs(text, date, text, text, text) TO PUBLIC;
-- payload ของ save_service_visit
CREATE FUNCTION pg_temp.sv(p_visit text, p_contract text, p_date date, p_type text DEFAULT 'routine')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', pg_temp.id(p_visit), 'contract_id', pg_temp.id(p_contract),
                            'visit_date', p_date, 'visit_type', p_type, 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sv(text, text, date, text) TO PUBLIC;
-- บันทึกการเข้าชดเชย (p_month = เดือนที่ตกที่ชดเชย · NULL = เลิกผูก)
CREATE FUNCTION pg_temp.mk(p_visit text, p_contract text, p_date date, p_month date, p_type text DEFAULT 'routine')
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.save_makeup_service_visit(%L::jsonb)',
                pg_temp.sv(p_visit, p_contract, p_date, p_type) || jsonb_build_object('makeup_for_month', p_month))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.mk(text, text, date, date, text) TO PUBLIC;
CREATE FUNCTION pg_temp.old(p_visit text, p_contract text, p_date date) RETURNS text LANGUAGE sql AS
  $$ SELECT format('SELECT public.save_service_visit(%L::jsonb)', pg_temp.sv(p_visit, p_contract, p_date)) $$;
GRANT EXECUTE ON FUNCTION pg_temp.old(text, text, date) TO PUBLIC;
CREATE FUNCTION pg_temp.link(p_visit text) RETURNS date LANGUAGE sql AS
  $$ SELECT makeup_for_month FROM visits WHERE id = pg_temp.id(p_visit) $$;
GRANT EXECUTE ON FUNCTION pg_temp.link(text) TO PUBLIC;
-- แถวผลของเดือนที่ตก: 'kind|makeup_month' หรือ NULL (ไม่มีแถว = รอตัดสิน)
CREATE FUNCTION pg_temp.res(p_contract text, p_missed date) RETURNS text LANGUAGE sql AS
  $$ SELECT kind::text || '|' || coalesce(makeup_month::text, '-') FROM missed_service_resolutions
      WHERE contract_id = pg_temp.id(p_contract) AND missed_month = p_missed $$;
GRANT EXECUTE ON FUNCTION pg_temp.res(text, date) TO PUBLIC;
-- เดือนที่รอตัดสินของสัญญา (ตามสิทธิ์ผู้เรียก)
CREATE FUNCTION pg_temp.pending(p_contract text, p_month date DEFAULT NULL) RETURNS date[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg(missed_month ORDER BY missed_month), '{}')
       FROM public.list_pending_missed_services(NULL, p_month) WHERE contract_id = pg_temp.id(p_contract) $$;
GRANT EXECUTE ON FUNCTION pg_temp.pending(text, date) TO PUBLIC;

-- =====================================================================
-- โครงสร้าง + สิทธิ์ (PDPA)
-- =====================================================================
SELECT has_table('public', 'missed_service_resolutions', 'table missed_service_resolutions exists');
SELECT hasnt_column('public', 'missed_service_resolutions', 'makeup_date', 'no advance make-up date (2.45)');
SELECT has_column('public', 'visits', 'makeup_for_month', 'visits.makeup_for_month exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.missed_service_resolutions'::regclass),
  'RLS is enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.missed_service_resolutions', 'SELECT'), 'anon cannot read resolutions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.missed_service_resolutions', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.missed_service_resolutions', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.missed_service_resolutions', 'DELETE'),
  'authenticated has no direct write privilege (RPC / trigger only)');
SELECT ok(NOT has_function_privilege('anon', 'public.resolve_missed_service(jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.save_makeup_service_visit(jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.list_pending_missed_services(uuid, date)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.reopen_missed_service(jsonb)', 'EXECUTE'),
  'anon cannot execute the M18 RPCs');
SELECT ok(NOT has_function_privilege('authenticated', 'public.visits_makeup_link_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.visits_makeup_unlink_cleanup()', 'EXECUTE'),
  'trigger functions are not callable by users');
SELECT is((SELECT public FROM storage.buckets WHERE id = 'missed-service-evidence'), false, 'evidence bucket is private');
SELECT is(public.missed_makeup_deadline_months(), 12, 'make-up deadline (owner-confirmed 2.45) is defined in one place = 12 months');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.missed_service_resolutions$$, '42501', NULL, 'anon select is refused');
SELECT throws_ok($$SELECT * FROM public.list_pending_missed_services()$$, '42501', NULL, 'anon cannot list pending months');
RESET ROLE;

-- =====================================================================
-- ไม่ชดเชย (recorder): ด่านเดือนที่ตก / เหตุผล / สัญญา
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-14) + 5, 'x'), 'MS001', NULL, 'missed_month must be the 1st day');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-19), 'x'), 'MS001', NULL, 'month before the contract start is refused');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-6), 'x'), 'MS001', NULL, 'month after the service months is refused (rule 5)');
SELECT throws_ok(pg_temp.rs('d3', pg_temp.m(0), 'x'), 'MS001', NULL, 'the current month is not missed yet');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-15), 'x'), 'MS002', NULL, 'a month with a routine visit is not missed');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-14)), 'MS004', NULL, 'waived needs a reason');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-14), '   '), 'MS004', NULL, 'a blank reason is not a reason');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-14), 'x', NULL, 'makeup'), '22023', NULL,
  'a make-up month cannot be chosen in advance (2.45)');
SELECT throws_ok($$SELECT public.resolve_missed_service('{"contract_id": "00000000-0000-0000-0000-0000000000d1"}')$$,
  '22004', NULL, 'missing keys are refused');
SELECT throws_ok(pg_temp.rs('d2', pg_temp.m(-14), 'x'), '42501', NULL, 'recorder cannot resolve outside their scope');
SELECT throws_ok(pg_temp.rs('d9', pg_temp.m(-14), 'x'), 'AG004', NULL, 'unknown contract');
SELECT throws_ok(pg_temp.rs('d4', pg_temp.m(-14), 'x'), 'MS009', NULL, 'a cancelled contract cannot be resolved');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-14), 'x', '00000000-0000-0000-0000-0000000000d2/consent.pdf'),
  'MS007', NULL, 'evidence of another contract is refused');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-14), 'x', '00000000-0000-0000-0000-0000000000d1/nope.pdf'),
  'MS007', NULL, 'evidence that was not uploaded is refused');
SELECT lives_ok(pg_temp.rs('d6', pg_temp.m(-14), 'ลูกค้ายินยอม'), 'a closed contract can still be waived');
SELECT lives_ok(pg_temp.rs('d1', pg_temp.m(-14), 'ลูกค้ายินยอม', '00000000-0000-0000-0000-0000000000d1/consent.pdf', 'waived'),
  'recorder waives with a reason and evidence');
SELECT lives_ok(pg_temp.rs('d1', pg_temp.m(-14), 'ลูกค้ายินยอม (แก้)', '00000000-0000-0000-0000-0000000000d1/consent.pdf'),
  'deciding again updates the same row');
RESET ROLE;
SELECT is((SELECT kind::text || '|' || reason || '|' || decided_by::text FROM missed_service_resolutions
            WHERE contract_id = pg_temp.id('d1') AND missed_month = pg_temp.m(-14)),
  'waived|ลูกค้ายินยอม (แก้)|00000000-0000-0000-0000-0000000000a3', 'row stores kind, reason and who decided');
SELECT is((SELECT count(*)::int FROM missed_service_resolutions WHERE contract_id = pg_temp.id('d1')), 1, 'no duplicate row');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'missed_service_resolutions'
            AND contract_id = pg_temp.id('d1') AND month_key = to_char(pg_temp.m(-14), 'YYYY-MM')
            AND changed_by = '00000000-0000-0000-0000-0000000000a3'), 2,
  'insert and update are audited with contract, missed month and user');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok($$INSERT INTO missed_service_resolutions (contract_id, missed_month, kind, reason)
                   VALUES (pg_temp.id('d1'), pg_temp.m(-13), 'waived', 'x')$$,
  '42501', NULL, 'recorder cannot insert directly');
SELECT throws_ok($$UPDATE missed_service_resolutions SET reason = 'hack'$$, '42501', NULL, 'recorder cannot update directly');
SELECT throws_ok($$DELETE FROM missed_service_resolutions$$, '42501', NULL, 'recorder cannot delete directly');
-- ไฟล์หลักฐาน: อัปโหลดได้ในสัญญาที่อยู่ในขอบเขต (owner_id = ผู้อัปโหลด — Storage API ตั้งให้เอง · ในเทสใส่เอง)
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name, owner_id)
                  VALUES ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d1/r.pdf', '00000000-0000-0000-0000-0000000000a3')$$,
  'recorder uploads evidence for a contract in scope');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d2/r.pdf')$$,
  '42501', NULL, 'recorder cannot upload evidence for a contract out of scope');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('missed-service-evidence', 'loose.pdf')$$,
  '42501', NULL, 'evidence must sit in a contract folder');

-- =====================================================================
-- บันทึกบริการชดเชย (recorder) — สร้างแถว makeup ให้เอง · makeup_month = เดือนของการเข้า
-- =====================================================================
SELECT lives_ok(pg_temp.mk('f1', 'd1', pg_temp.td(), pg_temp.m(-13)),
  'recorder records a make-up visit this month for a month missed before the contract ended');
SELECT is(pg_temp.link('f1'), pg_temp.m(-13), 'visit is linked to the missed month');
RESET ROLE;
SELECT is(pg_temp.res('d1', pg_temp.m(-13)), 'makeup|' || pg_temp.m(0)::text, 'a makeup row is created with the visit month');
SELECT is((SELECT decided_by FROM missed_service_resolutions WHERE contract_id = pg_temp.id('d1') AND missed_month = pg_temp.m(-13)),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'the recorder is stored as decided_by');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'missed_service_resolutions' AND action = 'insert'
            AND contract_id = pg_temp.id('d1') AND month_key = to_char(pg_temp.m(-13), 'YYYY-MM')), 1,
  'the automatic makeup row is audited');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
-- ด่านของการผูก
SELECT throws_ok(pg_temp.mk('f2', 'd1', pg_temp.td(), pg_temp.m(-12), 'problem'),
  'MS006', NULL, 'a make-up visit must be routine');
SELECT throws_ok(pg_temp.mk('f2', 'd3', pg_temp.m(-3) + 3, pg_temp.m(-3)),
  'MS006', NULL, 'a make-up visit must be after the missed month');
SELECT throws_ok(pg_temp.mk('f2', 'd3', pg_temp.td(), pg_temp.m(0)),
  'MS001', NULL, 'the current month cannot be made up yet');
SELECT throws_ok(pg_temp.mk('f2', 'd1', pg_temp.td(), pg_temp.m(-6)),
  'MS001', NULL, 'a month outside the service months cannot be made up (rule 5)');
SELECT throws_ok(pg_temp.mk('f2', 'd1', pg_temp.td(), pg_temp.m(-15)),
  'MS002', NULL, 'a month with a routine visit cannot be made up');
SELECT throws_ok(pg_temp.mk('f2', 'd1', pg_temp.td(), pg_temp.m(-14)),
  'MS010', NULL, 'a waived month cannot be made up (host must cancel the waiver first)');
SELECT throws_ok(pg_temp.mk('f2', 'd4', pg_temp.td(), pg_temp.m(-14)),
  'MS009', NULL, 'a cancelled contract cannot be made up');
SELECT throws_ok(pg_temp.mk('f2', 'd7', pg_temp.td(), pg_temp.m(-25)),
  'MS008', NULL, 'recorder cannot make up after the deadline');
SELECT throws_ok(pg_temp.mk('f2', 'd1', pg_temp.td(), pg_temp.m(-13)),
  '23505', NULL, 'one missed month links to one visit only');
SELECT ok(NOT EXISTS (SELECT 1 FROM visits WHERE id = pg_temp.id('f2')),
  'refused make-up saves leave no visit behind (one transaction)');
SELECT lives_ok(pg_temp.mk('f2', 'd6', pg_temp.td(), pg_temp.m(-12)), 'a closed contract can still be made up');
-- ผลตรวจ security รอบ 2: ทางเลี่ยง RPC · เกณฑ์เริ่มนับ · ลงวันที่ล่วงหน้า/ย้อนหลังเลี่ยงเพดาน
SELECT throws_ok($$INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time, makeup_for_month)
                   VALUES (pg_temp.id('01'), pg_temp.id('d1'), pg_temp.td(), 'routine', '09:00', '10:00', pg_temp.m(-12))$$,
  '42501', NULL, 'direct REST insert of a make-up visit is refused (RPC only)');
SELECT throws_ok($$UPDATE visits SET contract_id = pg_temp.id('d1') WHERE id = pg_temp.id('f2')$$,
  '42501', NULL, 'moving a linked visit to another contract directly is refused');
SELECT throws_ok(pg_temp.mk('02', 'd8', pg_temp.td(), pg_temp.m(-17)),
  'MS001', NULL, 'a month before the stations were set up cannot be made up (legacy import floor)');
SELECT throws_ok(pg_temp.mk('03', 'd1', pg_temp.td() + 40, pg_temp.m(-12)),
  'MS006', NULL, 'a make-up visit cannot be dated in the future');
SELECT throws_ok(pg_temp.mk('04', 'd7', pg_temp.m(-8) + 3, pg_temp.m(-26)),
  'MS008', NULL, 'back-dating the visit does not get around the deadline');
-- ไม่ชดเชยเดือนที่ชดเชยแล้วไม่ได้
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-13), 'x'), 'MS005', NULL, 'a made-up month cannot be waived');

-- ชดเชยในช่วงสัญญา (d3): เดือนนั้นต้องมี 2 ครั้ง (ปกติ + ชดเชย)
SELECT lives_ok(pg_temp.mk('f4', 'd3', pg_temp.m(-1) + 4, pg_temp.m(-3)), 'make-up inside the contract period');
SELECT lives_ok(pg_temp.old('f5', 'd3', pg_temp.m(-1) + 10), 'the normal routine visit of that month uses the old RPC');
SELECT lives_ok(format('SELECT public.save_service_visit(%L::jsonb)', pg_temp.sv('f4', 'd3', pg_temp.m(-1) + 6) || '{"note": "แก้"}'),
  're-saving the make-up visit with the old RPC works');
SELECT is(pg_temp.link('f4'), pg_temp.m(-3), 'and keeps its link');
SELECT lives_ok(pg_temp.old('f4', 'd3', pg_temp.td()), 'moving a linked visit to a later month with the old RPC works');
SELECT is(pg_temp.res('d3', pg_temp.m(-3)), 'makeup|' || pg_temp.m(0)::text, 'the makeup month follows the visit');
-- ทางเลี่ยงผ่าน PATCH ตรง (ด่านเดียวกัน)
SELECT throws_ok($$UPDATE visits SET visit_date = pg_temp.m(-3) + 1 WHERE id = pg_temp.id('f4')$$,
  'MS006', NULL, 'moving a linked visit into (or before) the missed month is refused');
SELECT throws_ok($$UPDATE visits SET visit_type = 'problem' WHERE id = pg_temp.id('f4')$$,
  'MS006', NULL, 'turning a linked visit into a non-routine visit is refused');
SELECT throws_ok($$UPDATE visits SET makeup_for_month = pg_temp.m(-2) WHERE id = pg_temp.id('f5')$$,
  '42501', NULL, 'direct PATCH of makeup_for_month is refused (RPC only)');
-- ย้ายไปชดเชยเดือนอื่น → แถวเดิมหาย (กลับรอตัดสิน) แถวใหม่เกิด
SELECT lives_ok(pg_temp.mk('f4', 'd3', pg_temp.td(), pg_temp.m(-4)), 'relink the make-up visit to another missed month');
SELECT is(pg_temp.res('d3', pg_temp.m(-3)), NULL, 'the old month goes back to pending');
SELECT is(pg_temp.res('d3', pg_temp.m(-4)), 'makeup|' || pg_temp.m(0)::text, 'the new month is made up');
-- เลิกผูก → รอตัดสิน · ไม่ชดเชยได้
SELECT lives_ok(pg_temp.mk('f4', 'd3', pg_temp.td(), NULL), 'unlink through save_makeup_service_visit (null)');
SELECT is(pg_temp.link('f4'), NULL::date, 'visit is no longer linked');
SELECT is(pg_temp.res('d3', pg_temp.m(-4)), NULL, 'unlinking removes the makeup row (pending again)');
SELECT lives_ok(pg_temp.rs('d3', pg_temp.m(-4), 'ยินยอม'), 'after unlinking, the month can be waived');
-- ลบการเข้าชดเชย → รอตัดสิน
SELECT lives_ok($$SELECT public.delete_service_visit(pg_temp.id('f1'))$$, 'a linked make-up visit can be deleted');
SELECT is(pg_temp.res('d1', pg_temp.m(-13)), NULL, 'deleting the make-up visit removes the makeup row (pending again)');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'missed_service_resolutions' AND action = 'delete'
            AND contract_id = pg_temp.id('d1') AND month_key = to_char(pg_temp.m(-13), 'YYYY-MM')), 1,
  'the automatic removal is audited');

-- =====================================================================
-- host: เลยเพดานบันทึกได้ · admin อ่านอย่างเดียว · viewer ไม่เห็น
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(pg_temp.mk('f7', 'd7', pg_temp.td(), pg_temp.m(-25)), 'host may record a make-up after the deadline');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(format('SELECT public.save_service_visit(%L::jsonb)', pg_temp.sv('f7', 'd7', pg_temp.td()) || '{"note": "แก้"}'),
  'recorder can still edit the note of a host-recorded make-up past the deadline');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(pg_temp.mk('f8', 'd4', pg_temp.td(), pg_temp.m(-14)), 'MS009', NULL, 'host cannot make up a cancelled contract either');

-- ตารางกติกาเพดาน (เจ้าของยืนยัน 2.45) — ส่วนที่ยังไม่ได้ทดสอบข้างบน
--   ภายในเพดาน: recorder/host ทำได้ทั้งคู่ · เลยเพดาน: waived ได้ทุกบทบาท, makeup เฉพาะ host
--   · สัญญาปิด: ได้ทั้งคู่ · สัญญายกเลิก: ห้ามทั้งคู่ทุกบทบาท
SELECT lives_ok(pg_temp.rs('da', pg_temp.m(-14), 'ยินยอม'), 'host: waived within the deadline');
SELECT lives_ok(pg_temp.mk('fa', 'da', pg_temp.td(), pg_temp.m(-13)), 'host: make-up within the deadline');
SELECT lives_ok(pg_temp.rs('db', pg_temp.m(-24), 'ยินยอม'), 'host: waived past the deadline');
SELECT lives_ok(pg_temp.rs('dc', pg_temp.m(-14), 'ยินยอม'), 'host: waived on a closed contract');
SELECT lives_ok(pg_temp.mk('fc', 'dc', pg_temp.td(), pg_temp.m(-13)), 'host: make-up on a closed contract');
SELECT throws_ok(pg_temp.rs('d4', pg_temp.m(-14), 'x'), 'MS009', NULL, 'host: waived on a cancelled contract is refused');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(pg_temp.rs('db', pg_temp.m(-25), 'ยินยอม'), 'recorder: waived past the deadline still closes the case');
SELECT throws_ok(pg_temp.mk('fb', 'db', pg_temp.td(), pg_temp.m(-26)), 'MS008', NULL,
  'recorder: make-up past the deadline is refused with MS008');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT ok((SELECT count(*) FROM missed_service_resolutions) > 0, 'admin can read outcomes');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-12), 'x'), '42501', NULL, 'admin cannot waive');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d1/a.pdf')$$,
  '42501', NULL, 'admin cannot upload evidence');
SELECT throws_ok(pg_temp.mk('f9', 'd1', pg_temp.td(), pg_temp.m(-12)), '42501', NULL, 'admin cannot save a make-up visit');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT is((SELECT count(*)::int FROM missed_service_resolutions), 0, 'viewer sees no outcomes (PDPA)');
SELECT throws_ok($$INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time, makeup_for_month)
                   VALUES (pg_temp.id('05'), pg_temp.id('d1'), pg_temp.td(), 'routine', '09:00', '10:00', pg_temp.m(-12))$$,
  '42501', NULL, 'viewer cannot probe contract data through make-up error codes');
SELECT throws_ok($$SELECT * FROM public.list_pending_missed_services()$$, '42501', NULL, 'viewer cannot list pending months');
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-12), 'x'), '42501', NULL, 'viewer cannot waive');

-- =====================================================================
-- รายการรอตัดสิน (แถว "รอชดเชย" ในหน้า /service)
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
-- d1 (จบแล้ว): ตก m(-18)..m(-7) ยกเว้น m(-15) ปกติ · m(-14) ไม่ชดเชย · m(-13) ลบการเข้าชดเชยแล้ว → กลับมารอ
SELECT is(pg_temp.pending('d1'),
  ARRAY[pg_temp.m(-18), pg_temp.m(-17), pg_temp.m(-16), pg_temp.m(-13), pg_temp.m(-12), pg_temp.m(-11),
        pg_temp.m(-10), pg_temp.m(-9), pg_temp.m(-8), pg_temp.m(-7)],
  'ended contract: every missed month without an outcome is listed (routine / waived months are not)');
SELECT is(pg_temp.pending('d6'),
  ARRAY[pg_temp.m(-18), pg_temp.m(-17), pg_temp.m(-16), pg_temp.m(-15), pg_temp.m(-13), pg_temp.m(-11),
        pg_temp.m(-10), pg_temp.m(-9), pg_temp.m(-8), pg_temp.m(-7)],
  'closed contract: waived and made-up months drop out');
-- d3 (ยังไม่จบ): ตก m(-6)..m(-1) · m(-4) ไม่ชดเชย · m(-1) มี routine ปกติ (f5)
SELECT is(pg_temp.pending('d3'), ARRAY[pg_temp.m(-6), pg_temp.m(-5), pg_temp.m(-3), pg_temp.m(-2)],
  'running contract: only past months, the current month is not listed');
SELECT is(pg_temp.pending('d3', pg_temp.m(-3) + 14), ARRAY[pg_temp.m(-6), pg_temp.m(-5)],
  'p_month lists months missed before the page month');
SELECT is(pg_temp.pending('d4'), '{}'::date[], 'cancelled contract is not listed (cannot be closed)');
SELECT is(pg_temp.pending('d5'), '{}'::date[], 'contract without stations set up is not listed');
SELECT is(pg_temp.pending('d8'), ARRAY[pg_temp.m(-10), pg_temp.m(-9), pg_temp.m(-8), pg_temp.m(-7)],
  'months before the stations were set up are not counted (legacy import floor)');
SELECT is(pg_temp.pending('d2'), '{}'::date[], 'recorder does not see contracts outside their scope');
SELECT ok((SELECT bool_and(NOT past_deadline) AND bool_and(makeup_deadline_month = pg_temp.m(5))
             FROM public.list_pending_missed_services() WHERE contract_id = pg_temp.id('d1')),
  'deadline month = last service month + 12 and not passed yet');
SELECT ok((SELECT bool_and(past_deadline) FROM public.list_pending_missed_services() WHERE contract_id = pg_temp.id('d7')),
  'past_deadline is flagged for a contract that ended long ago');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT is(cardinality(pg_temp.pending('d2')), 12, 'admin sees contracts in every branch');
SELECT is((SELECT count(*)::int FROM public.list_pending_missed_services(
             (SELECT branch_id FROM customers WHERE id = pg_temp.id('c2')))), 12, 'p_branch_id filters by branch');
RESET ROLE;

-- =====================================================================
-- L1: ไม่ชดเชยใช้เกณฑ์เริ่มนับเดียวกับรายการ (เดือนก่อนตั้งสถานี = MS001)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(pg_temp.rs('d8', pg_temp.m(-17), 'x'), 'MS001', NULL,
  'waiving a month before the stations were set up is refused (same floor as the list)');

-- =====================================================================
-- 2.47 สัญญาที่ลูกค้าต่อแล้ว (dd → สัญญาใหม่ de)
-- =====================================================================
-- ก่อนต่อสัญญา: ไม่ชดเชย m(-14) · ชดเชย m(-13)
SELECT lives_ok(pg_temp.rs('dd', pg_temp.m(-14), 'ยินยอม'), 'before renewal: waive a month');
SELECT lives_ok(pg_temp.mk('0a', 'dd', pg_temp.td(), pg_temp.m(-13)), 'before renewal: record a make-up');
RESET ROLE;
INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at,
                       renewed_from_contract_id)
VALUES (pg_temp.id('de'), pg_temp.id('c1'), 'M-R2', pg_temp.m(-6), 1, 24000, pg_temp.m(-6), pg_temp.id('dd'));
SELECT ok(public.contract_is_renewed(pg_temp.id('dd')) AND NOT public.contract_is_renewed(pg_temp.id('de')),
  'contract_is_renewed: the old contract is renewed, the new one is not');
SELECT is(pg_temp.res('dd', pg_temp.m(-14)), 'waived|-', 'a waiver made before renewal is kept');
SELECT is(pg_temp.res('dd', pg_temp.m(-13)), 'makeup|' || pg_temp.m(0)::text, 'a make-up made before renewal is kept');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT is(pg_temp.pending('dd'), '{}'::date[], 'open missed months of a renewed contract are void (not listed)');
SELECT throws_ok(pg_temp.mk('0b', 'dd', pg_temp.td(), pg_temp.m(-12)), 'MS011', NULL, 'recorder cannot make up a renewed contract');
SELECT throws_ok(pg_temp.rs('dd', pg_temp.m(-12), 'x'), 'MS011', NULL, 'recorder cannot waive a renewed contract');
SELECT throws_ok($$SELECT public.reopen_missed_service(jsonb_build_object('contract_id', pg_temp.id('dd'), 'missed_month', pg_temp.m(-14)))$$,
  'MS011', NULL, 'recorder cannot reopen on a renewed contract');
SELECT lives_ok(format('SELECT public.save_service_visit(%L::jsonb)', pg_temp.sv('0a', 'dd', pg_temp.td()) || '{"note": "แก้"}'),
  'the kept make-up visit can still be edited (note)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(pg_temp.mk('0c', 'dd', pg_temp.td(), pg_temp.m(-12)), 'MS011', NULL, 'host cannot make up a renewed contract either');
SELECT throws_ok(pg_temp.rs('dd', pg_temp.m(-12), 'x'), 'MS011', NULL, 'host cannot waive a renewed contract either');
SELECT throws_ok($$SELECT public.reopen_missed_service(jsonb_build_object('contract_id', pg_temp.id('dd'), 'missed_month', pg_temp.m(-14)))$$,
  'MS011', NULL, 'host cannot reopen on a renewed contract either');

-- =====================================================================
-- 2.46 เปิดเรื่องกลับ (ยกเลิก "ไม่ชดเชย") — role × สถานะสัญญา
-- =====================================================================
CREATE FUNCTION pg_temp.ro(p_contract text, p_missed date) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.reopen_missed_service(%L::jsonb)',
                jsonb_build_object('contract_id', pg_temp.id(p_contract), 'missed_month', p_missed))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ro(text, date) TO PUBLIC;
-- recorder
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(pg_temp.ro('d6', pg_temp.m(-14)), 'recorder reopens a waiver on a closed contract');
SELECT lives_ok(pg_temp.ro('db', pg_temp.m(-25)), 'recorder reopens a waiver past the make-up deadline');
SELECT throws_ok(pg_temp.ro('d2', pg_temp.m(-14)), '42501', NULL, 'recorder cannot reopen outside their scope');
SELECT throws_ok(pg_temp.ro('d4', pg_temp.m(-14)), 'MS009', NULL, 'recorder cannot reopen on a cancelled contract');
SELECT throws_ok(pg_temp.ro('d6', pg_temp.m(-12)), 'MS012', NULL, 'a made-up month cannot be reopened');
SELECT throws_ok(pg_temp.ro('d6', pg_temp.m(-14)), 'MS012', NULL, 'reopening twice is refused');
SELECT throws_ok($$SELECT public.reopen_missed_service('{"contract_id": "00000000-0000-0000-0000-0000000000d6"}')$$,
  '22004', NULL, 'reopen needs contract_id and missed_month');
SELECT ok(pg_temp.m(-14) = ANY (pg_temp.pending('d6')), 'the reopened month is pending again');
SELECT lives_ok(pg_temp.mk('0d', 'd6', pg_temp.td(), pg_temp.m(-14)), 'a reopened month can now be made up');
-- host
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(pg_temp.ro('da', pg_temp.m(-14)), 'host reopens a waiver on an active contract');
SELECT lives_ok(pg_temp.ro('dc', pg_temp.m(-14)), 'host reopens a waiver on a closed contract');
SELECT throws_ok(pg_temp.ro('d4', pg_temp.m(-14)), 'MS009', NULL, 'host cannot reopen on a cancelled contract');
-- admin / viewer
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT throws_ok(pg_temp.ro('db', pg_temp.m(-24)), '42501', NULL, 'admin cannot reopen');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
SELECT throws_ok(pg_temp.ro('db', pg_temp.m(-24)), '42501', NULL, 'viewer cannot reopen');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'missed_service_resolutions' AND action = 'delete'
            AND contract_id = pg_temp.id('d6') AND month_key = to_char(pg_temp.m(-14), 'YYYY-MM')
            AND changed_by = '00000000-0000-0000-0000-0000000000a3'
            AND old_data ->> 'kind' = 'waived'), 1,
  'reopening is audited with the old waiver and who reopened it');

-- =====================================================================
-- ไฟล์หลักฐาน (แก้ตามผลตรวจ security รอบแรก)
-- =====================================================================
INSERT INTO storage.objects (bucket_id, name, owner_id, created_at) VALUES
  ('missed-service-evidence', '00000000-0000-0000-0000-0000000000D1/UP.pdf', NULL, now() - interval '2 hours'),
  ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d1/orphan.pdf', '00000000-0000-0000-0000-0000000000a1', now() - interval '2 hours');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(pg_temp.rs('d1', pg_temp.m(-14), 'ยินยอม', '00000000-0000-0000-0000-0000000000D1/UP.pdf'),
  'evidence in an upper-case contract folder is accepted');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'missed-service-evidence'
            AND name = '00000000-0000-0000-0000-0000000000D1/UP.pdf'), 1, 'referenced evidence is readable');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'missed-service-evidence'
            AND name = '00000000-0000-0000-0000-0000000000d1/orphan.pdf'), 0, 'unreferenced evidence of others is not readable');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'missed-service-evidence'
            AND name = '00000000-0000-0000-0000-0000000000d1/r.pdf'), 1, 'own fresh upload is readable (for clean-up)');
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name, owner_id)
                  VALUES ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d1/r2.pdf', '00000000-0000-0000-0000-0000000000a3')$$,
  'recorder uploads another file');
SELECT set_config('storage.allow_delete_query', 'true', true);  -- Storage API ตั้งค่านี้เอง
DELETE FROM storage.objects WHERE bucket_id = 'missed-service-evidence'
   AND name IN ('00000000-0000-0000-0000-0000000000d1/r2.pdf', '00000000-0000-0000-0000-0000000000D1/UP.pdf');
SELECT set_config('storage.allow_delete_query', '', true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'missed-service-evidence'
            AND name = '00000000-0000-0000-0000-0000000000d1/r2.pdf'), 0, 'own fresh unreferenced upload can be deleted (clean-up)');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'missed-service-evidence'
            AND name = '00000000-0000-0000-0000-0000000000D1/UP.pdf'), 1, 'referenced evidence cannot be deleted by users');
SELECT is((SELECT count(*)::int FROM storage_deletion_queue WHERE bucket = 'missed-service-evidence'
            AND path = '00000000-0000-0000-0000-0000000000d1/consent.pdf' AND done_at IS NULL), 1,
  'replaced evidence is queued for deletion');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(pg_temp.rs('d1', pg_temp.m(-14), 'ยินยอม', '00000000-0000-0000-0000-0000000000d1/consent.pdf'),
  'MS007', NULL, 'evidence waiting for deletion cannot be reused');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
