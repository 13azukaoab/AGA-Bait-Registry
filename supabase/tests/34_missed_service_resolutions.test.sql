-- M18 (20261114200000): ตกบริการ ชดเชย / ไม่ชดเชย (DECISIONS 2.41)
--   ตาราง missed_service_resolutions (เขียนผ่าน resolve_missed_service เท่านั้น) · visits.makeup_for_month
--   · save_makeup_service_visit · bucket หลักฐาน · audit
-- วันที่ที่ขึ้นกับ "เดือนปัจจุบัน" (Asia/Bangkok) คำนวณผ่าน pg_temp.cm() → เทสไม่พังเมื่อเวลาผ่านไป
--   d1 = สัญญาในอดีต (ม.ค.–ธ.ค. 2025) · d3 = สัญญาที่ยังไม่จบ (เริ่ม cm − 6 เดือน, 1 ปี) · d2 = ต่างจังหวัด
BEGIN;
SELECT plan(75);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec@test.local');
INSERT INTO profiles (user_id, display_name, username, role, division_scope) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host',     'user_a1', 'host',     '{central,province}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin',    'user_a2', 'admin',    '{central}'),
  ('00000000-0000-0000-0000-0000000000a3', 'recorder', 'user_a3', 'recorder', '{central}');
INSERT INTO customers (id, branch_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM branches WHERE division = 'central' ORDER BY name LIMIT 1), 'Central'),
  ('00000000-0000-0000-0000-0000000000c2', (SELECT id FROM branches WHERE division = 'province' ORDER BY name LIMIT 1), 'Province');

CREATE FUNCTION pg_temp.cm() RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date $$;
GRANT EXECUTE ON FUNCTION pg_temp.cm() TO PUBLIC;

INSERT INTO contracts (id, customer_id, contract_no, start_date, term_years, value_total, stations_initialized_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'M-1', '2025-01-01', 1, 150000, now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', 'M-2', '2025-01-01', 1, 50000, now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'M-3',
   (pg_temp.cm() - interval '6 months')::date, 1, 24000, now());
-- d1: เม.ย. 2025 มี routine (ไม่ตก) · พ.ค./มิ.ย. 2025 ไม่มี (ตก)
INSERT INTO visits (id, contract_id, visit_date, visit_type, start_time, end_time) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', '2025-04-10', 'routine', '09:00', '10:00');
-- ไฟล์หลักฐานที่อัปโหลดแล้ว (ข้อมูลตั้งต้น)
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d1/consent.pdf'),
  ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d2/consent.pdf');

CREATE TEMP TABLE _t AS SELECT (SELECT id FROM teams WHERE code = 'A') AS a;
GRANT SELECT ON _t TO PUBLIC;
-- payload ของ resolve_missed_service
CREATE FUNCTION pg_temp.rs(p_contract text, p_missed date, p_kind text, p_makeup date DEFAULT NULL,
                           p_reason text DEFAULT NULL, p_evidence text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.resolve_missed_service(%L::jsonb)',
    jsonb_strip_nulls(jsonb_build_object(
      'contract_id', '00000000-0000-0000-0000-0000000000' || p_contract, 'missed_month', p_missed,
      'kind', p_kind, 'makeup_date', p_makeup, 'reason', p_reason, 'evidence_path', p_evidence)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.rs(text, date, text, date, text, text) TO PUBLIC;
-- payload ของ save_service_visit (+ makeup_for_month ถ้าส่ง)
CREATE FUNCTION pg_temp.sv(p_visit text, p_contract text, p_date date, p_type text DEFAULT 'routine')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('visit_id', '00000000-0000-0000-0000-0000000000' || p_visit,
                            'contract_id', '00000000-0000-0000-0000-0000000000' || p_contract,
                            'visit_date', p_date, 'visit_type', p_type, 'start_time', '09:00', 'end_time', '10:30',
                            'team_ids', jsonb_build_array((SELECT a FROM _t)), 'skip_all_ag', true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sv(text, text, date, text) TO PUBLIC;
CREATE FUNCTION pg_temp.mk(p_visit text, p_contract text, p_date date, p_month date, p_type text DEFAULT 'routine')
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.save_makeup_service_visit(%L::jsonb)',
                pg_temp.sv(p_visit, p_contract, p_date, p_type) || jsonb_build_object('makeup_for_month', p_month))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.mk(text, text, date, date, text) TO PUBLIC;
CREATE FUNCTION pg_temp.link(p_visit text) RETURNS date LANGUAGE sql AS
  $$ SELECT makeup_for_month FROM visits WHERE id = ('00000000-0000-0000-0000-0000000000' || p_visit)::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.link(text) TO PUBLIC;

-- =====================================================================
-- โครงสร้าง + สิทธิ์ (PDPA)
-- =====================================================================
SELECT has_table('public', 'missed_service_resolutions', 'table missed_service_resolutions exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.missed_service_resolutions'::regclass),
  'RLS is enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.missed_service_resolutions', 'SELECT'), 'anon cannot read resolutions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.missed_service_resolutions', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.missed_service_resolutions', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.missed_service_resolutions', 'DELETE'),
  'authenticated has no direct write privilege (RPC only)');
SELECT ok(NOT has_function_privilege('anon', 'public.resolve_missed_service(jsonb)', 'EXECUTE'),
  'anon cannot execute resolve_missed_service');
SELECT ok(NOT has_function_privilege('anon', 'public.save_makeup_service_visit(jsonb)', 'EXECUTE'),
  'anon cannot execute save_makeup_service_visit');
SELECT ok(NOT has_function_privilege('authenticated', 'public.visits_makeup_link_guard()', 'EXECUTE'),
  'trigger function is not callable by users');
SELECT is((SELECT public FROM storage.buckets WHERE id = 'missed-service-evidence'), false, 'evidence bucket is private');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.missed_service_resolutions$$, '42501', NULL, 'anon select is refused');
RESET ROLE;

-- =====================================================================
-- recorder: ด่านเดือนที่ตก / ชนิด / เดือนชดเชย
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(pg_temp.rs('d1', '2025-05-15', 'waived', NULL, 'x'), 'MS001', NULL, 'missed_month must be the 1st day');
SELECT throws_ok(pg_temp.rs('d1', '2024-12-01', 'waived', NULL, 'x'), 'MS001', NULL, 'month before the contract start is refused');
SELECT throws_ok(pg_temp.rs('d1', '2026-01-01', 'waived', NULL, 'x'), 'MS001', NULL, 'month after the service months is refused (rule 5)');
SELECT throws_ok(pg_temp.rs('d3', pg_temp.cm(), 'waived', NULL, 'x'), 'MS001', NULL, 'the current month is not missed yet');
SELECT throws_ok(pg_temp.rs('d1', '2025-04-01', 'waived', NULL, 'x'), 'MS002', NULL, 'a month with a routine visit is not missed');
SELECT throws_ok(pg_temp.rs('d1', '2025-05-01', 'waived'), 'MS004', NULL, 'waived needs a reason');
SELECT throws_ok(pg_temp.rs('d1', '2025-05-01', 'waived', NULL, '   '), 'MS004', NULL, 'a blank reason is not a reason');
SELECT throws_ok(pg_temp.rs('d1', '2025-05-01', 'makeup'), 'MS003', NULL, 'makeup needs a date');
SELECT throws_ok(pg_temp.rs('d1', '2025-05-01', 'makeup', '2025-05-20'), 'MS003', NULL, 'make-up month must be after the missed month');
SELECT throws_ok(pg_temp.rs('d1', '2025-05-01', 'makeup', '2025-06-15'), 'MS003', NULL, 'recorder cannot pick a past make-up month');
SELECT throws_ok(pg_temp.rs('d1', '2025-05-01', 'later'), '22023', NULL, 'unknown kind is refused');
SELECT throws_ok($$SELECT public.resolve_missed_service('{"contract_id": "00000000-0000-0000-0000-0000000000d1"}')$$,
  '22004', NULL, 'missing keys are refused');
SELECT throws_ok(pg_temp.rs('d2', '2025-05-01', 'waived', NULL, 'x'), '42501', NULL, 'recorder cannot resolve outside their scope');
SELECT throws_ok(pg_temp.rs('d9', '2025-05-01', 'waived', NULL, 'x'), 'AG004', NULL, 'unknown contract');
SELECT throws_ok(pg_temp.rs('d1', '2025-05-01', 'waived', NULL, 'x', '00000000-0000-0000-0000-0000000000d2/consent.pdf'),
  'MS007', NULL, 'evidence of another contract is refused');
SELECT throws_ok(pg_temp.rs('d1', '2025-05-01', 'waived', NULL, 'x', '00000000-0000-0000-0000-0000000000d1/nope.pdf'),
  'MS007', NULL, 'evidence that was not uploaded is refused');

-- ทางที่ถูก: ชดเชยหลังสัญญาจบ (ค่าเริ่มต้นของหน้าจอ = เดือนถัดจากสัญญาจบ · ที่นี่เลือกเดือนหน้า)
SELECT lives_ok(pg_temp.rs('d1', '2025-05-01', 'makeup', (pg_temp.cm() + interval '1 month 4 days')::date),
  'recorder decides make-up for May 2025 in a future month');
RESET ROLE;
SELECT is((SELECT kind::text || '|' || makeup_month::text || '|' || decided_by::text
             FROM missed_service_resolutions WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
              AND missed_month = '2025-05-01'),
  'makeup|' || (pg_temp.cm() + interval '1 month')::date::text || '|00000000-0000-0000-0000-0000000000a3',
  'row stores kind, make-up month (1st day) and who decided');
SELECT is((SELECT makeup_date FROM missed_service_resolutions WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
            AND missed_month = '2025-05-01'), (pg_temp.cm() + interval '1 month 4 days')::date,
  'the calendar date is kept as makeup_date');
SELECT is((SELECT count(*)::int FROM audit_log WHERE table_name = 'missed_service_resolutions' AND action = 'insert'
            AND contract_id = '00000000-0000-0000-0000-0000000000d1' AND month_key = '2025-05'
            AND changed_by = '00000000-0000-0000-0000-0000000000a3'), 1,
  'decision is audited with contract, missed month and user');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(pg_temp.rs('d1', '2025-05-01', 'waived', NULL, 'ลูกค้ายินยอม', '00000000-0000-0000-0000-0000000000d1/consent.pdf'),
  'recorder changes it to waived with a reason and evidence');
SELECT is((SELECT kind::text || '|' || coalesce(makeup_month::text, '-') || '|' || evidence_path
             FROM missed_service_resolutions WHERE contract_id = '00000000-0000-0000-0000-0000000000d1'
              AND missed_month = '2025-05-01'),
  'waived|-|00000000-0000-0000-0000-0000000000d1/consent.pdf', 'same row is updated (no duplicate), make-up month cleared');
SELECT is((SELECT count(*)::int FROM missed_service_resolutions), 1, 'still one row');
SELECT throws_ok($$INSERT INTO missed_service_resolutions (contract_id, missed_month, kind, reason)
                   VALUES ('00000000-0000-0000-0000-0000000000d1', '2025-06-01', 'waived', 'x')$$,
  '42501', NULL, 'recorder cannot insert directly');
SELECT throws_ok($$UPDATE missed_service_resolutions SET reason = 'hack'$$, '42501', NULL, 'recorder cannot update directly');
-- ไฟล์หลักฐาน: อัปโหลดได้ในสัญญาที่อยู่ในขอบเขต
-- owner_id = ผู้อัปโหลด (Storage API ตั้งให้เอง · ในเทสใส่เอง)
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name, owner_id)
                  VALUES ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d1/r.pdf', '00000000-0000-0000-0000-0000000000a3')$$,
  'recorder uploads evidence for a contract in scope');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d2/r.pdf')$$,
  '42501', NULL, 'recorder cannot upload evidence for a contract out of scope');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('missed-service-evidence', 'loose.pdf')$$,
  '42501', NULL, 'evidence must sit in a contract folder');

-- =====================================================================
-- admin: อ่านได้อย่างเดียว · anon (viewer) ไม่เห็น
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
SELECT is((SELECT count(*)::int FROM missed_service_resolutions), 1, 'admin can read decisions');
SELECT throws_ok(pg_temp.rs('d1', '2025-06-01', 'waived', NULL, 'x'), '42501', NULL, 'admin cannot resolve');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d1/a.pdf')$$,
  '42501', NULL, 'admin cannot upload evidence');
SELECT throws_ok(pg_temp.mk('f9', 'd1', '2025-06-10', '2025-05-01'), '42501', NULL, 'admin cannot save a make-up visit');

-- =====================================================================
-- host: ย้อนเดือนชดเชยได้ (ในช่วงสัญญา)
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok(pg_temp.rs('d1', '2025-06-01', 'makeup', '2025-07-10'), 'host may pick a past make-up month');
SELECT lives_ok(pg_temp.mk('f1', 'd1', '2025-07-10', '2025-06-01'), 'host records the make-up visit in July 2025');
SELECT is(pg_temp.link('f1'), '2025-06-01'::date, 'visit is linked to June 2025');

-- =====================================================================
-- การเข้าชดเชย (recorder · สัญญาที่ยังไม่จบ · ชดเชยในช่วงสัญญา)
-- =====================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(pg_temp.rs('d3', (pg_temp.cm() - interval '2 months')::date, 'makeup', pg_temp.cm()),
  'recorder decides make-up of (cm − 2) in the current month');
SELECT throws_ok(pg_temp.mk('f2', 'd3', pg_temp.cm(), (pg_temp.cm() - interval '3 months')::date),
  'MS006', NULL, 'cannot link a visit to a month that has no make-up decision');
SELECT throws_ok(pg_temp.mk('f2', 'd3', pg_temp.cm(), (pg_temp.cm() - interval '2 months')::date, 'problem'),
  'MS006', NULL, 'a make-up visit must be routine');
SELECT throws_ok(pg_temp.mk('f2', 'd3', (pg_temp.cm() - interval '1 month')::date, (pg_temp.cm() - interval '2 months')::date),
  'MS006', NULL, 'a make-up visit must be in the make-up month');
SELECT ok(NOT EXISTS (SELECT 1 FROM visits WHERE id = '00000000-0000-0000-0000-0000000000f2'),
  'refused make-up saves leave no visit behind (one transaction)');
SELECT lives_ok(pg_temp.mk('f2', 'd3', pg_temp.cm(), (pg_temp.cm() - interval '2 months')::date),
  'recorder records the make-up visit');
SELECT is(pg_temp.link('f2'), (pg_temp.cm() - interval '2 months')::date, 'visit is linked');
SELECT throws_ok(pg_temp.mk('f3', 'd3', pg_temp.cm(), (pg_temp.cm() - interval '2 months')::date),
  '23505', NULL, 'one missed month links to one visit only');
SELECT lives_ok(format('SELECT public.save_service_visit(%L::jsonb)', pg_temp.sv('f3', 'd3', pg_temp.cm())),
  'the normal routine visit of the same month is saved with the old RPC');
SELECT lives_ok(format('SELECT public.save_service_visit(%L::jsonb)', pg_temp.sv('f2', 'd3', pg_temp.cm()) || '{"note": "แก้"}'),
  're-saving the make-up visit with the old RPC works');
SELECT is(pg_temp.link('f2'), (pg_temp.cm() - interval '2 months')::date, 'and keeps its link');
-- การตัดสินล็อกเมื่อมีการเข้าผูกอยู่
SELECT throws_ok(pg_temp.rs('d3', (pg_temp.cm() - interval '2 months')::date, 'waived', NULL, 'x'),
  'MS005', NULL, 'cannot switch to waived while a make-up visit is linked');
SELECT throws_ok(pg_temp.rs('d3', (pg_temp.cm() - interval '2 months')::date, 'makeup', (pg_temp.cm() + interval '1 month')::date),
  'MS005', NULL, 'cannot move the make-up month while a make-up visit is linked');
SELECT lives_ok(pg_temp.rs('d3', (pg_temp.cm() - interval '2 months')::date, 'makeup', (pg_temp.cm() + interval '9 days')::date, 'นัดใหม่'),
  'same make-up month with another day/reason is fine');
-- ทางเลี่ยงผ่าน PATCH ตรง
SELECT throws_ok($$UPDATE visits SET makeup_for_month = (pg_temp.cm() - interval '3 months')::date
                    WHERE id = '00000000-0000-0000-0000-0000000000f3'$$,
  'MS006', NULL, 'direct PATCH to a month without a decision is refused');
SELECT throws_ok($$UPDATE visits SET visit_date = (pg_temp.cm() - interval '1 month')::date
                    WHERE id = '00000000-0000-0000-0000-0000000000f2'$$,
  'MS006', NULL, 'moving a linked visit out of the make-up month is refused');
SELECT throws_ok($$UPDATE visits SET visit_type = 'problem' WHERE id = '00000000-0000-0000-0000-0000000000f2'$$,
  'MS006', NULL, 'turning a linked visit into a non-routine visit is refused');
-- เลิกผูก → เปลี่ยนเป็นไม่ชดเชยได้
SELECT lives_ok(pg_temp.mk('f2', 'd3', pg_temp.cm(), NULL), 'unlink through save_makeup_service_visit (null)');
SELECT is(pg_temp.link('f2'), NULL::date, 'visit is no longer linked');
SELECT lives_ok(pg_temp.rs('d3', (pg_temp.cm() - interval '2 months')::date, 'waived', NULL, 'ยินยอม'),
  'after unlinking, the decision can change to waived');
-- ผูกอยู่แล้วลบการเข้าได้ตามปกติ (FK ไม่ขวาง)
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f2')$$, 'unlinked visit deletes normally');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT lives_ok($$SELECT public.delete_service_visit('00000000-0000-0000-0000-0000000000f1')$$,
  'a linked make-up visit can be deleted (status goes back to not-done)');
SELECT is((SELECT count(*)::int FROM missed_service_resolutions WHERE missed_month = '2025-06-01'), 1,
  'the decision stays after its visit is deleted');
RESET ROLE;

-- =====================================================================
-- แก้ตามผลตรวจ security (Opus)
-- =====================================================================
-- (1) เพดานเดือนชดเชย: ไม่เกิน 12 เดือนหลัง max(เดือนบริการสุดท้าย, เดือนปัจจุบัน) — ทุกบทบาท
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(pg_temp.rs('d1', '2025-07-01', 'makeup', (pg_temp.cm() + interval '13 months')::date),
  'MS003', NULL, 'make-up month more than 12 months ahead is refused (Dashboard inflation guard)');
SELECT lives_ok(pg_temp.rs('d1', '2025-07-01', 'makeup', (pg_temp.cm() + interval '12 months')::date),
  'make-up month exactly 12 months ahead is allowed');
-- (2) path ตัวพิมพ์ใหญ่ (storage_contract_id รับได้) ใช้เป็นหลักฐานได้
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id, created_at) VALUES
  ('missed-service-evidence', '00000000-0000-0000-0000-0000000000D1/UP.pdf', NULL, now() - interval '2 hours'),
  ('missed-service-evidence', '00000000-0000-0000-0000-0000000000d1/orphan.pdf', '00000000-0000-0000-0000-0000000000a1', now() - interval '2 hours');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT lives_ok(pg_temp.rs('d1', '2025-05-01', 'waived', NULL, 'ยินยอม', '00000000-0000-0000-0000-0000000000D1/UP.pdf'),
  'evidence in an upper-case contract folder is accepted');
-- (3) อ่าน bucket: ต้องมีการตัดสินอ้างอิง (หรือเป็นไฟล์ของตัวเองที่เพิ่งอัปโหลด < 1 ชม.)
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'missed-service-evidence'
            AND name = '00000000-0000-0000-0000-0000000000D1/UP.pdf'), 1, 'referenced evidence is readable');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'missed-service-evidence'
            AND name = '00000000-0000-0000-0000-0000000000d1/orphan.pdf'), 0, 'unreferenced evidence of others is not readable');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'missed-service-evidence'
            AND name = '00000000-0000-0000-0000-0000000000d1/r.pdf'), 1, 'own fresh upload is readable (for clean-up)');
-- (4) เปลี่ยนไฟล์หลักฐาน → ไฟล์เก่าลงคิวลบ · ใช้ไฟล์ที่อยู่ในคิวซ้ำไม่ได้
RESET ROLE;
SELECT is((SELECT count(*)::int FROM storage_deletion_queue WHERE bucket = 'missed-service-evidence'
            AND path = '00000000-0000-0000-0000-0000000000d1/consent.pdf' AND done_at IS NULL), 1,
  'replaced evidence is queued for deletion');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
SELECT throws_ok(pg_temp.rs('d1', '2025-05-01', 'waived', NULL, 'ยินยอม', '00000000-0000-0000-0000-0000000000d1/consent.pdf'),
  'MS007', NULL, 'evidence waiting for deletion cannot be reused');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
